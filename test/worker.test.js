import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// what tools/deploy_worker.py fills in
globalThis.__SKILLS__ = [{ name: "writing-md", description: "Write docs", triggers: ["catatan"], body: "SKILL BODY" }, { name: "mockup-html", description: "Make mockups", triggers: ["mockup"], body: "MOCKUP BODY" }];
const worker = (await import("../worker/pro.js")).default;

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const ORIGIN = "https://pro.situs.id";
const baseEnv = { ALLOWED_ORIGINS: `${ORIGIN},http://localhost`, TIMEZONE_OFFSET_MINUTES: "420", AXIOM_TOKEN: "t", AXIOM_DATASET: "pro.test", AXIOM_URL: "https://axiom.test" };

/** A fake internet: islam-gpt.org answers from `replies` in order, DuckDuckGo refuses, Wikipedia finds one page, Axiom records its lines. */
function fakeNet(replies, { delayMs = 0 } = {}) {
  const net = { logs: [], prompts: [], devices: [] };
  const stream = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    if (url.endsWith("/api/questions")) {
      net.prompts.push(JSON.parse(init.body).question);
      net.devices.push(JSON.parse(init.body).deviceId);
      const id = "share" + stream.size + "xxxxxxxx";
      stream.set(id, replies.shift());
      return Response.json({ shareId: id });
    }
    if (url.includes("/api/stream/")) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); // a slow model
      const text = stream.get(url.split("/").pop());
      const sse = [{ type: "references", data: [] }, { type: "chunk", text }, { type: "done" }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.includes("duckduckgo.com")) return new Response("blocked", { status: 202 }); // the bot check
    if (url.includes("wikipedia.org/w/api.php")) return Response.json({ query: { search: [{ title: "Rukun Islam", snippet: "lima <span>rukun</span>" }] } });
    if (url.startsWith("https://axiom.test/")) { net.logs.push(...JSON.parse(init.body)); return new Response("{}"); }
    throw new Error("unexpected fetch " + url);
  };
  return net;
}

async function call(body, { env = baseEnv, origin = ORIGIN, method = "POST", path = "/agent" } = {}) {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const res = await worker.fetch(new Request("https://pro-worker.test" + path, { method, headers: { Origin: origin, "CF-Connecting-IP": "1.2.3.4" }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), env, ctx);
  const text = await res.text();
  await Promise.all(pending);
  return { res, text, events: text.split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(6))) }; // comment lines (": ping") are not events
}

test("worker: runs a tool through the keyless search fallback and streams the events, logging one line", async () => {
  const net = fakeNet(['TOOL: {"name":"web_search","args":{"query":"rukun islam"}}', "Ada lima rukun."]);
  const { res, events } = await call({ question: "User's first message: apa rukun islam?", message: "apa rukun islam?", persona: "You are Sinta, a QA engineer." });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual(events.map((e) => e.type + (e.phase ? ":" + e.phase : "")), ["tool:start", "tool:end", "chunk", "references", "done"]);
  assert.equal(events.find((e) => e.type === "chunk").text, "Ada lima rukun.");
  assert.match(net.prompts[1], /Rukun Islam/); // the Wikipedia result went back into the second prompt
  const line = net.logs.find((l) => l.kind === "agent");
  assert.deepEqual({ w: line.worker, a: line.agent, m: line.message, ip: line.ip, steps: line.steps, tools: line.tools }, { w: "pro", a: "Sinta", m: "apa rukun islam?", ip: "1.2.3.4", steps: 1, tools: [{ name: "web_search", arg: "rukun islam", via: "wikipedia" }] });
  assert.equal(line.chars, 15);
  assert.ok(!JSON.stringify(line).includes("Ada lima rukun"), "the answer text is not logged");
});

test("worker: the bundled skill is preloaded by its trigger word, and a document event is sent", async () => {
  const net = fakeNet(['Siap!\n<document title="Catatan">\n# Catatan\nisi\n</document>']);
  const { events } = await call({ question: "buatkan catatan", message: "buatkan catatan singkat" });
  assert.match(net.prompts[0], /Skill "writing-md" applies[\s\S]*SKILL BODY/);
  assert.deepEqual(events.find((e) => e.type === "document"), { type: "document", title: "Catatan", markdown: "# Catatan\nisi" });
  assert.equal(events.find((e) => e.type === "chunk").text, "Siap!");
});

