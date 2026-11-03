import { selectTierCandidates } from "./quality-tier.js";
import type { ChoiceResponse, SystemOneRequest } from "@typesafe-ai/sdk";
import type { ReasoningEffort } from "../domain/model-profile.js";
import type { WorkflowPhase } from "../domain/session.js";
import type { EnrichmentShapes } from "../enrich/buckets.js";
import type { SemanticCandidate } from "./candidate.js";
import { cacheValueQuestion } from "./cache-assessor.js";
import { effortOptions, effortQuestion, snapEffort } from "./effort-selector.js";
import { isTopTier } from "../live-effort/levels.js";
import { deterministicFallback } from "./fallback.js";
import { phaseQuestion } from "./phase-classifier.js";
import { routeQuestion } from "./route-ranker.js";
import { taskFamilyQuestion } from "./task-classifier.js";
import { complexityQuestion, consequenceQuestion, creativityQuestion } from "./task-scorer.js";
import { assertSafeState, type TypeSafePort } from "./typesafe-client.js";
import { shouldReconsiderRoute } from "../sessions/phase-transition.js";

export type { SemanticCandidate } from "./candidate.js";

export interface DecideRouteInput {
  task: string;
  candidates: SemanticCandidate[];
  topTierUnlocked: boolean;
  client: TypeSafePort;
  previousRoute?: {
    opaqueId: string;
    phase: WorkflowPhase;
    effort: ReasoningEffort;
  };
  /** Bucketed task size. Never carries a path; see enrich/buckets.ts. */
  enrichment?: EnrichmentShapes;
}

export type RouteDecisionResult =
  | {
      status: "selected";
      candidateOpaqueId: string;
      effort: ReasoningEffort;
      phase: WorkflowPhase;
      family: string;
      confidence: number;
      reason: string;
      sticky: boolean;
    }
  | {
      status: "ask-user";
      options: string[];
      family: string;
      phase: WorkflowPhase;
    }
  | { status: "invalid-choice" }
  | { status: "no-candidates" }
  | { status: "unsafe-state" }
  | { status: "typesafe-unavailable"; fallback?: ReturnType<typeof deterministicFallback> };

export function applyConfidencePolicy(input: {
  consequenceScore: number;
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  eligibleIds: string[];
}): { action: "ask-user"; options: string[] } | { action: "use-default"; option: string } {
  const ranked = Object.entries(input.probabilities)
    .filter(([id]) => input.eligibleIds.includes(id))
    .sort((left, right) => right[1] - left[1])
    .map(([id]) => id);
  if (input.consequenceScore >= 2 && input.confidence < 0.75 && ranked.length >= 2) {
    return { action: "ask-user", options: ranked.slice(0, 2) };
  }
  const option = input.eligibleIds.includes(input.choice) ? input.choice : ranked[0];
  return { action: "use-default", option: option ?? input.choice };
}

