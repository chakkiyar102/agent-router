import { describe, expect, it } from "vitest";
import type { SemanticCandidate } from "../../src/semantic/candidate.js";
import { requiredTier, selectTierCandidates } from "../../src/semantic/quality-tier.js";

function candidate(id: string, tier?: SemanticCandidate["tier"]): SemanticCandidate {
  return {
    opaqueId: id,
    agent: "claude-code",
    modelId: id,
    supportedEfforts: ["low"],
    projectedRemainingRatio: 1,
    capabilities: { planning: 0.8, coding: 0.8, debugging: 0.8, creativity: 0.7, research: 0.7 },
    ...(tier ? { tier } : {}),
  };
}

const all = [
  candidate("sonnet"),
  candidate("glm", "standard"),
  candidate("opus", "premium"),
  candidate("fable", "flagship"),
];

describe("requiredTier", () => {
  it("keeps routine work on the standard tier", () => {
    expect(requiredTier({ complexity: 0.4, consequence: 1.2 })).toBe("standard");
  });

  it("asks for premium when either score is high", () => {
    expect(requiredTier({ complexity: 1.6, consequence: 0.2 })).toBe("premium");
    expect(requiredTier({ complexity: 0.2, consequence: 1.5 })).toBe("premium");
  });

  it("asks for flagship only when both scores are severe", () => {
    expect(requiredTier({ complexity: 2.6, consequence: 2.7 })).toBe("flagship");
    expect(requiredTier({ complexity: 3, consequence: 2.4 })).toBe("premium");
  });
});

describe("selectTierCandidates", () => {
  it("never offers flagship models to standard work", () => {
    const result = selectTierCandidates(all, { complexity: 0, consequence: 0 });
    expect(result.candidates.map((c) => c.opaqueId)).toEqual(["sonnet", "glm", "opus"]);
  });

  it("limits premium work to premium models", () => {
    const result = selectTierCandidates(all, { complexity: 2, consequence: 1 });
    expect(result.candidates.map((c) => c.opaqueId)).toEqual(["opus"]);
    expect(result.applied).toBe("premium");
  });

  it("limits flagship work to flagship models", () => {
    const result = selectTierCandidates(all, { complexity: 3, consequence: 3 });
    expect(result.candidates.map((c) => c.opaqueId)).toEqual(["fable"]);
  });

  it("falls back from flagship to premium when no flagship model is eligible", () => {
    const result = selectTierCandidates(all.slice(0, 3), { complexity: 3, consequence: 3 });
    expect(result.candidates.map((c) => c.opaqueId)).toEqual(["opus"]);
    expect(result.applied).toBe("premium");
  });

  it("falls back to every non-flagship candidate when the tier is empty", () => {
    const result = selectTierCandidates(all.slice(0, 2), { complexity: 2, consequence: 2 });
    expect(result.candidates.map((c) => c.opaqueId)).toEqual(["sonnet", "glm"]);
    expect(result.applied).toBe("any");
  });
});
