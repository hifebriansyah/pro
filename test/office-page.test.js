import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const office = (f) => readFileSync(new URL(`../office/${f}`, import.meta.url), "utf8");
const workflow = readdirSync(new URL("../.github/workflows/", import.meta.url)).map((f) => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8")).join("\n");

test("the page has the way in (Kantor), the office view with its 2-row top bar matching the chat sidebar width, stage and team bar, and the chat to dock", () => {
  assert.equal((html.match(/<nav class="modes[^"]*" data-modes/g) ?? []).length, 3, "the mode switcher in the chat list and in the top bars of the office and the project screen");
  for (const id of ["office", "of-view", "of-roster", "of-count", "of-theme"]) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const removed of ["of-pause", "of-reset", "of-zin", "of-zout"]) assert.doesNotMatch(html, new RegExp(`id="${removed}"`), `${removed} removed`);
  assert.match(html, /\.office > \.of-top \{[^}]*width: 380px; max-width: 40%/, "top bar matches chat sidebar width on desktop");
  assert.match(html, /@media \(max-width: 1024px\) \{\s*\.office > \.of-top \{ position: static; width: 100%; max-width: none;/, "full width on tablet and phone");
  assert.match(html, /<main class="chat">/);
  assert.match(html, /\.app\.office-mode \.side \{ display: none; \}/, "the chat list gives way to the office");
  assert.match(html, /\.app\.office-mode:not\(\.in-chat\) \.chat \{ display: none; \}/, "the chat docks only when somebody is chosen");
  assert.match(html, /\.app\.office-mode\.doc-open \.office \{ display: none; \}/, "a document or mockup takes the room");
});

test("three.js is loaded only when the office opens, from a pinned version the browser verifies; nothing else is fetched from outside", () => {
  assert.doesNotMatch(html.split("<style>")[0], /three/i, "not in the head");
  assert.doesNotMatch(html, /<script[^>]+src=/i, "no script tag loads anything at page load");
  const src = /const THREE_SRC = "([^"]+)"/.exec(html)?.[1], sri = /const THREE_SRI = "([^"]+)"/.exec(html)?.[1];
  assert.match(src, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r\d+\/three\.min\.js$/, "a pinned release on a CDN");
  assert.match(sri, /^sha512-[A-Za-z0-9+/]{86}==$/, "an integrity hash");
  assert.match(html, /sc\.integrity = THREE_SRI; sc\.crossOrigin = "anonymous"/);
  assert.match(html, /await import\("\.\/office\/office\.js"\)/, "the office code is imported on demand");
});

test("the office modules only import each other, and the deploy publishes the folder", () => {
  for (const f of ["core.js", "scene.js", "office.js"]) {
    for (const m of office(f).matchAll(/^import .* from "([^"]+)"/gm)) assert.match(m[1], /^\.\//, `${f} imports ${m[1]}: only relative files`);
  }
  assert.match(workflow, /cp -r personas icons office project account _site\//);
});

test("the modules load (no DOM, no THREE needed at load time) and export what the page uses", async () => {
  const core = await import("../office/core.js"), scene = await import("../office/scene.js"), off = await import("../office/office.js");
  assert.equal(typeof core.createSim, "function");
  assert.equal(typeof scene.buildWorld, "function");
  assert.equal(typeof scene.buildCharacter, "function");
  assert.equal(typeof scene.poseCharacter, "function");
  assert.equal(typeof off.createOffice, "function");
});

test("the page hands the office what it needs: who is working, what they are doing, who is being chatted with", () => {
  const fn = /function officeState\(id\) \{[\s\S]*?\n\}\n/.exec(html)?.[0] ?? "";
  assert.match(fn, /busy: busy\.has\(id\)/);
  assert.match(fn, /last\?\.pending \? last\.status : null/);
  assert.match(fn, /selected: state\.current === id/);
  assert.match(fn, /visit: visit\?\.to \?\? handoff/, "who they are visiting: to ask a question, or to hand a finished step over");
  assert.match(fn, /teamBusy\.get\(id\)/, "a team project has them writing a step");
  assert.match(html, /ev\.type === "consult"/, "the stream's consult events reach the office");
  assert.match(html, /onSelect: \(id\) => open\(id\)/);
  assert.match(html, /createOffice\(\{\s*THREE: window\.THREE, host: \$\("of-view"\), agents: AGENTS/);
});

test("regressions found in the browser: tags stay under the chat on a phone, the theme code does not touch the office before it exists", () => {
  assert.match(html, /\.of-view \{[^}]*isolation: isolate/, "the tags' depth order is contained");
  assert.match(html, /var office = null, officeLoading = null, officeOn = false, projectOn = false, projectView = null, officeReady = false;/, "var, because the theme code runs before this block");
  assert.match(html, /if \(officeReady\) paintOfficeTools\(\);/);
  assert.match(office("office.js"), /tag\.hidden = true;/, "a tag stays hidden until the first frame has placed it (no stack of tags in a corner)");
});

test("accessibility: every person has a real button with a label, the canvas is described, reduced motion is respected", () => {
  const o = office("office.js");
  assert.match(o, /document\.createElement\("button"\)/);
  assert.match(o, /setAttribute\("aria-label", `\$\{p\.agent\.name\}, \$\{p\.agent\.about\}/);
  assert.match(o, /canvas\.setAttribute\("aria-label"/);
  assert.match(o, /wander: !reduceMotion/);
  assert.match(html, /reduceMotion: reduceMotion\.matches/);
  assert.match(html, /prefers-reduced-motion: reduce\) \{ \.of-hint, \.of-spin/);
});