export async function decideRoute(input: DecideRouteInput): Promise<RouteDecisionResult> {
  if (input.candidates.length === 0) {
    return { status: "no-candidates" };
  }
  const eligibleIds = input.candidates.map((candidate) => candidate.opaqueId);
  const classificationState = {
    task: input.task,
    candidateCount: input.candidates.length,
    ...(input.enrichment ? { enrichment: input.enrichment } : {}),
  };
  try {
    assertSafeState(classificationState);
  } catch {
    return { status: "unsafe-state" };
  }

  let classification;
  try {
    classification = await input.client.systemOne({
      state: classificationState,
      questions: {
        family: taskFamilyQuestion(),
        phase: phaseQuestion(),
        complexity: complexityQuestion(),
        creativity: creativityQuestion(),
        consequence: consequenceQuestion(),
        cacheValue: cacheValueQuestion(),
      },
    });
  } catch {
    return {
      status: "typesafe-unavailable",
      fallback: deterministicFallback({
        family: "routine-transformation",
        candidates: input.candidates,
      }),
    };
  }

  const family = classification.answers.family.choice;
  const phase = classification.answers.phase.choice as WorkflowPhase;
  const previous = input.previousRoute;
  const previousCandidate = previous
    ? input.candidates.find((candidate) => candidate.opaqueId === previous.opaqueId)
    : undefined;
  const routeStillEligible = Boolean(
    previousCandidate?.supportedEfforts.includes(previous!.effort),
  );
  if (
    previous &&
    !shouldReconsiderRoute({
      currentPhase: previous.phase,
      nextPhase: phase,
      routeStillEligible,
    })
  ) {
    return {
      status: "selected",
      candidateOpaqueId: previous.opaqueId,
      effort: previous.effort,
      phase,
      family,
      confidence: 1,
      reason: `reused previous route ${previous.opaqueId} (same phase)`,
      sticky: true,
    };
  }
  const tiered = selectTierCandidates(input.candidates, {
    complexity: classification.answers.complexity.score,
    consequence: classification.answers.consequence.score,
  });
  const rankable = tiered.candidates;
  const rankableIds = rankable.map((candidate) => candidate.opaqueId);
  const tierNote =
    tiered.applied === "any" ? `tier ${tiered.tier} unavailable` : `tier ${tiered.applied}`;
  const rankingState = {
    task: input.task,
    family,
    phase,
    complexity: classification.answers.complexity.score,
    creativity: classification.answers.creativity.score,
    consequence: classification.answers.consequence.score,
    cacheValue: classification.answers.cacheValue.score,
    candidates: rankable.map((candidate) => ({
      opaqueId: candidate.opaqueId,
      agent: candidate.agent,
      projectedRemainingRatio: candidate.projectedRemainingRatio,
      ...(candidate.relativeCost === undefined ? {} : { relativeCost: candidate.relativeCost }),
      capabilities: candidate.capabilities,
      supportedEfforts: [...candidate.supportedEfforts],
    })),
  };
  try {
    assertSafeState(rankingState);
  } catch {
    return { status: "unsafe-state" };
  }

  const needsRanking = !(rankable.length === 1 && rankable.length < input.candidates.length);
  // Start the ranking first; the effort question below runs concurrently with it.
  const rankingRequest = needsRanking
    ? input.client
        .systemOne({ state: rankingState, questions: { route: routeQuestion(rankable) } })
        .then(
          (response) => ({ ok: true as const, response }),
          () => ({ ok: false as const }),
        )
    : undefined;

  // Effort is a judgment about the task, not the model, so ask it alongside the ranking
  // (speculative fan-out) over every level the remaining candidates support, then snap it
  // to the selected model. Skip it when no candidate has an effort setting.
  const effortLevels = effortOptions(rankable, input.topTierUnlocked);
  const effortRequest: Promise<{ ok: true; effort: ReasoningEffort } | { ok: false } | undefined> =
    effortLevels.length === 0
      ? Promise.resolve(undefined)
      : input.client
          .systemOne({
            state: {
              task: input.task,
              family,
              phase,
              complexity: classification.answers.complexity.score,
              creativity: classification.answers.creativity.score,
              ...(input.enrichment ? { enrichment: input.enrichment } : {}),
            },
            questions: { effort: effortQuestion(effortLevels, input.topTierUnlocked) },
          })
          .then(
            (response) => ({ ok: true as const, effort: response.answers.effort.choice as ReasoningEffort }),
            () => ({ ok: false as const }),
          );

  let confidenceDecision: ReturnType<typeof applyConfidencePolicy>;
  let routeConfidence: number;
  if (!rankingRequest) {
    // The tier rule narrowed the field to one model, so there is nothing left to rank.
    confidenceDecision = { action: "use-default", option: rankable[0]!.opaqueId };
    routeConfidence = 1;
  } else {
    const rankingResult = await rankingRequest;
    if (!rankingResult.ok) {
      await effortRequest;
      return {
        status: "typesafe-unavailable",
        fallback: deterministicFallback({
          family,
          candidates: input.candidates,
        }),
      };
    }
    const route = rankingResult.response.answers.route as ChoiceResponse;
    if (!rankableIds.includes(route.choice)) {
      await effortRequest;
      return { status: "invalid-choice" };
    }
    confidenceDecision = applyConfidencePolicy({
      consequenceScore: classification.answers.consequence.score,
      choice: route.choice,
      confidence: route.confidence,
      probabilities: route.probabilities as Record<string, number>,
      eligibleIds: rankableIds,
    });
    routeConfidence = route.confidence;
  }
  if (confidenceDecision.action === "ask-user") {
    await effortRequest;
    return { status: "ask-user", options: confidenceDecision.options, family, phase };
  }

  const chosenId = confidenceDecision.option;
  const selected = input.candidates.find((candidate) => candidate.opaqueId === chosenId);
  const effortResult = await effortRequest;
  if (!selected) {
    return { status: "invalid-choice" };
  }
  if (effortResult && !effortResult.ok) {
    return {
      status: "typesafe-unavailable",
      fallback: deterministicFallback({
        family,
        candidates: input.candidates,
      }),
    };
  }
  if (effortResult && isTopTier(effortResult.effort) && !input.topTierUnlocked) {
    return { status: "invalid-choice" };
  }
  const effort = snapEffort(
    effortResult?.effort,
    selected.supportedEfforts,
    input.topTierUnlocked,
  );
  return {
    status: "selected",
    candidateOpaqueId: selected.opaqueId,
    effort,
    phase,
    family,
    confidence: routeConfidence,
    reason: `TypeSafe selected ${selected.opaqueId} for ${family} in phase ${phase} (${tierNote})`,
    sticky: false,
  };
}

export type { SystemOneRequest };
