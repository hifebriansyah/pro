import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { adoptToken, avatarUrl, createAccount, fetchUser, isLocalHost, loginUrl, onSitus, signOut } from "../account/account.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const USER = { name: "Budi Santoso", email: "budi@contoh.id", picture: "https://lh3.googleusercontent.com/a/budi" };
const fakeFetch = (state) => async (url, init = {}) => {
  state.calls.push([String(url), init.method ?? "GET", init.credentials]);
  if (String(url).endsWith("/me")) return new Response(JSON.stringify({ user: state.user }), { status: 200 });
  if (String(url).endsWith("/logout")) { state.user = null; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  return new Response("{}", { status: 404 });
};
function page(hostname = "pro.situs.id") {
  const dom = new JSDOM(`<!doctype html><header><button id="theme"></button></header><header><button id="of-theme"></button></header>`, { url: `https://${hostname}/` });
  return { dom, doc: dom.window.document, loc: dom.window.location };
}

test("the pure parts: our hosts only, the sign-in address returns to the page, and only Google's photo addresses are used", () => {
  assert.ok(onSitus("situs.id") && onSitus("pro.situs.id") && onSitus("faith.situs.id"));
  for (const h of ["localhost", "127.0.0.1", "evilsitus.id", "situs.id.evil.com"]) assert.equal(onSitus(h), false, h);
  assert.equal(loginUrl("https://pro.situs.id/#proyek/abc"), "https://auth.situs.id/login?return=https%3A%2F%2Fpro.situs.id%2F%23proyek%2Fabc");
  assert.equal(avatarUrl("https://lh3.googleusercontent.com/a/x"), "https://lh3.googleusercontent.com/a/x");
  for (const bad of ["https://evil.com/a.png", "http://lh3.googleusercontent.com/a", "javascript:alert(1)", "", null, undefined]) assert.equal(avatarUrl(bad), null, String(bad));
});

test("fetchUser and signOut talk to auth.situs.id with the cookie, and a failure is just 'nobody'", async () => {
  const s = { user: USER, calls: [] };
  assert.deepEqual(await fetchUser(fakeFetch(s)), USER);
  assert.deepEqual(s.calls[0], ["https://auth.situs.id/me", "GET", "include"]);
  assert.equal(await signOut(fakeFetch(s)), true);
  assert.deepEqual(s.calls[1], ["https://auth.situs.id/logout", "POST", "include"]);
  assert.equal(await fetchUser(async () => { throw new Error("offline"); }), null);
  assert.equal(await fetchUser(async () => new Response("no", { status: 503 })), null);
  assert.equal((await fetchUser(fakeFetch({ user: { ...USER, picture: "https://evil.com/x.png" }, calls: [] }))).picture, null);
  assert.equal(await fetchUser(fakeFetch({ user: { name: "x" }, calls: [] })), null, "a user without an email is nobody");
});

test("signed out: a button with a user icon that sends the visitor to the sign-in, coming back to this page", async () => {
  const { doc, loc } = page();
  const s = { user: null, calls: [] };
  const acct = createAccount({ doc, loc, fetchFn: fakeFetch(s) });
  const b = acct.mount(doc.getElementById("theme"));
  assert.equal(b.nextElementSibling.id, "theme", "put before the theme button");
  await acct.refresh();
  assert.equal(b.title, "Masuk dengan Google");
  assert.ok(b.querySelector("svg") && !b.querySelector("img"));
  // jsdom cannot navigate: the page's location is stood in for by a plain object, whose href is where the visitor would be sent
  const here = { hostname: "pro.situs.id", href: "https://pro.situs.id/#proyek/abc" };
  const acct2 = createAccount({ doc, loc: here, fetchFn: fakeFetch(s) });
  const b2 = acct2.mount(doc.getElementById("of-theme"));
  await acct2.refresh();
  b2.click();
  assert.equal(here.href, "https://auth.situs.id/login?return=https%3A%2F%2Fpro.situs.id%2F%23proyek%2Fabc");
});

test("signed in: the photo (as text-safe markup), the name in the menu, and 'Keluar' signs out everywhere; every mounted button shows the same", async () => {
  const { doc, loc } = page();
  const s = { user: { ...USER, name: '<img src=x onerror=alert(1)>' }, calls: [] };
  const acct = createAccount({ doc, loc, fetchFn: fakeFetch(s) });
  const a = acct.mount(doc.getElementById("theme")), c = acct.mount(doc.getElementById("of-theme"));
  await acct.refresh();
  for (const b of [a, c]) { assert.equal(b.querySelector("img").src, USER.picture); assert.equal(b.querySelector("img").referrerPolicy, "no-referrer"); }
  a.click();
  const menu = doc.querySelector(".acct-menu");
  assert.equal(menu.querySelector("b").textContent, '<img src=x onerror=alert(1)>');
  assert.equal(menu.querySelectorAll("img").length, 0, "a name is text, never markup");
  assert.equal(menu.querySelector("span").textContent, USER.email);
  a.click();
  assert.equal(doc.querySelector(".acct-menu"), null, "the button again closes it");
  a.click();
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent("keydown", { key: "Escape" }));
  assert.equal(doc.querySelector(".acct-menu"), null, "Escape closes it");
  a.click();
  doc.querySelector(".acct-out").click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.user, null);
  for (const b of [a, c]) assert.equal(b.title, "Masuk dengan Google", "signed out on every button");
  assert.equal(doc.querySelector(".acct-menu"), null);
});

