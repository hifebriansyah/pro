import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// frameHtml decides what the preview iframe is given: run exactly the code that is in index.html (between <mockup-frame> markers).
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const block = /\/\/ <mockup-frame>([\s\S]*?)\/\/ <\/mockup-frame>/.exec(html)?.[1];
const { frameHtml, MOCKUP_CSP, MOCKUP_SANDBOX, MOCKUP_ALLOW } = runInNewContext(`${block}; ({ frameHtml, MOCKUP_CSP, MOCKUP_SANDBOX, MOCKUP_ALLOW })`, {});
const storageShimOf = (out) => /<script>\(function\(\)\{var d=([\s\S]*?)<\/script>/.exec(out)?.[0].slice(8, -9);

const page = '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Login</title><style>b{color:red}</style></head><body><b>Halo</b></body></html>';

test("frameHtml: a full page keeps its own head and content; only a charset, a new-tab base and the storage stand-in are put first", () => {
  const out = frameHtml(page);
  assert.match(out, /^<!doctype html><html lang="id"><head><meta charset="utf-8"><base target="_blank"><script>\(function\(\)/);
  assert.ok(out.includes("<style>b{color:red}</style>") && out.includes("<b>Halo</b>"));
  assert.ok(out.indexOf("(function(){var d=") < out.indexOf("<style>"), "the storage stand-in comes before anything the model wrote");
  assert.doesNotMatch(out, /Content-Security-Policy/, "an HTML mockup has no policy of ours: it can load and call anything");
});

test("frameHtml: a fragment, or a page without head or doctype, is wrapped into a page", () => {
  assert.match(frameHtml("<h1>Hai</h1>"), /^<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><script>[\s\S]*<\/script><meta name="viewport"[^>]*><\/head><body><h1>Hai<\/h1><\/body><\/html>$/);
  assert.match(frameHtml("<html><body>x</body></html>"), /^<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><script>[^]*?<\/script><\/head><body>x<\/body><\/html>$/);
});

test("frameHtml: an HTML mockup is passed through as the AI wrote it (scripts, libraries from any host, fonts, frames, handlers, forms)", () => {
  const wild = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script src="https://cdn.example.com/lib.js"></script><script>fetch("https://api.example.com/x").then(r => r.json())</script></head>
    <body onload="start()"><button onclick="go()">Klik</button><form action="https://example.com/post"><input name="a"></form>
    <iframe src="https://www.youtube.com/embed/x"></iframe><img src="https://images.example.com/a.jpg"></body></html>`;
  const out = frameHtml(wild);
  for (const kept of ["fonts.googleapis.com", "cdn.example.com/lib.js", 'fetch("https://api.example.com/x")', 'onload="start()"', 'onclick="go()"', 'action="https://example.com/post"', "youtube.com/embed/x", "images.example.com/a.jpg"]) {
    assert.ok(out.includes(kept), kept);
  }
});

test("the design: the frame may run anything, but has no same-origin, top navigation, storage access, camera, microphone or location", () => {
  for (const ok of ["allow-scripts", "allow-forms", "allow-popups", "allow-popups-to-escape-sandbox", "allow-modals", "allow-downloads"]) assert.ok(MOCKUP_SANDBOX.split(" ").includes(ok), ok);
  for (const never of ["allow-same-origin", "allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-storage-access-by-user-activation", "allow-orientation-lock"]) assert.ok(!MOCKUP_SANDBOX.split(" ").includes(never), never);
  assert.doesNotMatch(MOCKUP_ALLOW, /camera|microphone|geolocation|usb|serial|bluetooth/);
  assert.match(html, /frame\.setAttribute\("sandbox", svg \? "" : MOCKUP_SANDBOX\)/);
  assert.match(html, /frame\.allow = MOCKUP_ALLOW/);
});

test("an SVG (logo, icon) is the exception: no scripts, empty sandbox, strict policy", () => {
  assert.match(MOCKUP_CSP, /default-src 'none'/);
  assert.doesNotMatch(MOCKUP_CSP, /script-src|https?:|\*/);
  const out = frameHtml('<svg viewBox="0 0 1 1" onload="x()"><script>y()</script><rect width="1" height="1"/></svg>');
  assert.doesNotMatch(out, /<script|onload/i);
  assert.ok(out.includes(MOCKUP_CSP) && !out.includes("localStorage"));
});

test("storage stand-in: the saved data is embedded safely, and the shim behaves like localStorage and tells the page about changes", () => {
  const out = frameHtml("<p>x</p>", "light", { todo: "a</script><img src=x onerror=1>" });
  assert.doesNotMatch(out.replace(/<\/script>$/gm, ""), /a<\/script><img/, "a saved value cannot close the script tag");
  const sent = [];
  const win = { parent: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } };
  win.window = win;
  runInNewContext(storageShimOf(out).replace(/^<script>/, "").replace(/<\/script>$/, ""), { ...win, Object, String, JSON, parent: win.parent, window: win });
  const ls = win.localStorage;
  assert.equal(ls.getItem("todo"), "a</script><img src=x onerror=1>");
  assert.equal(ls.getItem("nope"), null);
  ls.setItem("n", 5);
  assert.equal(ls.getItem("n"), "5");
  assert.equal(ls.length, 2);
  assert.deepEqual(sent.at(-1), { mockupStorage: { todo: "a</script><img src=x onerror=1>", n: "5" } });
  ls.removeItem("todo"); ls.clear();
  assert.equal(ls.length, 0);
  win.sessionStorage.setItem("a", "b");
  assert.equal(win.sessionStorage.getItem("a"), "b");
  assert.equal(sent.at(-1).mockupStorage.a, undefined, "sessionStorage is not sent to the page");
});

test("the page keeps a mockup's storage only from the frame on screen, as strings, and capped", () => {
  assert.match(html, /e\.source !== mockFrame\.contentWindow/);
  assert.match(html, /typeof v === "string"/);
  assert.match(html, /json\.length > 100_000/);
});

test("on a phone the mockup panel is full screen like the Markdown viewer (.doc.wide must be overridden in the phone rules)", () => {
  const phone = /@media \(max-width: 760px\) \{([\s\S]*?)\n  \}/.exec(html)?.[1] ?? "";
  assert.match(phone, /\.doc \{ position: fixed; inset: 0;[^}]*width: 100%/);
  assert.match(phone, /\.doc\.wide \{ width: 100%; max-width: none; \}/); // .doc.wide is stronger than .doc, so .doc alone would leave 64% on a phone
});

test("storage stand-in: the saved data is embedded safely, and the shim behaves like localStorage and tells the page about changes", () => {
  const out = frameHtml("<p>x</p>", "light", { todo: "a</script><img src=x onerror=1>" });
  assert.doesNotMatch(out.replace(/<\/script>$/gm, ""), /a<\/script><img/, "a saved value cannot close the script tag");
  const sent = [];
  const win = { parent: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } };
  win.window = win;
  runInNewContext(storageShimOf(out).replace(/^<script>/, "").replace(/<\/script>$/, ""), { ...win, Object, String, JSON, parent: win.parent, window: win });
  const ls = win.localStorage;
  assert.equal(ls.getItem("todo"), "a</script><img src=x onerror=1>");
  assert.equal(ls.getItem("nope"), null);
  ls.setItem("n", 5);
  assert.equal(ls.getItem("n"), "5");
  assert.equal(ls.length, 2);
  assert.deepEqual(sent.at(-1), { mockupStorage: { todo: "a</script><img src=x onerror=1>", n: "5" } });
  ls.removeItem("todo"); ls.clear();
  assert.equal(ls.length, 0);
  win.sessionStorage.setItem("a", "b");
  assert.equal(win.sessionStorage.getItem("a"), "b");
  assert.equal(sent.at(-1).mockupStorage.a, undefined, "sessionStorage is not sent to the page");
  assert.ok(!frameHtml('<svg viewBox="0 0 1 1"></svg>').includes("localStorage"), "an SVG gets no shim");
});

test("the page keeps a mockup's storage only from the frame on screen, as strings, and capped", () => {
  assert.match(html, /e\.source !== mockFrame\.contentWindow/);
  assert.match(html, /typeof v === "string"/);
  assert.match(html, /json\.length > 100_000/);
});
