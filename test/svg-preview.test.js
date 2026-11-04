import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// The helpers that decide when an SVG gets a preview, and what the preview frame is given, run from index.html itself.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = (name) => new RegExp(`// <${name}>([\\s\\S]*?)// </${name}>`).exec(html)[1];
const sandbox = runInNewContext(`${grab("svg-detect")}${grab("mockup-frame")}; ({ extractSvgs, isSvg, frameHtml })`, {});
const extractSvgs = (t) => [...sandbox.extractSvgs(t)]; // copied into this realm, so deepStrictEqual accepts it

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><defs><mask id="m"><rect width="100%" height="100%" fill="white"/><circle cx="305" cy="295" r="59" fill="black"/></mask></defs><path d="M 140 110 L 250 110" fill="red" mask="url(#m)"/><circle cx="305" cy="295" r="48" fill="none" stroke="#fff" stroke-width="20"/></svg>';

test("extractSvgs: finds an SVG in a code fence, in plain text and in several places; ignores a mention in prose", () => {
  assert.deepEqual(extractSvgs("Ini logonya:\n\n```xml\n" + LOGO + "\n```\n\nSemoga cocok."), [LOGO]);
  assert.deepEqual(extractSvgs(LOGO), [LOGO]);
  assert.equal(extractSvgs(`satu ${LOGO} dua ${LOGO.replace("500", "100")}`).length, 2);
  assert.deepEqual(extractSvgs("Tag `<svg>` dipakai untuk gambar vektor, ditutup dengan </svg>."), []); // nothing drawn in it
  assert.deepEqual(extractSvgs("<svg></svg>"), []);
  assert.deepEqual(extractSvgs("tidak ada gambar di sini"), []);
  assert.equal(extractSvgs('<svg viewBox="0 0 10 10"></svg>').length, 1); // a viewBox is enough
  assert.equal(extractSvgs(`<svg viewBox="0 0 1 1"><path d="M0 0">${"x".repeat(200_000)}</path></svg>`)[0].length, 120_000); // capped
});

test("isSvg: only a page that starts with <svg", () => {
  assert.equal(sandbox.isSvg(LOGO), true);
  assert.equal(sandbox.isSvg("  \n<SVG viewBox='0 0 1 1'></SVG>"), true);
  assert.equal(sandbox.isSvg("<html><body><svg></svg></body></html>"), false);
  assert.equal(sandbox.isSvg("<h1>Hai</h1>"), false);
});

test("frameHtml: an SVG is centred on a background the page chooses, behind the policy, and the model cannot choose it", () => {
  const light = sandbox.frameHtml(LOGO);
  assert.match(light, /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"[^>]*><base target="_blank"><style>[^<]*place-items:center;background:#fff[^<]*<\/style><\/head><body><svg /);
  assert.match(sandbox.frameHtml(LOGO, "dark"), /background:#171920/);
  assert.match(sandbox.frameHtml(LOGO, "checker"), /conic-gradient/);
  assert.match(sandbox.frameHtml(LOGO, "red; } body { display:none"), /background:#fff/); // anything not on the list falls back to light
  assert.ok(light.includes('<mask id="m">') && light.includes("stroke-width=\"20\""), "the drawing is untouched");
});

test("frameHtml: a hostile SVG loses its script, handlers, frames and links", () => {
  const evil = '<svg viewBox="0 0 10 10" onload="parent.title=1"><script>parent.localStorage.clear()</script><a onclick="x()" href="https://evil.example"><rect width="5" height="5" onmouseover="y()"/></a><foreignObject><iframe src="https://evil.example"></iframe></foreignObject><image href="data:image/png;base64,AAAA"/></svg>';
  const out = sandbox.frameHtml(evil);
  for (const bad of [/<script/i, /<iframe/i, /\bonload\s*=/i, /\bonclick\s*=/i, /\bonmouseover\s*=/i, /localStorage/]) assert.doesNotMatch(out, bad, String(bad));
  assert.ok(out.includes('<rect width="5" height="5"/>') && out.includes('href="data:image/png;base64,AAAA"'), "harmless parts stay");
});

test("the mockup skill covers logos and SVG, and Kirana is told the page draws SVG for the user", () => {
  const skill = readFileSync(new URL("../skills/mockup-html/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /triggers:[^\n]*\blogo\b[^\n]*\bsvg\b/);
  assert.match(skill, /never answer "I cannot render or show this"/);
  const kirana = readFileSync(new URL("../personas/designer.md", import.meta.url), "utf8");
  assert.match(kirana, /SVG/);
  assert.match(kirana, /never say you cannot render or display something/);
});
