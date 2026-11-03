import type { SemanticCandidate } from "./candidate.js";

export type QualityTier = "standard" | "premium" | "flagship";

/**
 * Score positions from the classification (0 = very low, 3 = severe).
 * Jev supplies the judgments; this table decides which tier a task needs.
 */
export const PREMIUM_THRESHOLD = 1.5; // complexity OR consequence at "high" or above
export const FLAGSHIP_THRESHOLD = 2.5; // complexity AND consequence both "severe"

export function requiredTier(scores: { complexity: number; consequence: number }): QualityTier {
  if (scores.complexity >= FLAGSHIP_THRESHOLD && scores.consequence >= FLAGSHIP_THRESHOLD) {
    return "flagship";
  }
  if (scores.complexity >= PREMIUM_THRESHOLD || scores.consequence >= PREMIUM_THRESHOLD) {
    return "premium";
  }
  return "standard";
}

const FALLBACK_ORDER: Record<QualityTier, QualityTier[]> = {
  flagship: ["flagship", "premium"],
  premium: ["premium"],
  standard: [],
};

/**
 * Narrows candidates to the tier the task needs. Flagship models are only offered to
 * flagship tasks. When no candidate in the required tier is eligible, it falls back a tier,
 * and finally to every non-flagship candidate, so a task is never left without a route.
 */
export function selectTierCandidates(
  candidates: SemanticCandidate[],
  scores: { complexity: number; consequence: number },
): { candidates: SemanticCandidate[]; tier: QualityTier; applied: QualityTier | "any" } {
  const tier = requiredTier(scores);
  const tierOf = (candidate: SemanticCandidate): QualityTier => candidate.tier ?? "standard";
  for (const wanted of FALLBACK_ORDER[tier]) {
    const matching = candidates.filter((candidate) => tierOf(candidate) === wanted);
    if (matching.length > 0) {
      return { candidates: matching, tier, applied: wanted };
    }
  }
  const nonFlagship = candidates.filter((candidate) => tierOf(candidate) !== "flagship");
  return {
    candidates: nonFlagship.length > 0 ? nonFlagship : candidates,
    tier,
    applied: tier === "standard" ? "standard" : "any",
  };
}
