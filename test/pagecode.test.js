import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPersonas } from "../src/personas-fs.js";
import { assemble, bareCode, checkPage, inlineScripts, lastScript, markupWarnings, missingIds, outlineOf, pageProblem, scriptProblem } from "../src/pagecode.js";
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
  const { unusedLibraries } = await import("../src/pagecode.js");
  const lib = PAGE.replace("</body>", '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script>const a = 1;</script></body>');
  assert.deepEqual(unusedLibraries(lib), ["THREE"]);
  assert.match(checkPage(lib).join(" "), /never uses .*THREE/);
  assert.deepEqual(unusedLibraries(lib.replace("const a = 1;", "const s = new THREE.Scene();")), []);
  const dup = PAGE.replace("<h1>Halo</h1>", '<h1>Halo</h1><p id="site"></p><img src="https://via.placeholder.com/150">');
  assert.equal(markupWarnings(dup).length, 2);
  assert.match(outlineOf(dup), /warning: the same id is used more than once: site/);
});

test("repairs the code makes itself: icon sizes, dead placeholder pictures, the same id twice; never inside a script", async () => {
  const { repairPage, fixIcons } = await import("../src/pagecode.js");
  const page = `<html><body><svg viewBox="0 0 24 24"><path/></svg><svg viewBox="0 0 800 400"></svg><svg width="32" viewBox="0 0 24 24"></svg>
<img src="https://via.placeholder.com/150x100" alt="Kucing 1"><div style="background:url('https://via.placeholder.com/800x400')"></div>
<div class="s" id="m"></div><div class="s" id="m"></div><p id="x">a</p><p id="x">b</p>
<script>const t = '<svg viewBox="0 0 24 24">'; const u = "https://via.placeholder.com/10";</script></body></html>`;
  const { html, fixed } = repairPage(page);
  assert.equal(fixed.length, 4);
  assert.match(html, /<svg width="24" height="24" viewBox="0 0 24 24"><path\/>/, "the icon got a size");
  assert.match(html, /<svg viewBox="0 0 800 400">/, "a large illustration is left alone");
  assert.match(html, /<svg width="32" viewBox/, "one with a size is left alone");
  assert.equal((html.match(/data:image\/svg\+xml/g) || []).length, 2, "both dead pictures are replaced");
  assert.match(decodeURIComponent(html), /width="150" height="100"[\s\S]*Kucing 1/, "same size, labelled with its alt text");
  assert.equal((html.match(/id="m"/g) || []).length, 1, "the empty copy is gone");
  assert.match(html, /<p id="x">a<\/p><p id="x-2">b<\/p>/, "the first keeps its id");
  assert.match(html, /const t = '<svg viewBox="0 0 24 24">'; const u = "https:\/\/via\.placeholder\.com\/10";/, "the script is untouched");
  assert.deepEqual(markupWarnings(html), []);
  assert.equal(fixIcons(html).fixed.length, 0, "a second pass changes nothing");
});

test("three.js the goal asks for: the starter scene compiles; it goes into the designer's container, or makes its own", async () => {
  const { ensureThree, threeStarter, wantsThree, sceneContainer } = await import("../src/pagecode.js");
  assert.equal(scriptProblem(threeStarter("hero-scene")), null);
  assert.equal(scriptProblem(threeStarter(null)), null);
  assert.ok(wantsThree("Landing page dengan objek 3D memakai three.js") && wantsThree("pakai threejs") && !wantsThree("Landing page toko kopi"));
  const withBox = PAGE.replace("<h1>Halo</h1>", '<h1>Halo</h1><div id="hero-scene"></div>');
  assert.equal(sceneContainer(withBox), "hero-scene");
  const r = ensureThree(withBox, "Landing page three.js");
  assert.match(r.html, /three\.min\.js/);
  assert.match(lastScript(r.html), /getElementById\("hero-scene"\)/);
  assert.deepEqual(checkPage(r.html), [], "loaded and used");
  assert.equal(ensureThree(withBox, "Landing page toko kopi").fixed.length, 0, "not asked for: nothing added");
  assert.equal(ensureThree(r.html, "Landing page three.js").fixed.length, 0, "already used: nothing added twice");
});

