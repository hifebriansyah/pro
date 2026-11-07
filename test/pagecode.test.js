import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPersonas } from "../src/personas-fs.js";
import { assemble, bareCode, inlineScripts, lastScript, outlineOf, pageProblem, scriptProblem } from "../src/pagecode.js";
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
  const fix = prompts.find((p) => /YOUR JAVASCRIPT HAS A SYNTAX ERROR/.test(p));
  assert.ok(fix, "asked to fix it");
  assert.match(fix, /YOUR CODE\ndocument\.addEventListener\('DOMContentLoaded', \(\) => \{ foo\(1, 2;/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.equal(pageProblem(build.content), null, "the finished page compiles");
  assert.ok(build.content.includes("<h1>Halo</h1>") && build.content.length > 10_000, "the designer's whole page is in it");
  assert.doesNotMatch(build.note, /Peringatan/);
});

test("a script that stays broken after two tries is flagged in the handoff note instead of passing silently, and QA and launch see the page's outline and the verdict", async () => {
  const { events, prompts } = await run(model(["foo(1, 2;"]));
  assert.equal(prompts.filter((p) => /YOUR JAVASCRIPT HAS A SYNTAX ERROR/.test(p)).length, 2, "two tries, then it goes on");
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.match(build.note, /^Peringatan: skripnya masih punya kesalahan sintaks/);
  const qa = prompts.find((p) => /YOUR TASK: Penilaian halaman/.test(p));
  assert.match(qa, /SYNTAX ERROR, the script does not run/, "the reviewer is told");
  assert.match(qa, /Its JavaScript:\n\s*foo\(1, 2;/, "and can read the code");
  assert.equal(events.at(-1).type, "done");
});
