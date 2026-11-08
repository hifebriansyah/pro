import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS, GATEWAY_ID, MODELS, aiChat, callMetadata, reasoningEffort, runModel } from "../src/workersai.js";
import { parseAgentBody } from "../src/serve.js";

test("workers ai: every model is called through the gateway (credit, never neurons), with reasoning effort chosen by content type", async () => {
  assert.deepEqual(AI_PROVIDERS, ["deepseek"], "Qwen was removed: too slow for a whole page");
  for (const which of AI_PROVIDERS) {
    const calls = [];
    const ai = { run: async (model, input, opts) => { calls.push({ model, input, opts }); return { choices: [{ message: { content: " Jakarta. " } }] }; } };
    assert.equal(await runModel(ai, which, "ibu kota?"), "Jakarta.");
    assert.equal(calls[0].model, MODELS[which].model);
    assert.deepEqual(calls[0].opts, { gateway: { id: GATEWAY_ID, metadata: { effort: "none" } } });
    assert.deepEqual(calls[0].input.messages, [{ role: "user", content: "ibu kota?" }]);
    assert.equal(calls[0].input.reasoning_effort, "none", "simple chat: no thinking");
    assert.deepEqual(calls[0].input.chat_template_kwargs, { thinking: false });

    await runModel(ai, which, 'Skill "mockup-html" applies to this request, follow it:\n...\n\nUser question: Buatkan logo P-R-O dengan SVG');
    assert.equal(calls[1].input.reasoning_effort, "high", "SVG / logo: high reasoning");
    assert.equal(calls[1].input.chat_template_kwargs, undefined);

    await runModel(ai, which, 'Skill "writing-md" applies to this request, follow it:\n...\n\nUser question: Buatkan PRD login');
    assert.equal(calls[2].input.reasoning_effort, "high", "Markdown document: high reasoning");

    await runModel(ai, which, 'Skill "mockup-html" applies to this request, follow it:\n...\n\nUser question: Buatkan landing page kedai kopi');
    assert.equal(calls[3].input.reasoning_effort, "low", "full website / landing page: low reasoning");
    assert.equal(calls[3].input.chat_template_kwargs, undefined);

    assert.deepEqual(await aiChat(which)("x", { env: { AI: ai } }), { text: "Jakarta.", references: [] });
  }
  await assert.rejects(runModel({ run: async () => ({}) }, "other", "q"), /unknown model/);
});

test("reasoningEffort: SVG and Markdown get high, websites get low, simple chat and follow-ups get none", () => {
  const catalogue = "Skills (call load_skill):\n- mockup-html: Design a screen as HTML or a logo as SVG\n- writing-md: Write a deliverable as a Markdown document\n\n";
  // Simple chat & follow-ups (even when the skill catalogue or earlier chat history mentions SVG / website / Markdown)
  assert.equal(reasoningEffort(catalogue + "User question: Halo, apa kabar?"), "none");
  assert.equal(reasoningEffort(catalogue + "User question: Earlier in this chat (background only, do not mention it):\nUser: Buatkan logo SVG\nRaka: Ini mockup-nya\n\nUser's new message: Terima kasih!\n\n(Reply in the language of the user's message just above.)"), "none");

  // SVG / Icons / Logos -> high
  assert.equal(reasoningEffort(catalogue + 'Skill "mockup-html" applies to this request, follow it:\n...\n\nUser question: Buatkan ikon keranjang belanja'), "high");
  assert.equal(reasoningEffort("You are inside a <mockup> (HTML or SVG).\n\nREQUEST:\nbikin logo\n\nTHE END OF WHAT YOU HAVE WRITTEN SO FAR:\n<<<\n<svg viewBox=\"0 0 200 200\"><circle cx=\"100\" "), "high");

  // Markdown Documents -> high
  assert.equal(reasoningEffort(catalogue + 'Skill "writing-md" applies to this request, follow it:\n...\n\nUser question: Susun test plan pembayaran'), "high");
  assert.equal(reasoningEffort(catalogue + 'User question: Buat catatan rapat\n\nYou called load_skill {"name":"writing-md"}. Result:\n# Writing'), "high");
  assert.equal(reasoningEffort("You are inside a <document> (Markdown).\n\nREQUEST:\nPRD"), "high");
  assert.equal(reasoningEffort('PROJECT MODE: you are not chatting now.\n1. Write the deliverable as ONE <document title="...">...Markdown...</document>.'), "high");

  // Websites / Landing Pages / Mockups -> low
  assert.equal(reasoningEffort(catalogue + 'Skill "mockup-html" applies to this request, follow it:\n...\n\nUser question: Buatkan halaman dashboard kasir'), "low");
  assert.equal(reasoningEffort('PROJECT MODE: you are not chatting now.\n1. Write the deliverable as ONE <mockup title="...">...a complete HTML page...</mockup>.'), "low");
  assert.equal(reasoningEffort('PROJECT MODE: you are not chatting now.\nDo NOT send the whole file back\n4. <document title="script.js">...the complete JavaScript'), "low");
  assert.equal(reasoningEffort("You are inside a <mockup> (HTML or SVG).\n\nREQUEST:\nlanding page\n\nTHE END OF WHAT YOU HAVE WRITTEN SO FAR:\n<<<\n<!doctype html><html><body>"), "low");
});

