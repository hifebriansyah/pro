import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// frameHtml decides what the preview iframe is given: run exactly the code that is in index.html (between <mockup-frame> markers).
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const block = /\/\/ <mockup-frame>([\s\S]*?)\/\/ <\/mockup-frame>/.exec(html)?.[1];
const { frameHtml, MOCKUP_CSP, MOCKUP_CSP_SCRIPTS } = runInNewContext(`${block}; ({ frameHtml, MOCKUP_CSP, MOCKUP_CSP_SCRIPTS })`, {});

const page = '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Login</title><style>b{color:red}</style></head><body><b>Halo</b></body></html>';

test("frameHtml: a full page gets the policy first in its head, keeps its own style and content", () => {
  const out = frameHtml(page);
  assert.match(out, /^<!doctype html><html lang="id"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
  assert.ok(out.includes(MOCKUP_CSP));
  assert.ok(out.includes("<style>b{color:red}</style>") && out.includes("<b>Halo</b>"));
  assert.ok(out.indexOf("Content-Security-Policy") < out.indexOf("<style>"), "the policy comes before anything the model wrote");
});

test("frameHtml: a fragment, or a page without head or doctype, is wrapped into a page with the policy", () => {
  assert.match(frameHtml("<h1>Hai</h1>"), /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"[\s\S]*<body><h1>Hai<\/h1><\/body><\/html>$/);
  const noHead = frameHtml("<html><body>x</body></html>");
  assert.match(noHead, /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"[^>]*><base target="_blank"><\/head><body>x<\/body><\/html>$/);
});

test("frameHtml: frames, objects, links, base, meta refresh and external scripts are removed; the page's own inline script and handlers stay", () => {
  const evil = `<!doctype html><html><head>
    <script>document.title = "clock"</script><SCRIPT src="https://evil.example/x.js"></SCRIPT><script src=//evil/x.js>
    <meta http-equiv="refresh" content="0;url=https://evil.example"><META HTTP-EQUIV='Refresh' content='1'>
    <base href="https://evil.example/"><link rel="stylesheet" href="https://evil.example/a.css">
  </head><body onload="start()"><button onclick='toggle()' class="ok">Klik</button>
    <iframe src="https://evil.example"></iframe><object data="x"></object><embed src="y"><img src="data:image/png;base64,AAAA" alt="">
  </body></html>`;
  const out = frameHtml(evil);
  for (const bad of [/<iframe/i, /<object/i, /<embed/i, /<link/i, /evil\.example/i, /http-equiv="refresh"/i, /http-equiv='refresh'/i, /<base href/i]) {
    assert.doesNotMatch(out, bad, String(bad));
  }
  assert.ok(out.includes('document.title = "clock"'), "an inline script stays: a clock or a toggle needs it");
  assert.ok(out.includes('onclick=\'toggle()\'') && out.includes('onload="start()"'), "handlers stay");
  assert.ok(out.includes('class="ok">Klik</button>') && out.includes('src="data:image/png;base64,AAAA"'), "harmless content stays");
  assert.equal((out.match(/Content-Security-Policy/g) ?? []).length, 1, "only our policy");
  assert.ok(out.includes(MOCKUP_CSP_SCRIPTS), "an HTML mockup gets the policy that allows inline scripts");
});

test("the policy: inline styles, data: pictures, and for an HTML mockup inline scripts; never a network, a form or another origin", () => {
  assert.match(MOCKUP_CSP, /default-src 'none'/);
  assert.match(MOCKUP_CSP, /style-src 'unsafe-inline'/);
  assert.match(MOCKUP_CSP, /img-src data:/);
  assert.match(MOCKUP_CSP, /form-action 'none'/);
  assert.doesNotMatch(MOCKUP_CSP, /script-src|https?:|\*/);
  assert.match(MOCKUP_CSP_SCRIPTS, /script-src 'unsafe-inline'/);
  assert.doesNotMatch(MOCKUP_CSP_SCRIPTS, /https?:|\*|connect-src|frame-src|'unsafe-eval'/); // default-src 'none' keeps fetch, sockets, frames and workers blocked
});

test("the page sandboxes the preview: allow-scripts for an HTML mockup, never allow-same-origin, and nothing at all for an SVG", () => {
  assert.match(html, /frame\.setAttribute\("sandbox", docView\.svg \|\| isSvg\(docView\.html\) \? "" : "allow-scripts"\)/);
  assert.doesNotMatch(html, /allow-same-origin|allow-popups|allow-top-navigation|allow-forms/);
  assert.ok(!frameHtml('<svg viewBox="0 0 1 1" onload="x()"><script>y()</script></svg>').match(/<script|onload/i), "an SVG has no code");
  assert.ok(frameHtml('<svg viewBox="0 0 1 1"></svg>').includes(MOCKUP_CSP) && !frameHtml('<svg viewBox="0 0 1 1"></svg>').includes("script-src"));
});

test("on a phone the mockup panel is full screen like the Markdown viewer (.doc.wide must be overridden in the phone rules)", () => {
  const phone = /@media \(max-width: 760px\) \{([\s\S]*?)\n  \}/.exec(html)?.[1] ?? "";
  assert.match(phone, /\.doc \{ position: fixed; inset: 0;[^}]*width: 100%/);
  assert.match(phone, /\.doc\.wide \{ width: 100%; max-width: none; \}/); // .doc.wide is stronger than .doc, so .doc alone would leave 64% on a phone
});
