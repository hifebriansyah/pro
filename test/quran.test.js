import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { quranChat } from "../src/quran.js";
import { parseAgentBody, runAgent } from "../src/serve.js";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

test("quranChat: posts {prompt} and returns {text, references}", async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), body: JSON.parse(init.body) }; return Response.json({ response: " Halo ", provider: "openai" }); };
  assert.deepEqual(await quranChat("Hai"), { text: "Halo", references: [] });
  assert.match(seen.url, /quran-gpt\.netlify\.app\/api\/gemini$/);
  assert.deepEqual(seen.body, { prompt: "Hai" });
});

test("quranChat: retries a 5xx once, but not a 4xx or an empty answer", async () => {
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? new Response("x", { status: 503 }) : Response.json({ response: "ok" }));
  assert.equal((await quranChat("a")).text, "ok");
  n = 0; globalThis.fetch = async () => { n++; return new Response("x", { status: 400 }); };
  await assert.rejects(quranChat("a"), /HTTP 400/); assert.equal(n, 1);
  n = 0; globalThis.fetch = async () => { n++; return Response.json({ response: "" }); };
  await assert.rejects(quranChat("a"), /empty/); assert.equal(n, 1);
  n = 0; globalThis.fetch = async () => { n++; return new Response("x", { status: 500 }); };
  await assert.rejects(quranChat("a"), /HTTP 500/); assert.equal(n, 2);
});

test("parseAgentBody: provider is islam unless quran is asked for", () => {
  assert.equal(parseAgentBody('{"question":"a"}').provider, "islam");
  assert.equal(parseAgentBody('{"question":"a","provider":"quran"}').provider, "quran");
  assert.equal(parseAgentBody('{"question":"a","provider":"evil"}').provider, "islam");
});

test("runAgent: provider quran answers from quran-gpt, islam from islam-gpt", async () => {
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input); urls.push(url);
    if (url.includes("quran-gpt")) return Response.json({ response: "jawaban quran" });
    if (url.endsWith("/api/questions")) return Response.json({ shareId: "shareabcdefgh" });
    return new Response(`data: ${JSON.stringify({ type: "chunk", text: "jawaban islam" })}\n\ndata: {"type":"done"}\n\n`);
  };
  for (const [provider, want] of [["quran", "jawaban quran"], ["islam", "jawaban islam"]]) {
    const events = [];
    await runAgent({ question: "Halo", message: "Halo", persona: "", provider }, { send: (e) => events.push(e) });
    assert.ok(events.some((e) => e.type === "chunk" && e.text.includes(want)), provider);
  }
  assert.ok(urls.some((u) => u.includes("quran-gpt")) && urls.some((u) => u.includes("islam-gpt")));
});
