import type { AgentId } from "../domain/ids.js";
import type { ReasoningEffort } from "../domain/model-profile.js";

const CLAUDE_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh", "max"]);
// Codex reads model_reasoning_effort from config; `none` keeps the user's Codex default.
const CODEX_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh", "max", "ultra"]);
// Command Code's --effort support depends on the model; pass only the common levels.
const COMMAND_CODE_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high"]);

/** Agents Herdr can start and track natively (`herdr agent start --kind`). */
export type HerdrNativeAgent = Exclude<AgentId, "command-code">;

export function isHerdrNativeAgent(agent: AgentId): agent is HerdrNativeAgent {
  return agent !== "command-code";
}

/** POSIX single-quote a value for a shell command line. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function cursorModelId(launchName: string, effort: ReasoningEffort): string {
  if (effort === "none" || /^cursor-.+-(none|low|medium|high|ultra)$/.test(launchName)) {
    return launchName;
  }
  const base = launchName.replace(/^cursor-/, "");
  return `cursor-${base}-${effort}`;
}

export function herdrAgentKind(agent: HerdrNativeAgent): "cursor" | "claude" | "codex" | "opencode" {
  return agent === "claude-code" ? "claude" : agent;
}

export function buildAgentCommand(input: {
  agent: AgentId;
  launchName: string;
  effort: ReasoningEffort;
}): string[] {
  switch (input.agent) {
    case "cursor":
      return ["agent", "--model", cursorModelId(input.launchName, input.effort)];
    case "claude-code": {
      const args = ["claude", "--model", input.launchName];
      if (CLAUDE_EFFORTS.has(input.effort)) {
        args.push("--effort", input.effort);
      }
      return args;
    }
    case "codex": {
      const args = ["codex", "--model", input.launchName];
      if (CODEX_EFFORTS.has(input.effort)) {
        args.push("-c", `model_reasoning_effort="${input.effort}"`);
      }
      return args;
    }
    case "opencode":
      return ["opencode", "--model", input.launchName];
    case "command-code": {
      const args = ["cmd", "--model", input.launchName];
      if (COMMAND_CODE_EFFORTS.has(input.effort)) {
        args.push("--effort", input.effort);
      }
      return args;
    }
  }
}
