import type { AgentId } from "../domain/ids.js";
import type { ReasoningEffort } from "../domain/model-profile.js";

export interface SemanticCandidate {
  opaqueId: string;
  agent: AgentId;
  modelId: string;
  supportedEfforts: readonly ReasoningEffort[];
  projectedRemainingRatio: number;
  /** Relative cost per task from models.json; 1 is the baseline, lower is cheaper. */
  relativeCost?: number;
  tier?: "standard" | "premium" | "flagship";
  capabilities: {
    planning: number;
    coding: number;
    debugging: number;
    creativity: number;
    research: number;
  };
}
