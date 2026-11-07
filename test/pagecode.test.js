import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPersonas } from "../src/personas-fs.js";
import { assemble, bareCode, checkPage, inlineScripts, lastScript, missingIds, outlineOf, pageProblem, scriptProblem } from "../src/pagecode.js";
import { parseTeamBody, runTeam } from "../src/team.js";

const PAGE = `<!doctype html><html><head><title>Toko Kucing</title></head><body><header id="site"><button id="menu-btn">Menu</button></header><h1>Halo</h1><form id="contact"><input name="email" type="email"></form></body></html>`;

test("scriptProblem: a script that compiles is fine, a missing bracket is named; nothing is run", () => {
  assert.equal(scriptProblem("const a = (1 + 2);"), null);
  assert.match(scriptProblem("foo(1, 2;"), /Unexpected|missing/i);
  globalThis.__ran = false;
  scriptProblem("globalThis.__ran = true;");
  assert.equal(globalThis.__ran, false, "it only compiles");
});

test("assemble: the script goes before </body>, a closing script tag inside it cannot break out; bareCode strips fences and tags", () => {
  const out = assemble(PAGE, 'const s = "</script>";');
  assert.ok(out.indexOf("<script>") > out.indexOf("</header>") && out.indexOf("<script>") < out.indexOf("</body>"));
  assert.equal(inlineScripts(out).length, 1);
  assert.equal(pageProblem(out), null, "the escaped </script> keeps the script whole");
  assert.equal(bareCode("```js\nconst a = 1;\n```"), "const a = 1;");
  assert.equal(bareCode("<script>\nconst a = 1;\n</script>"), "const a = 1;");
  assert.equal(lastScript(out).includes("const s"), true);
});

test("outlineOf: the hooks a script can use, and whether its script compiles", () => {
  const o = outlineOf(PAGE);
  assert.match(o, /title: Toko Kucing/);
  assert.match(o, /ids: site, menu-btn, contact/);
  assert.match(o, /form fields: input:email email/);
  assert.match(o, /buttons: Menu/);
  assert.match(outlineOf(assemble(PAGE, "foo(1, 2;")), /SYNTAX ERROR, the script does not run/);
  assert.match(outlineOf(assemble(PAGE, "const a = 1;")), /they compile/);
  assert.deepEqual(missingIds(assemble(PAGE, "document.getElementById('contact'); document.querySelector('#gone'); const p = document.createElement('p'); p.id = 'made'; document.getElementById('made');")), ["gone"]);
  assert.match(outlineOf(assemble(PAGE, "document.getElementById('gone');")), /ids that are not on the page: gone/);
});

