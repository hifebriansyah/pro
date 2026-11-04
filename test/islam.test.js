import assert from "node:assert/strict";
import { test } from "node:test";
import { ask, chat, parseSSE, stream } from "../src/islam.js";

async function collect(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}
async function* pieces(...p) {
  yield* p;
}

test("parseSSE: events split across chunks, JSON and plain data", async () => {
  const events = await collect(parseSSE(pieces('data: {"type":"chunk","te', 'xt":"Pu"}\n\ndata: {"type":"done"}\n\n', "data: plain\n\n")));
  assert.deepEqual(events, [{ type: "chunk", text: "Pu" }, { type: "done" }, "plain"]);
});

test("parseSSE: CRLF, comments and an unterminated last event", async () => {
  const events = await collect(parseSSE(pieces(': ping\r\n\r\ndata: {"a":1}\r\n\r\ndata: {"b":2}')));
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

// Live: needs the network. Skip with ISLAM_SKIP_LIVE=1 (npm run test:offline).
const live = { skip: process.env.ISLAM_SKIP_LIVE ? "ISLAM_SKIP_LIVE is set" : false, timeout: 90_000 };

test("live: POST /api/questions returns a shareId", live, async () => {
  const shareId = await ask("apa itu puasa");
  assert.match(shareId, /^[A-Za-z0-9]{8,}$/);
});

test("live: the stream sends references, chunks, then done", live, async () => {
  const types = new Set();
  for await (const ev of stream(await ask("apa itu puasa"))) types.add(ev.type);
  assert.deepEqual([...types].sort(), ["chunk", "done", "references"]);
});

test("live: chat() joins the chunks into an answer about puasa", live, async () => {
  const seen = [];
  const { text, references } = await chat("apa itu puasa", { onChunk: (t) => seen.push(t) });
  assert.ok(text.length > 50);
  assert.equal(seen.join(""), text);
  assert.match(text, /puasa|shaum|saum/i);
  assert.ok(Array.isArray(references));
});