test("no photo: the first letter; another tab signing in is noticed when this one comes back into view; localhost gets no button at all", async () => {
  const { doc, loc, dom } = page();
  const s = { user: { name: "Citra", email: "c@x.id", picture: null }, calls: [] };
  const acct = createAccount({ doc, loc, fetchFn: fakeFetch(s) });
  const b = acct.mount(doc.getElementById("theme"));
  await acct.refresh();
  assert.equal(b.querySelector(".acct-initial").textContent, "C");
  s.user = null;
  Object.defineProperty(doc, "visibilityState", { configurable: true, get: () => "visible" });
  doc.dispatchEvent(new dom.window.Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(b.title, "Masuk dengan Google", "the sign-out in another tab shows here");
  const other = page("example.com");
  assert.equal(createAccount({ doc: other.doc, loc: other.loc, fetchFn: fakeFetch(s) }).mount(other.doc.getElementById("theme")), null, "not our host, not localhost: no button");
});

test("development: on localhost the button is there; the token the sign-in hands back is kept and taken out of the address, and /me is read with it", async () => {
  assert.ok(isLocalHost("localhost") && isLocalHost("127.0.0.1") && !isLocalHost("pro.situs.id") && !isLocalHost("localhost.evil.com"));
  const { doc } = page("localhost");
  const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const replaced = [];
  const loc = { hostname: "localhost", href: "http://localhost/for-fun/pro/#situs_token=abc.def-1", hash: "#situs_token=abc.def-1", pathname: "/for-fun/pro/", search: "?x=1" };
  const s = { user: USER, calls: [] };
  const seen = [];
  const fetchFn = async (url, init = {}) => { seen.push(init); return fakeFetch(s)(url, init); };
  const none = createAccount({ doc, loc: { hostname: "localhost", href: "http://localhost/", hash: "", pathname: "/", search: "" }, fetchFn, storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  none.mount(doc.getElementById("of-theme"));
  assert.equal(await none.refresh(), null);
  assert.equal(seen.length, 0, "localhost with no token asks nobody (a cookie request would be refused there)");
  const acct = createAccount({ doc, loc, fetchFn, storage, hist: { replaceState: (...a) => replaced.push(a) } });
  assert.equal(store.get("situs:session-token"), "abc.def-1");
  assert.deepEqual(replaced[0], [null, "", "/for-fun/pro/?x=1"], "the token leaves the address");
  const b = acct.mount(doc.getElementById("theme"));
  assert.ok(b, "a button on localhost");
  await acct.refresh();
  assert.deepEqual(seen[0], { headers: { Authorization: "Bearer abc.def-1" } }, "no cookie to send: the token is");
  assert.equal(b.title, "Akun: Budi Santoso");
  b.click();
  doc.querySelector(".acct-out").click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.has("situs:session-token"), false, "signing out forgets the token");
  assert.equal(adoptToken({ hash: "#proyek/abc", pathname: "/", search: "" }, storage, null), false, "any other address is left alone");
  assert.equal(adoptToken({ hash: "#situs_token=<script>", pathname: "/", search: "" }, storage, null), false, "only token characters");
});

test("the page mounts it before the theme button of the chat list, the office and the project screen, and the site ships the module", () => {
  assert.match(html, /import\("\.\/account\/account\.js"\)/);
  assert.match(html, /for \(const id of \["theme", "of-theme", "pj-theme"\]\) account\.mount\(document\.getElementById\(id\)\)/);
  assert.match(html, /\.acct-menu \{ position: fixed/);
  assert.match(readFileSync(new URL("../.github/workflows/static.yml", import.meta.url), "utf8"), /cp -r personas icons office project account _site\//);
});
