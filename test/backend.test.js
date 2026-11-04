import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { backendHandle, sameSecret } from "../src/backend.js";

globalThis.__SKILLS__ = [];
const worker = (await import("../worker/pro.js")).default;
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const SECRET = "s3cret-value";
const req = (body, headers = {}, method = "POST") => new Request("https://api.test/agent", { method, headers: { "x-pro-secret": SECRET, ...headers }, body: method === "POST" ? JSON.stringify(body) : undefined });
const chatFn = async () => ({ text: "Halo dari backend", references: [] });
const events = (text) => text.split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(6)));

test("sameSecret: equal only when identical", () => {
  assert.ok(sameSecret("abc", "abc"));
  for (const [a, b] of [["abc", "abd"], ["abc", "ab"], ["", "x"], [null, "x"], [undefined, ""]]) assert.ok(!sameSecret(a, b) || (a ?? "") === b);
  assert.ok(!sameSecret("abc", "abcd"));
});

test("backend: no secret configured refuses everything; a wrong or missing secret is 401", async () => {
  assert.equal((await backendHandle(req({ message: "hi" }), {})).status, 503);
  assert.equal((await backendHandle(req({ message: "hi" }, { "x-pro-secret": "nope" }), { PROXY_SECRET: SECRET })).status, 401);
  assert.equal((await backendHandle(new Request("https://api.test/agent", { method: "POST", body: "{}" }), { PROXY_SECRET: SECRET })).status, 401);
  assert.equal((await backendHandle(req(null, {}, "GET"), { PROXY_SECRET: SECRET })).status, 405);
});

test("backend: the right secret streams the events", async () => {
  const res = await backendHandle(req({ question: "Halo", message: "Halo", persona: "You are Kirana." }), { PROXY_SECRET: SECRET, TIMEZONE_OFFSET_MINUTES: "420" }, { chatFn });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /event-stream/);
  const ev = events(await res.text());
  assert.ok(ev.some((e) => e.type === "chunk" && /Halo dari backend/.test(e.text)));
  assert.equal(ev.at(-1).type, "done");
});

test("backend: too large and bad bodies", async () => {
  const env = { PROXY_SECRET: SECRET };
  assert.equal((await backendHandle(new Request("https://api.test/agent", { method: "POST", headers: { "x-pro-secret": SECRET }, body: "x".repeat(25_000) }), env)).status, 413);
  assert.equal((await backendHandle(new Request("https://api.test/agent", { method: "POST", headers: { "x-pro-secret": SECRET }, body: "not json" }), env)).status, 400);
});

const ORIGIN = "https://pro.situs.id";
const gate = async (env, body = { question: "Halo", message: "Halo", persona: "You are Kirana." }) => {
  const pending = [];
  const res = await worker.fetch(new Request("https://pro-worker.test/agent", { method: "POST", headers: { Origin: ORIGIN, "CF-Connecting-IP": "1.2.3.4" }, body: JSON.stringify(body) }), { ALLOWED_ORIGINS: ORIGIN, ...env }, { waitUntil: (p) => pending.push(p) });
  const text = await res.text();
  await Promise.all(pending);
  return { res, text };
};

test("gateway: the Worker forwards to the backend with the secret and adds CORS", async () => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), headers: init.headers, body: init.body }; return new Response('data: {"type":"chunk","text":"dari backend"}\n\ndata: {"type":"done"}\n\n', { headers: { "Content-Type": "text/event-stream" } }); };
  const { res, text } = await gate({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET });
  assert.equal(seen.url, "https://api.test/agent");
  assert.equal(seen.headers["x-pro-secret"], SECRET);
  assert.equal(JSON.parse(seen.body).message, "Halo");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(text, /dari backend/);
});

test("gateway: the rate limit and the origin check still come first (the backend is never called)", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("x"); };
  const limited = await gate({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET, LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(limited.res.status, 429);
  const bad = await worker.fetch(new Request("https://pro-worker.test/agent", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }), { ALLOWED_ORIGINS: ORIGIN, BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET }, { waitUntil() {} });
  assert.equal(bad.status, 403);
  assert.equal(calls, 0);
});

test("gateway: a backend that is down or errors falls back to the work done in the Worker", async () => {
  const fake = (backend) => async (input, init = {}) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("https://api.test/")) return backend();
    if (url.endsWith("/api/questions")) return Response.json({ shareId: "shareabcdefgh" });
    if (url.includes("/api/stream/")) return new Response(`data: ${JSON.stringify({ type: "chunk", text: "jawaban lokal" })}\n\ndata: {"type":"done"}\n\n`);
    throw new Error("unexpected " + url);
  };
  for (const backend of [() => { throw new TypeError("fetch failed"); }, () => new Response("boom", { status: 502 })]) {
    globalThis.fetch = fake(backend);
    const { text } = await gate({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET });
    assert.match(text, /jawaban lokal/);
  }
});

test("gateway: off without the secret (the Worker works locally as before)", async () => {
  let backendCalled = false;
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("https://api.test/")) { backendCalled = true; return new Response("x"); }
    if (url.endsWith("/api/questions")) return Response.json({ shareId: "shareabcdefgh" });
    return new Response(`data: ${JSON.stringify({ type: "chunk", text: "lokal" })}\n\ndata: {"type":"done"}\n\n`);
  };
  const { text } = await gate({ BACKEND_URL: "https://api.test/agent" });
  assert.ok(!backendCalled);
  assert.match(text, /lokal/);
});

test("gateway: passing a long answer through costs the Worker almost no CPU (the free plan allows about 10 ms)", async () => {
  const sse = Array.from({ length: 40 }, (_, i) => `data: ${JSON.stringify({ type: "chunk", text: "x".repeat(500) + i })}\n\n`).join("") + 'data: {"type":"done"}\n\n';
  globalThis.fetch = async () => new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
  await gate({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET });            // warm up lazy loading in Node, which a Worker does not pay
  const before = process.cpuUsage();
  const { text } = await gate({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: SECRET });
  const used = process.cpuUsage(before);
  assert.ok(text.length > 20_000);
  assert.ok((used.user + used.system) / 1000 < 8, `gateway used ${(used.user + used.system) / 1000} ms of CPU`);
});