const personas = loadPersonas();
const run = async (replyFor) => {
  const events = [], prompts = [];
  const chatFn = async (prompt) => { prompts.push(prompt); const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?"; return { text: replyFor(title, prompt) }; };
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page untuk toko kucing", playbook: "website", provider: "quran" })), { send: (e) => events.push(e), chatFn, personas, skills: new Map() });
  return { events, prompts };
};
const model = (scripts) => {
  let n = 0;
  return (title, prompt) => {
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">${scripts[Math.min(n++, scripts.length - 1)]}</document><handoff>Catatan skrip.</handoff>`;
    if (title === "Halaman landing page") return `<mockup title="Halaman">${PAGE + "<p>x</p>".repeat(1500)}</mockup><handoff>ids: menu-btn.</handoff>`;
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    return `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>Catatan ${title}.</handoff>${gate ? "<verdict>approved</verdict>" : ""}`;
  };
};

test("the engineer's script is checked: a broken one is sent back with the error, the fixed one goes into the designer's page", async () => {
  const { events, prompts } = await run(model(["document.addEventListener('DOMContentLoaded', () => { foo(1, 2; });", "document.addEventListener('DOMContentLoaded', () => {});"]));
  const fix = prompts.find((p) => /ITS SCRIPT DOES NOT WORK YET/.test(p));
  assert.ok(fix, "asked to fix it");
  assert.match(fix, /syntax error, so the browser runs none of it/);
  assert.match(fix, /THE CURRENT SCRIPT\n\s*document\.addEventListener\('DOMContentLoaded', \(\) => \{ foo\(1, 2;/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.equal(pageProblem(build.content), null, "the finished page compiles");
  assert.ok(build.content.includes("<h1>Halo</h1>") && build.content.length > 10_000, "the designer's whole page is in it");
  assert.doesNotMatch(build.note, /Peringatan/);
});

test("a script that stays broken after two tries is flagged in the handoff note instead of passing silently, and QA and launch see the page's outline and the verdict", async () => {
  const { events, prompts } = await run(model(["foo(1, 2;"]));
  assert.equal(prompts.filter((p) => /ITS SCRIPT DOES NOT WORK YET/.test(p)).length, 2, "two tries, then it goes on");
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.match(build.note, /^Peringatan dari pemeriksaan otomatis: script 1 of 1 has a syntax error/);
  const qa = prompts.find((p) => /YOUR TASK: Penilaian halaman/.test(p));
  assert.match(qa, /SYNTAX ERROR, the script does not run/, "the reviewer is told");
  assert.match(qa, /Its JavaScript:\n\s*foo\(1, 2;/, "and can read the code");
  assert.equal(events.at(-1).type, "done");
});

const BIG = PAGE.replace("</body>", `${"<section><h2>Bagian</h2><p>isi</p></section>".repeat(300)}</body>`);
const engineer = (file) => (title, prompt) => {
  if (title === "Halaman jadi dengan JavaScript") return typeof file === "function" ? file(prompt) : file;
  if (title === "Halaman landing page") return `<mockup title="Halaman">${BIG}</mockup><handoff>ids: menu-btn.</handoff>`;
  const gate = /<verdict>approved<\/verdict> or/.test(prompt);
  return `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>Catatan ${title}.</handoff>${gate ? "<verdict>approved</verdict>" : ""}`;
};

test("the engineer gets the designer's whole file, may change it, and his complete file is the result", async () => {
  const mine = BIG.replace("<h1>Halo</h1>", '<h1>Halo</h1><p id="toast" hidden>Terkirim</p>').replace("</body>", "<script>document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('toast'); if (t) t.hidden = false; });</script></body>");
  const { events, prompts } = await run(engineer(`<mockup title="Halaman jadi">${mine}</mockup><handoff>Toast ditambahkan.</handoff>`));
  const ask = prompts.find((p) => /YOUR TASK: Halaman jadi dengan JavaScript/.test(p));
  assert.match(ask, /THE FILE YOU WORK ON \(complete/);
  assert.ok(ask.includes(BIG.slice(-2000)), "all of her file, to the last character");
  assert.match(ask, /PROJECT MODE: you are not chatting now/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.equal(build.content, mine, "his file, with the markup he added");
  assert.equal(prompts.filter((p) => /DOES NOT WORK YET/.test(p)).length, 0, "nothing to fix");
});

test("a rewrite that lost the designer's page is not taken: his script goes into her page instead; ids that are not there are sent back", async () => {
  const short = `<!doctype html><html><body><h1>Lain</h1><script>document.addEventListener('DOMContentLoaded', () => { document.getElementById('nope').focus(); });</script></body></html>`;
  let fixes = 0;
  const { events, prompts } = await run(engineer((prompt) => (/DOES NOT WORK YET/.test(prompt) ? (fixes++, `<document title="script.js">document.addEventListener('DOMContentLoaded', () => { const b = document.getElementById('menu-btn'); if (b) b.focus(); });</document>`) : `<mockup title="x">${short}</mockup><handoff>n.</handoff>`)));
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.ok(build.content.includes("<h1>Halo</h1>") && build.content.length > 10_000, "her page is kept");
  assert.match(build.note, /dipasang ke halaman desainer/);
  assert.equal(fixes, 1);
  assert.match(prompts.find((p) => /DOES NOT WORK YET/.test(p)), /ids that do not exist on the page[^\n]*: nope/);
  assert.deepEqual(checkPage(build.content), [], "after the fix the page's code is clean");
});

test("an engineer's changes: exact find/replace, added CSS and markup, a library, the script; a change that does not match is skipped and reported", async () => {
  const { applyEdits, parseEdits } = await import("../src/pagecode.js");
  const page = PAGE.replace("<head>", "<head><style>h1{color:red}</style>");
  const reply = `Ini perubahannya.
<change><find><button id="menu-btn">Menu</button></find><replace><button id="menu-btn" aria-expanded="false">Menu</button></replace></change>
<change><find><div class="tidak-ada"></find><replace>x</replace></change>
<add-css>.toast{position:fixed}</add-css>
<add-html><p id="toast" class="toast" hidden>Terkirim</p></add-html>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<document title="script.js">document.addEventListener("DOMContentLoaded", () => { const t = document.getElementById("toast"); if (t) t.hidden = false; const scene = window.THREE ? new THREE.Scene() : null; });</document>
<handoff>Toast.</handoff>`;
  const e = parseEdits(reply);
  assert.equal(e.changes.length, 2);
  assert.deepEqual(e.libs, ["https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"]);
  const { html, missed } = applyEdits(page, e);
  assert.match(html, /<button id="menu-btn" aria-expanded="false">/);
  assert.deepEqual(missed, ['<div class="tidak-ada">']);
  assert.ok(html.indexOf(".toast{position:fixed}") < html.indexOf("</head>"), "the CSS goes into the head");
  assert.ok(html.indexOf("three.min.js") < html.lastIndexOf("<script>"), "the library comes before the script that uses it");
  assert.deepEqual(checkPage(html), [], "the toast the script looks up was added");
  // a revision: the new script replaces his old one instead of running next to it
  const again = applyEdits(html, { js: "const v = 2;" }, { replaceScript: true }).html;
  assert.equal(inlineScripts(again).length, 1);
  assert.match(lastScript(again), /const v = 2;/);
});

test("checks for what the eye would catch: a library loaded but never used goes back to the engineer; the same id twice and dead placeholder pictures are warnings", async () => {
  const { markupWarnings, unusedLibraries } = await import("../src/pagecode.js");
  const lib = PAGE.replace("</body>", '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script>const a = 1;</script></body>');
  assert.deepEqual(unusedLibraries(lib), ["THREE"]);
  assert.match(checkPage(lib).join(" "), /never uses .*THREE/);
  assert.deepEqual(unusedLibraries(lib.replace("const a = 1;", "const s = new THREE.Scene();")), []);
  const dup = PAGE.replace("<h1>Halo</h1>", '<h1>Halo</h1><p id="site"></p><img src="https://via.placeholder.com/150">');
  assert.equal(markupWarnings(dup).length, 2);
  assert.match(outlineOf(dup), /warning: the same id is used more than once: site/);
});