test("worker: a mockup skill is preloaded by its trigger word, and a mockup event is sent", async () => {
  const net = fakeNet(['Ini mockup-nya.\n<mockup title="Beranda"><html><body><h1>Toko</h1></body></html></mockup>']);
  const { events } = await call({ question: "buatkan mockup beranda", message: "buatkan mockup beranda toko" });
  assert.match(net.prompts[0], /Skill "mockup-html" applies[\s\S]*MOCKUP BODY/);
  assert.doesNotMatch(net.prompts[0], /SKILL BODY/); // the other skill's words are not in the message
  assert.deepEqual(events.find((e) => e.type === "mockup"), { type: "mockup", title: "Beranda", html: "<html><body><h1>Toko</h1></body></html>" });
  assert.equal(events.find((e) => e.type === "chunk").text, "Ini mockup-nya.");
  assert.equal(net.logs.find((l) => l.kind === "agent").mockups, 1);
});

test("worker: a document cut off by islam-gpt is carried on and sent as one; slow parts get keepalive comments; the status says which part", async () => {
  const net = fakeNet(['Ini PRD-nya.\n<document title="PRD">\n# PRD\n\n## Latar\nSatu dua ', "tiga.\n\n## Tujuan\nSatu.\n</document>"], { delayMs: 60 });
  const { text, events } = await call({ question: "buatkan PRD", message: "buatkan catatan PRD" }, { env: { ...baseEnv, KEEPALIVE_MS: "10" } });
  assert.ok(text.includes(": ping"), "a comment line was sent while the model was slow");
  assert.deepEqual(events.find((e) => e.type === "document"), { type: "document", title: "PRD", markdown: "# PRD\n\n## Latar\nSatu dua tiga.\n\n## Tujuan\nSatu." });
  assert.deepEqual(events.filter((e) => e.type === "tool").map((e) => [e.phase, e.name, e.args.part]), [["start", "continue", 2], ["end", "continue", 2]]);
  assert.equal(net.prompts.length, 2);
  assert.match(net.prompts[1], /cut off by a length limit/);
  assert.deepEqual(net.logs.find((l) => l.kind === "agent").tools, [{ name: "continue", arg: "part 2" }]);
});

test("worker: refuses other origins, preflight follows the origin, unknown paths, bad bodies", async () => {
  fakeNet([]);
  assert.equal((await call({ question: "x" }, { origin: "https://evil.example" })).res.status, 403);
  assert.equal((await call(null, { method: "OPTIONS" })).res.status, 204);
  assert.equal((await call(null, { method: "OPTIONS", origin: "https://evil.example" })).res.status, 403);
  assert.equal((await call({ question: "x" }, { path: "/other" })).res.status, 404);
  assert.equal((await call("not json")).res.status, 400);
  assert.equal((await call({ question: "   " })).res.status, 400);
  assert.equal((await call({ question: "x".repeat(25_000) })).res.status, 413);
  assert.notEqual((await call({ question: "x" }, { origin: "http://localhost:8080" })).res.status, 403); // a localhost port is allowed
});

test("worker: the rate limits answer 429 before any work is done", async () => {
  const net = fakeNet([]);
  const deny = { limit: async () => ({ success: false }) }, allow = { limit: async () => ({ success: true }) };
  const one = await call({ question: "x" }, { env: { ...baseEnv, LIMITER: deny } });
  assert.equal(one.res.status, 429);
  assert.match(one.text, /too many questions/);
  const all = await call({ question: "x" }, { env: { ...baseEnv, LIMITER: allow, LIMITER_ALL: deny } });
  assert.equal(all.res.status, 429);
  assert.equal(net.prompts.length, 0);
  assert.ok(net.logs.some((l) => l.kind === "request" && l.status === 429));
});

test("worker: an islam-gpt failure becomes an error event, then done", async () => {
  globalThis.fetch = async (input) => (String(input?.url ?? input).startsWith("https://axiom") ? new Response("{}") : new Response("down", { status: 502 }));
  const { events } = await call({ question: "x" });
  assert.deepEqual(events.map((e) => e.type), ["error", "done"]);
  assert.match(events[0].message, /502/);
});

