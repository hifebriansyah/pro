import { test } from "node:test";
import assert from "node:assert/strict";
import { DEEPSEEK_MODEL, GATEWAY_ID, deepseekChat, runDeepseek } from "../src/deepseek.js";
import { parseAgentBody } from "../src/serve.js";

test("deepseek: the AI binding is always called through the gateway (credit, never neurons)", async () => {
  const calls = [];
  const ai = { run: async (model, input, opts) => { calls.push({ model, input, opts }); return { choices: [{ message: { content: " Jakarta. " } }] }; } };
  assert.equal(await runDeepseek(ai, "ibu kota?"), "Jakarta.");
  assert.equal(calls[0].model, DEEPSEEK_MODEL);
  assert.deepEqual(calls[0].opts, { gateway: { id: GATEWAY_ID } });
  assert.deepEqual(calls[0].input.messages, [{ role: "user", content: "ibu kota?" }]);
  assert.deepEqual(await deepseekChat("x", { env: { AI: ai } }), { text: "Jakarta.", references: [] });
});

test("deepseek: without a binding it asks the Worker's /llm with the shared secret; a refusal is not retried", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url, init });
    return seen.length === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ text: "ok" }));
  });
  assert.deepEqual(await deepseekChat("q", { env: { PROXY_SECRET: "s" } }), { text: "ok", references: [] }); // 503 once, then the retry
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://pro-worker.situs.id/llm");
  assert.equal(seen[0].init.headers["x-pro-secret"], "s");
  assert.deepEqual(JSON.parse(seen[0].init.body), { prompt: "q" });

  globalThis.fetch.mock.mockImplementation(async () => new Response("{}", { status: 401 }));
  await assert.rejects(deepseekChat("q", { env: { PROXY_SECRET: "s" } }), /HTTP 401/);
  await assert.rejects(deepseekChat("q", { env: {} }), /not configured/);
});

test("deepseek is an answer source the agent accepts", () => {
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "deepseek" })).provider, "deepseek");
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "other" })).provider, "islam");
});
