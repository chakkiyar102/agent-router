import { choice } from "@typesafe-ai/sdk";
import type { ReasoningEffort } from "../domain/model-profile.js";
import { EFFORT_ORDER, isTopTier } from "../live-effort/levels.js";

// Each level describes a situation, so the model judges the task rather than the label.
const EFFORT_CRITERIA: Record<ReasoningEffort, string> = {
  none: "Answer directly with no extra reasoning.",
  low: "A small, well-defined change where the approach is obvious.",
  medium: "Several steps or files; some judgment is needed, but the approach is clear.",
  high: "A hard problem: subtle bugs, design trade-offs, or unfamiliar code that needs careful reasoning.",
  xhigh: "A very hard problem where a wrong answer is expensive and exhaustive reasoning pays off.",
  max: "An exceptionally hard problem that warrants the deepest reasoning regardless of time or cost.",
  ultra: "The hardest open-ended problems, where only the maximum reasoning budget will do.",
};

export function effortQuestion(supported: ReasoningEffort[], topTierUnlocked: boolean) {
  const allowed = supported.filter((effort) => !isTopTier(effort) || topTierUnlocked);
  const criteria = Object.fromEntries(allowed.map((effort) => [effort, EFFORT_CRITERIA[effort]]));
  return choice("How much reasoning does this task need?", criteria);
}

/**
 * Every effort level any candidate supports, in order, excluding `none` (a model that only
 * supports `none` has no effort setting to choose) and locked top-tier levels.
 */
export function effortOptions(
  candidates: { supportedEfforts: readonly ReasoningEffort[] }[],
  topTierUnlocked: boolean,
): ReasoningEffort[] {
  const supported = new Set(candidates.flatMap((candidate) => candidate.supportedEfforts));
  return EFFORT_ORDER.filter(
    (effort) =>
      effort !== "none" && supported.has(effort) && (!isTopTier(effort) || topTierUnlocked),
  );
}

/**
 * Maps the effort the task needs onto what the selected model supports: the same level when
 * available, otherwise the nearest one (ties go to the higher level, favouring quality).
 * Models that only support `none` get `none`.
 */
export function snapEffort(
  wanted: ReasoningEffort | undefined,
  supported: readonly ReasoningEffort[],
  topTierUnlocked: boolean,
): ReasoningEffort {
  const usable = supported.filter(
    (effort) => effort !== "none" && (!isTopTier(effort) || topTierUnlocked),
  );
  if (usable.length === 0) {
    return "none";
  }
  if (wanted === undefined || wanted === "none") {
    return usable[0]!;
  }
  if (usable.includes(wanted)) {
    return wanted;
  }
  const target = EFFORT_ORDER.indexOf(wanted);
  let best = usable[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const effort of usable) {
    const distance = Math.abs(EFFORT_ORDER.indexOf(effort) - target);
    if (
      distance < bestDistance ||
      (distance === bestDistance && EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(best))
    ) {
      best = effort;
      bestDistance = distance;
    }
  }
  return best;
}