test("worker: loading the modules does no I/O, timers or random values (Workers refuse them in the global scope)", async () => {
  const { execFileSync } = await import("node:child_process");
  const url = new URL("../worker/pro.js", import.meta.url).href;
  const code = `
    globalThis.__SKILLS__ = [];
    const boom = (what) => () => { throw new Error(what + " called while loading"); };
    globalThis.fetch = boom("fetch"); globalThis.setTimeout = boom("setTimeout"); globalThis.setInterval = boom("setInterval");
    crypto.getRandomValues = boom("crypto.getRandomValues"); Math.random = boom("Math.random");
    const m = await import(${JSON.stringify(url)});
    if (typeof m.default.fetch !== "function") throw new Error("no fetch handler");`;
  execFileSync(process.execPath, ["--input-type=module", "-e", code], { stdio: "pipe" }); // throws with the message when a module does one of them
});

test("worker: a request without a deviceId gets its own random one (shared by the parts of that answer), and a sent one is used as is", async () => {
  const net = fakeNet(["Satu.", "Dua.", '<document title="A">\n# A\nx ', "y\n</document>", "Empat."]);
  await call({ question: "x" });
  await call({ question: "x" });
  await call({ question: "dokumen", message: "dokumen" });
  await call({ question: "x", deviceId: "abc123" });
  assert.equal(net.devices.length, 5);
  assert.match(net.devices[0], /^[A-Za-z0-9]{24}$/);
  assert.notEqual(net.devices[0], net.devices[1], "two requests, two ids");
  assert.equal(net.devices[2], net.devices[3], "the first part and its continuation use one id");
  assert.equal(net.devices[4], "abc123");
});

