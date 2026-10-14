import {
  type Questions,
  type SystemOneRequest,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export interface TypeSafePort {
  calls: SystemOneRequest[];
  systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
}

export function createRecordingClient(inner: Pick<TypeSafePort, "systemOne">): TypeSafePort {
  const calls: SystemOneRequest[] = [];
  return {
    calls,
    async systemOne(request) {
      assertSafeState(request.state);
      calls.push(request as SystemOneRequest);
      return inner.systemOne(request);
    },
  };
}

/** Decision model used for every route decision, served by OpenRouter's Decisions API. */
export const DECIDER_MODEL = "perplexity/pplx-decider-v1.1-27b";
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/**
 * Same `state` + `questions` contract as TypeSafe System One, so callers are unchanged.
 * ponytail: no retries; a failed call surfaces as typesafe-unavailable like before.
 */
export function createOpenRouterDecider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Pick<TypeSafePort, "systemOne"> {
  return {
    async systemOne(request) {
      const res = await fetchImpl(DECISIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, model: DECIDER_MODEL }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(`OpenRouter Decisions request failed with HTTP ${res.status}`);
      }
      return (await res.json()) as never;
    },
  };
}

export function createLiveTypeSafeClient(apiKey: string): TypeSafePort {
  return createRecordingClient(createOpenRouterDecider(apiKey));
}

const SENSITIVE_PATTERNS = [
  /\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/i,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /\b(?:password|passwd|secret|cookie|authorization)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'/:@]+:[^\s"'@]+@[^\s"']+/i,
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/,
];

export function assertSafeState(state: unknown): void {
  const serialized = JSON.stringify(state);
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(serialized))) {
    throw new Error("TypeSafe state contains forbidden sensitive data");
  }
}
