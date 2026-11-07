import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { createAccount } from "../account/account.js";
import { emailList, mayUseDeepseek, sessionUser, verifySession } from "../worker/access.js";

globalThis.__SKILLS__ = [];
const worker = (await import("../worker/pro.js")).default;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const SECRET = "session-secret-" + "x".repeat(40);
const NOW = Date.now();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// a session exactly as auth.situs.id makes it
async function session(email, { secret = SECRET, exp = NOW / 1000 + 3600 } = {}) {
  const body = b64url(new TextEncoder().encode(JSON.stringify({ sub: "g-1", email, name: "X", exp })));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))}`;
}
const ALLOWED = "hifebriansyah@gmail.com,febri.init@gmail.com";
const env = (o = {}) => ({ ALLOWED_ORIGINS: "https://pro.situs.id,http://localhost", SESSION_SECRET: SECRET, DEEPSEEK_EMAILS: ALLOWED, ...o });
const req = (path, { body, headers = {}, method = body ? "POST" : "GET", origin = "https://pro.situs.id" } = {}) =>
  new Request(`https://pro-worker.situs.id${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const run = (r, e = env()) => worker.fetch(r, e, { waitUntil() {} });
const cookie = async (email, o) => ({ Cookie: `situs_session=${await session(email, o)}` });

test("the session is read the way auth.situs.id writes it; forged, expired, another secret or no secret is nobody", async () => {
  assert.equal((await verifySession(await session("a@b.id"), SECRET))?.email, "a@b.id");
  const good = await session("a@b.id");
  assert.equal(await verifySession(good.slice(0, -3) + "AAA", SECRET), null, "forged");
  assert.equal(await verifySession(await session("a@b.id", { exp: NOW / 1000 - 5 }), SECRET), null, "expired");
  assert.equal(await verifySession(await session("a@b.id", { secret: "another-secret-" + "y".repeat(40) }), SECRET), null, "another secret");
  assert.equal(await verifySession(good, ""), null, "no secret on this Worker: nobody");
  assert.deepEqual(emailList({ DEEPSEEK_EMAILS: " A@B.id , c@d.id ,," }), ["a@b.id", "c@d.id"]);
  assert.equal(mayUseDeepseek({ email: "HIFEBRIANSYAH@gmail.com" }, env()), true, "case does not matter");
  for (const [user, e] of [[{ email: "x@gmail.com" }, env()], [null, env()], [{ email: "hifebriansyah@gmail.com" }, env({ DEEPSEEK_EMAILS: "" })], [{ email: "hifebriansyah@gmail.com" }, {}], [{ email: "hifebriansyah@gmail.com.evil.com" }, env()], [{ email: "a-hifebriansyah@gmail.com" }, env()]])
    assert.equal(mayUseDeepseek(user, e), false, JSON.stringify([user, e.DEEPSEEK_EMAILS]));
});

test("a request is recognised from the shared cookie; a Bearer token only counts from a page on this machine", async () => {
  const token = await session("febri.init@gmail.com");
  assert.equal((await sessionUser(req("/access", { headers: { Cookie: `situs_session=${token}` } }), env()))?.email, "febri.init@gmail.com");
  assert.equal((await sessionUser(req("/access", { origin: "http://localhost", headers: { Authorization: `Bearer ${token}` } }), env()))?.email, "febri.init@gmail.com");
  assert.equal(await sessionUser(req("/access", { origin: "https://pro.situs.id", headers: { Authorization: `Bearer ${token}` } }), env()), null, "a page of ours has the cookie, not a token");
  assert.equal(await sessionUser(req("/access", { origin: "http://evil.example", headers: { Authorization: `Bearer ${token}` } }), env()), null);
});