test("worker: a typical request uses little CPU on a cold start (the free plan kills a request at about 10 ms of CPU: it was 503 for ordinary messages)", async () => {
  const { execFileSync } = await import("node:child_process");
  const here = (p) => JSON.stringify(new URL(p, import.meta.url).href);
  const code = `
    import { loadSkills } from ${here("../src/skills-fs.js")};
    globalThis.__SKILLS__ = [...loadSkills().values()];
    const refs = JSON.stringify({ type: "references", data: Array.from({ length: 4 }, (_, i) => ({ source: "S" + i, content: "x".repeat(900) })) });
    const answer = "Test case adalah satu set kondisi, langkah, dan hasil yang diharapkan untuk memeriksa sebuah fitur. ".repeat(12);
    const sse = [refs, ...[...answer].map((c) => JSON.stringify({ type: "chunk", text: c })), '{"type":"done"}'].map((d) => "data: " + d).join("\\n\\n") + "\\n\\n";
    globalThis.fetch = async (u) => String(u).endsWith("/api/questions") ? Response.json({ shareId: "abcdefgh12345678" }) : new Response(sse);
    const worker = (await import(${here("../worker/pro.js")})).default;
    const persona = "You are Sinta, a QA engineer. ".repeat(80);
    const env = { ALLOWED_ORIGINS: "https://pro.situs.id", TIMEZONE_OFFSET_MINUTES: "420" };
    const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
    // Node loads its fetch, Request and Response code lazily on first use (about 11 ms); a Worker has them built in. Touch them before timing, so only our code is measured.
    new Request("https://w/"); new Response("x"); Response.json({}); new TransformStream(); new TextEncoder(); new AbortController(); AbortSignal.timeout(1); crypto.getRandomValues(new Uint8Array(4));
    const t = cpu();
    const pending = [];
    const res = await worker.fetch(new Request("https://w/agent", { method: "POST", headers: { Origin: "https://pro.situs.id" }, body: JSON.stringify({ deviceId: "x", question: "Halo, apa itu test case?", message: "Halo, apa itu test case?", persona }) }), env, { waitUntil: (p) => pending.push(p) });
    const text = await res.text(); await Promise.all(pending);
    console.log(JSON.stringify({ ms: cpu() - t, ok: text.includes('"type":"chunk"') && text.includes("Test case adalah") }));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }));
  assert.ok(out.ok, "the request still produced the answer");
  assert.ok(out.ms < 8, `a cold request took ${out.ms.toFixed(1)} ms of CPU`);
});

test("worker: AXIOM_LOG=0 sends no log lines (and costs no subrequest); otherwise a line per question", async () => {
  const off = fakeNet(["Satu."]);
  await call({ question: "x" }, { env: { ...baseEnv, AXIOM_LOG: "0" } });
  await call({ question: "x" }, { env: { ...baseEnv, AXIOM_LOG: "0" }, origin: "https://evil.example" }); // refused requests are not logged either
  assert.equal(off.logs.length, 0);
  const on = fakeNet(["Dua."]);
  await call({ question: "x" });
  assert.ok(on.logs.some((l) => l.kind === "agent"));
});

// ---- publishing a page: one project = one folder in the R2 bucket ----
function fakeBucket() {
  const m = new Map();
  return { m,
    head: async (k) => (m.has(k) ? { customMetadata: m.get(k).meta } : null),
    get: async (k) => (m.has(k) ? { body: m.get(k).body } : null),
    put: async (k, body, o) => { m.set(k, { body, meta: o.customMetadata }); },
    delete: async (k) => { m.delete(k); } };
}
const pubCall = (path, body, env) => worker.fetch(new Request(`https://w.test${path}`, { method: "POST", headers: { Origin: "https://pro.situs.id", "Content-Type": "application/json" }, body: JSON.stringify(body) }), { ALLOWED_ORIGINS: "https://pro.situs.id", ...env }, { waitUntil() {} });
const HTML = "<!doctype html><html><body><h1>Halo</h1></body></html>";
const TOK = "a".repeat(32);

test("publish: the first time makes a folder, a revision with the same token overwrites the same one", async () => {
  const SITES = fakeBucket();
  const a = await (await pubCall("/publish", { token: TOK, html: HTML }, { SITES })).json();
  assert.match(a.id, /^[a-z0-9]{12}$/);
  assert.equal(a.url, `https://w.test/p/${a.id}/`);
  const b = await (await pubCall("/publish", { id: a.id, token: TOK, html: HTML + "<!--v2-->" }, { SITES })).json();
  assert.equal(b.id, a.id);
  assert.deepEqual([...SITES.m.keys()], [`${a.id}/index.html`]);
  assert.equal(SITES.m.get(`${a.id}/index.html`).body, HTML + "<!--v2-->");
});

test("publish: someone else's token cannot overwrite or remove a folder; the token itself is never stored", async () => {
  const SITES = fakeBucket();
  const a = await (await pubCall("/publish", { token: TOK, html: HTML }, { SITES })).json();
  assert.equal((await pubCall("/publish", { id: a.id, token: "b".repeat(32), html: HTML }, { SITES })).status, 403);
  assert.equal((await pubCall("/unpublish", { id: a.id, token: "b".repeat(32) }, { SITES })).status, 403);
  assert.ok(!JSON.stringify(SITES.m.get(`${a.id}/index.html`).meta).includes(TOK));
  assert.equal((await pubCall("/unpublish", { id: a.id, token: TOK }, { SITES })).status, 200);
  assert.equal(SITES.m.size, 0);
});

test("publish: refuses empty, too large, bad token, no bucket, wrong origin; is rate limited", async () => {
  const SITES = fakeBucket();
  assert.equal((await pubCall("/publish", { token: TOK, html: "" }, { SITES })).status, 400);
  assert.equal((await pubCall("/publish", { token: TOK, html: "x".repeat(500_001) }, { SITES })).status, 413);
  assert.equal((await pubCall("/publish", { token: "short", html: HTML }, { SITES })).status, 400);
  assert.equal((await pubCall("/publish", { token: TOK, html: HTML }, {})).status, 503);
  assert.equal((await pubCall("/publish", { token: TOK, html: HTML }, { SITES, LIMITER_PUBLISH: { limit: async () => ({ success: false }) } })).status, 429);
  const bad = await worker.fetch(new Request("https://w.test/publish", { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" }), { ALLOWED_ORIGINS: "https://pro.situs.id", SITES }, { waitUntil() {} });
  assert.equal(bad.status, 403);
});

test("GET /p/<id>/ serves the page to anybody, sandboxed and not indexed; a missing one is 404", async () => {
  const SITES = fakeBucket();
  const a = await (await pubCall("/publish", { token: TOK, html: HTML }, { SITES })).json();
  const res = await worker.fetch(new Request(`https://w.test/p/${a.id}/`), { ALLOWED_ORIGINS: "https://pro.situs.id", SITES }, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), HTML);
  assert.match(res.headers.get("Content-Security-Policy"), /^sandbox allow-scripts/);
  assert.doesNotMatch(res.headers.get("Content-Security-Policy"), /allow-same-origin/);
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal((await worker.fetch(new Request("https://w.test/p/zzzzzzzzzzzz/"), { SITES }, { waitUntil() {} })).status, 404);
});