test("workers ai: without a binding it asks the Worker's /llm with the shared secret and the model; a refusal is not retried", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push({ url, init });
    return seen.length === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ text: "ok" }));
  });
  assert.deepEqual(await aiChat("deepseek")("q", { env: { PROXY_SECRET: "s" } }), { text: "ok", references: [] }); // 503 once, then the retry
  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://pro-worker.situs.id/llm");
  assert.equal(seen[0].init.headers["x-pro-secret"], "s");
  assert.deepEqual(JSON.parse(seen[0].init.body), { prompt: "q", model: "deepseek" });

  globalThis.fetch.mock.mockImplementation(async () => new Response("{}", { status: 401 }));
  await assert.rejects(aiChat("deepseek")("q", { env: { PROXY_SECRET: "s" } }), /HTTP 401/);
  await assert.rejects(aiChat("deepseek")("q", { env: {} }), /not configured/);
});

test("deepseek is an answer source the agent accepts; qwen is not any more", () => {
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "deepseek" })).provider, "deepseek");
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "qwen" })).provider, "islam", "a removed source falls back to the default");
  assert.equal(parseAgentBody(JSON.stringify({ question: "q", provider: "other" })).provider, "islam");
});

test("runModel: when thinking used up the budget and nothing was answered, it asks once more with thinking off; the gateway log says the effort, agent and step", async () => {
  const calls = [];
  const ai = { run: async (model, input, opts) => { calls.push({ input, opts }); return { choices: [{ message: { content: calls.length === 1 ? "" : " Jawaban. " }, finish_reason: calls.length === 1 ? "length" : "stop" }] }; } };
  const prompt = 'PROJECT MODE: you are not chatting now.\n\nYou are Kirana, UI / UX Designer, working in a team.\n\nYOUR TASK: Halaman landing page\nBuild it.\n1. Write the deliverable as ONE <mockup title="...">';
  assert.equal(await runModel(ai, "deepseek", prompt), "Jawaban.");
  assert.equal(calls.length, 2, "one retry, not a loop");
  assert.equal(calls[0].input.reasoning_effort, "low");
  assert.equal(calls[1].input.reasoning_effort, "none");
  assert.deepEqual(calls[1].input.chat_template_kwargs, { thinking: false });
  assert.deepEqual(calls[0].opts.gateway.metadata, { effort: "low", agent: "Kirana", task: "Halaman landing page" });
  assert.equal(calls[1].opts.gateway.metadata.retry, true);
  // an empty answer with thinking already off is not retried; the metadata never carries the prompt
  calls.length = 0;
  const empty = { run: async (m, i, o) => { calls.push(1); return { choices: [{ message: { content: "" } }] }; } };
  assert.equal(await runModel(empty, "deepseek", "halo"), "");
  assert.equal(calls.length, 1);
  assert.deepEqual(callMetadata("halo", "none"), { effort: "none" });
});

test("runModel: Markdown and SVG (high) step down to low before thinking is switched off", async () => {
  const efforts = [];
  const ai = { run: async (m, input) => { efforts.push(input.reasoning_effort); return { choices: [{ message: { content: efforts.length < 3 ? "" : "# Dokumen" } }] }; } };
  assert.equal(await runModel(ai, "deepseek", 'PROJECT MODE: you are not chatting now.\n1. Write the deliverable as ONE <document title="...">'), "# Dokumen");
  assert.deepEqual(efforts, ["high", "low", "none"]);
  efforts.length = 0;
  const first = { run: async (m, input) => { efforts.push(input.reasoning_effort); return { choices: [{ message: { content: "ok" } }] }; } };
  await runModel(first, "deepseek", 'PROJECT MODE: you are not chatting now.\n1. Write the deliverable as ONE <document title="...">');
  assert.deepEqual(efforts, ["high"], "an answer is never asked for twice");
});
