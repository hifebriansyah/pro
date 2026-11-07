import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS, GATEWAY_ID, MODELS, aiChat, runModel } from "../src/workersai.js";
import { parseAgentBody } from "../src/serve.js";

test("workers ai: every model is called through the gateway (credit, never neurons), with its thinking off", async () => {
  assert.deepEqual(AI_PROVIDERS, ["deepseek", "qwen"]);
  for (const which of AI_PROVIDERS) {
    const calls = [];
    const ai = { run: async (model, input, opts) => { calls.push({ model, input, opts }); return { choices: [{ message: { content: " Jakarta. " } }] }; } };
    assert.equal(await runModel(ai, which, "ibu kota?"), "Jakarta.");
    assert.equal(calls[0].model, MODELS[which].model);
    assert.deepEqual(calls[0].opts, { gateway: { id: GATEWAY_ID } });
    assert.deepEqual(calls[0].input.messages, [{ role: "user", content: "ibu kota?" }]);
    assert.ok(calls[0].input.chat_template_kwargs, "thinking is switched off");
    assert.deepEqual(await aiChat(which)("x", { env: { AI: ai } }), { text: "Jakarta.", references: [] });
  }
  await assert.rejects(runModel({ run: async () => ({}) }, "other", "q"), /unknown model/);
});

test("workers ai: without a binding it asks the Worker's /llm with the shared secret and the model; a refusal is not retried", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url, init });
    return seen.length === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ text: "ok" }));
  });
  assert.deepEqual(await aiChat("qwen")("q", { env: { PROXY_SECRET: "s" } }), { text: "ok", references: [] }); // 503 once, then the retry
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://pro-worker.situs.id/llm");
  assert.equal(seen[0].init.headers["x-pro-secret"], "s");
  assert.deepEqual(JSON.parse(seen[0].init.body), { prompt: "q", model: "qwen" });

  globalThis.fetch.mock.mockImplementation(async () => new Response("{}", { status: 401 }));
  await assert.rejects(aiChat("deepseek")("q", { env: { PROXY_SECRET: "s" } }), /HTTP 401/);
  await assert.rejects(aiChat("deepseek")("q", { env: {} }), /not configured/);
});

test("deepseek and qwen are answer sources the agent accepts", () => {
  for (const p of ["deepseek", "qwen"]) assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: p })).provider, p);
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "other" })).provider, "islam");
});
