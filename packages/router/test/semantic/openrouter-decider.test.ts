import { describe, expect, it, vi } from "vitest";
import { createOpenRouterDecider, DECIDER_MODEL } from "../../src/semantic/typesafe-client.js";

describe("createOpenRouterDecider", () => {
  it("posts state and questions to OpenRouter with the Perplexity Decider model", async () => {
    const answer = { model: DECIDER_MODEL, answers: { hard: { type: "noul", noul: 0.1 } }, usage: { input_tokens: 1, output_tokens: 1 } };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    const client = createOpenRouterDecider("key", fetchImpl as unknown as typeof fetch);

    const result = await client.systemOne({ state: "task", questions: { hard: { type: "noul" } }, model: "jev-latest" });

    expect(result).toEqual(answer);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(JSON.parse(init.body as string).model).toBe("perplexity/pplx-decider-v1.1-27b");
  });

  it("throws on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const client = createOpenRouterDecider("key", fetchImpl as unknown as typeof fetch);
    await expect(client.systemOne({ state: "x", questions: { a: { type: "noul" } } })).rejects.toThrow("HTTP 401");
  });
});