test("in a project: the engineer is given the starter scene; a page that still has no 3D gets it, and the note says what was repaired", async () => {
  const { events, prompts } = await run3d();
  const ask = prompts.find((p) => /YOUR TASK: Halaman jadi dengan JavaScript/.test(p));
  assert.match(ask, /STARTER CODE FOR THE 3D PART[\s\S]*new THREE\.WebGLRenderer/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.match(build.content, /THREE\.WebGLRenderer/);
  assert.match(build.note, /^Diperbaiki otomatis: .*adegan 3D three\.js/);
  assert.deepEqual(checkPage(build.content), []);
});
async function run3d() {
  const events = [], prompts = [];
  const chatFn = async (prompt) => {
    prompts.push(prompt);
    const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
    if (title === "Halaman jadi dengan JavaScript") return { text: `<document title="script.js">document.addEventListener("DOMContentLoaded", () => {});</document><handoff>n.</handoff>` };
    if (title === "Halaman landing page") return { text: `<mockup title="Halaman">${PAGE + "<p>x</p>".repeat(1000)}</mockup><handoff>n.</handoff>` };
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    return { text: `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>n.</handoff>${gate ? "<verdict>approved</verdict>" : ""}` };
  };
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page studio game dengan objek 3D memakai three.js", playbook: "website", provider: "quran" })), { send: (e) => events.push(e), chatFn, personas, skills: new Map() });
  return { events, prompts };
}

test("a model that times out on a long prompt is tried again with a shorter one; a revision shows the markup and script but not the old CSS", async () => {
  const { buildStepPrompt } = await import("../src/team.js");
  const { PLAYBOOKS, stepById } = await import("../src/playbooks.js");
  const css = "a{color:red}".repeat(200);
  const page = `<html><head><style>${css}</style></head><body><h1>Halo</h1><script>const z = 1;</script></body></html>`;
  const results = new Map([["page", { note: "n", artifact: { kind: "mockup", title: "P", content: page } }], ["copy", { note: "n", artifact: { kind: "document", title: "C", content: "naskah ".repeat(3000) } }]]);
  const step = stepById(PLAYBOOKS.website, "build");
  const full = buildStepPrompt({ step, goal: "Landing page", results, persona: "p", skill: "", playbook: PLAYBOOKS.website });
  const rev = buildStepPrompt({ step, goal: "Landing page", results, persona: "p", skill: "", playbook: PLAYBOOKS.website, revision: { by: "qa", changes: "- x", previous: page } });
  const short = buildStepPrompt({ step, goal: "Landing page", results, persona: "p", skill: "", playbook: PLAYBOOKS.website, compact: true });
  assert.ok(full.includes(css), "the first pass sees all of it");
  assert.ok(!rev.includes(css) && /karakter CSS lama tidak ditampilkan/.test(rev) && rev.includes("const z = 1;"), "the revision: markup and script, not the old CSS");
  assert.ok(short.length < full.length - css.length, "the retry is shorter, its documents too");
  // a timeout, then the shorter retry
  let calls = 0; const seen = [];
  const chatFn = async (prompt) => {
    const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
    if (title === "Brief halaman") { calls++; seen.push(prompt.length); if (calls === 1) throw new Error("quran-gpt: HTTP 504"); }
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    if (title === "Halaman jadi dengan JavaScript") return { text: `<document title="script.js">const ok = 1;</document><handoff>n.</handoff>` };
    if (title === "Halaman landing page") return { text: `<mockup title="H">${PAGE + "<p>x</p>".repeat(1000)}</mockup><handoff>n.</handoff>` };
    return { text: `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>n.</handoff>${gate ? "<verdict>approved</verdict>" : ""}` };
  };
  const events = [];
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page untuk toko kucing", playbook: "website", provider: "quran" })), { send: (e) => events.push(e), chatFn, personas, skills: new Map([["writing-md", { body: "R".repeat(9000) }]]) });
  assert.equal(calls, 2);
  assert.ok(seen[1] < seen[0], `the second try is shorter (${seen[0]} -> ${seen[1]})`);
  assert.equal(events.at(-1).type, "done");
});

test("Tailwind and Lucide: icons that are never drawn get Lucide and createIcons; Tailwind classes without Tailwind get it loaded; the engineer's script stays last", async () => {
  const { ensureLibraries, LUCIDE_SRC, TAILWIND_SRC } = await import("../src/pagecode.js");
  const tw = '<div class="flex items-center justify-between px-4 py-2 md:px-8 bg-orange-500 text-white rounded-lg shadow-md gap-4 max-w-6xl font-bold"><i data-lucide="menu" class="w-6 h-6"></i></div>';
  const page = PAGE.replace("<h1>Halo</h1>", tw).replace("</body>", "<script>const mine = 1;</script></body>");
  const r = ensureLibraries(page);
  assert.equal(r.fixed.length, 3);
  assert.ok(r.html.indexOf(TAILWIND_SRC) < r.html.indexOf("</head>"), "Tailwind in the head");
  assert.ok(r.html.indexOf(LUCIDE_SRC) < r.html.indexOf("createIcons"), "Lucide before the call that draws");
  assert.match(lastScript(r.html), /const mine = 1;/, "the engineer's script is still the last one");
  assert.deepEqual(checkPage(r.html), []);
  assert.equal(ensureLibraries(r.html).fixed.length, 0, "nothing twice");
  const done = page.replace("</head>", '<script src="https://cdn.tailwindcss.com/3.4.17"></script></head>').replace("const mine = 1;", "const mine = 1; lucide.createIcons();").replace("</body>", '<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script></body>');
  assert.equal(ensureLibraries(done).fixed.length, 0, "a page that already does it is left alone");
});

test("a literal \\n a model left between tags is removed; one inside a script or in text is kept", async () => {
  const { fixStrayEscapes } = await import("../src/pagecode.js");
  const page = '<h2>Halo</h2>\\n            <div id="a"></div><p>baris \\n tetap</p><script>const s = "a\\nb";</script>';
  const r = fixStrayEscapes(page);
  assert.equal(r.fixed.length, 1);
  assert.match(r.html, /<h2>Halo<\/h2>\n<div id="a">/);
  assert.match(r.html, /<p>baris \\n tetap<\/p>/, "text inside an element is left alone");
  assert.match(r.html, /const s = "a\\nb";/, "the script is left alone");
});