test("GET /access says whether DeepSeek is for this visitor: yes for the two accounts, no for everybody else", async () => {
  for (const email of ["hifebriansyah@gmail.com", "febri.init@gmail.com"]) {
    const res = await run(req("/access", { headers: await cookie(email) }));
    assert.deepEqual(await res.json(), { deepseek: true }, email);
    assert.equal(res.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://pro.situs.id");
  }
  assert.deepEqual(await (await run(req("/access", { headers: await cookie("orang.lain@gmail.com") }))).json(), { deepseek: false });
  assert.deepEqual(await (await run(req("/access"))).json(), { deepseek: false }, "not signed in");
  assert.deepEqual(await (await run(req("/access", { headers: await cookie("hifebriansyah@gmail.com", { exp: NOW / 1000 - 1 }) }))).json(), { deepseek: false }, "an expired session");
});

test("DeepSeek cannot be used by anybody else: chat and project are refused with 403 before anything is spent, whatever the page showed", async () => {
  const backend = [];
  const e = env({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: "s" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { backend.push(String(url)); return new Response("data: {\"type\":\"done\"}\n\n", { headers: { "Content-Type": "text/event-stream" } }); };
  try {
    const chat = { question: "Halo", deviceId: "d", provider: "deepseek" }, team = { goal: "Landing page toko kopi", provider: "deepseek" };
    const sneaky = '{"question":"Halo","provider":"\\u0064eepseek"}'; // the same word, written with an escape
    for (const [path, body] of [["/agent", chat], ["/team", team], ["/agent", sneaky]]) {
      for (const headers of [{}, await cookie("orang.lain@gmail.com"), await cookie("hifebriansyah@gmail.com", { secret: "another-secret-" + "y".repeat(40) }), await cookie("hifebriansyah@gmail.com", { exp: NOW / 1000 - 1 })]) {
        const res = await run(req(path, { body, headers }), e);
        assert.equal(res.status, 403, `${path} ${JSON.stringify(headers).slice(0, 30)}`);
        assert.match((await res.json()).error, /DeepSeek hanya untuk akun tertentu/);
      }
    }
    assert.deepEqual(backend, [], "nothing reached the backend");
    // the two accounts get through (to the backend)
    for (const email of ["hifebriansyah@gmail.com", "febri.init@gmail.com"]) {
      for (const [path, body] of [["/agent", chat], ["/team", team], ["/agent", sneaky]]) assert.equal((await run(req(path, { body, headers: await cookie(email) }), e)).status, 200, `${email} ${path}`);
    }
    assert.equal(backend.length, 6);
    // the free sources stay open to everybody
    for (const provider of ["islam", "quran"]) assert.equal((await run(req("/agent", { body: { question: "Halo", provider } }), e)).status, 200, provider);
  } finally { globalThis.fetch = realFetch; }
});

test("a page on localhost reaches DeepSeek the same way: with its token, and only the allowed account's", async () => {
  const e = env({ BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: "s" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("data: {\"type\":\"done\"}\n\n");
  try {
    const body = { question: "Halo", provider: "deepseek" };
    const ok = await run(req("/agent", { body, origin: "http://localhost", headers: { Authorization: `Bearer ${await session("febri.init@gmail.com")}` } }), e);
    assert.equal(ok.status, 200);
    const no = await run(req("/agent", { body, origin: "http://localhost", headers: { Authorization: `Bearer ${await session("orang.lain@gmail.com")}` } }), e);
    assert.equal(no.status, 403);
    assert.equal((await run(req("/agent", { body, origin: "http://localhost" }), e)).status, 403, "no token");
  } finally { globalThis.fetch = realFetch; }
});

test("the account module says who is asking: the cookie on situs.id, the Bearer token on localhost, and tells when who is signed in changes", async () => {
  const dom = new JSDOM(`<!doctype html><header><button id="theme"></button></header>`, { url: "https://pro.situs.id/" });
  let user = { name: "B", email: "hifebriansyah@gmail.com", picture: null };
  const fetchFn = async () => new Response(JSON.stringify({ user }));
  const acct = createAccount({ doc: dom.window.document, loc: dom.window.location, fetchFn });
  assert.deepEqual(acct.requestInit({ method: "POST" }), { method: "POST", credentials: "include" });
  const seen = [];
  acct.onChange = (u) => seen.push(u?.email ?? null);
  await acct.refresh(); await acct.refresh();
  user = null; await acct.refresh();
  assert.deepEqual(seen, ["hifebriansyah@gmail.com", null], "told once per change, not on every refresh");
  const store = new Map([["situs:session-token", "tok.en"]]);
  const local = createAccount({ doc: dom.window.document, loc: { hostname: "localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" }, fetchFn, storage: { getItem: (k) => store.get(k) ?? null, setItem() {}, removeItem() {} } });
  assert.deepEqual(local.requestInit({ headers: { "Content-Type": "application/json" } }), { headers: { "Content-Type": "application/json", Authorization: "Bearer tok.en" } });
});

test("the page: the DeepSeek option is not in the markup, it is added only when the Worker says so, and a sign-out or another account removes it", () => {
  assert.doesNotMatch(html, /<option value="deepseek">/, "nothing to see for a visitor who may not");
  assert.match(html, /o\.value = "deepseek"; o\.textContent = "DeepSeek"; sel\.append\(o\)/);
  assert.match(html, /fetch\(PROXY \+ "\/access", authInit\(\{\}\)\)/);
  assert.match(html, /v !== "deepseek" \|\| deepseekAllowed/, "it cannot even be chosen by a script");
  assert.match(html, /saved !== "deepseek"\) provider = saved/, "a saved DeepSeek choice waits for the Worker's answer");
  assert.match(html, /account\.onChange = \(\) => refreshAccess\(\)/);
  assert.match(html, /authInit\(\{ method: "POST", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(\{ deviceId: DEVICE_ID, question: prompt, persona, message: text\.trim\(\), provider, agent: c\.id \}\) \}\)\)/, "the chat request carries who is asking");
  assert.match(html, /fetch: \(url, init\) => fetch\(url, authInit\(init\)\)/, "and so does the project's");
});
