import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { PLAYBOOKS } from "../src/playbooks.js";
import { MAX_FEED, MAX_PROJECTS, KEY, applyEvent, bundleMarkdown, load, newProject, nextAction, progress, runBody, save, settle, titleFrom } from "../project/state.js";
import { parseTeamBody, runTeam } from "../src/team.js";
import { loadPersonas } from "../src/personas-fs.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const view = readFileSync(new URL("../project/view.js", import.meta.url), "utf8");
const workflow = readdirSync(new URL("../.github/workflows/", import.meta.url)).map((f) => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8")).join("\n");
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), data: m }; };

/** A real run (src/team.js with a fake model), recorded: the events the page would receive. */
async function recorded({ goal = "Buat aplikasi absensi karyawan untuk pabrik", playbook = "software", done, only, feedback, verdicts = [] } = {}) {
  let v = 0;
  const chatFn = async (prompt) => {
    const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    const verdict = gate ? (verdicts[v++] ?? "approved") : null;
    const inner = /Mockup|Halaman landing page|Halaman jadi|Prototipe/.test(title) ? `<mockup title="Layar"><html><body>${title}</body></html></mockup>` : `<document title="${title}">\n# ${title}\n\n${"isi ".repeat(60)}\n</document>`;
    return { text: `${inner}<handoff>Catatan ${title}.</handoff>${gate ? (verdict === "approved" ? "<verdict>approved</verdict>" : "<verdict>changes</verdict><changes>- perbaiki a\n- perbaiki b</changes>") : ""}` };
  };
  const events = [];
  await runTeam(parseTeamBody(JSON.stringify({ goal, playbook, provider: "quran", done, only, feedback })), { send: (e) => events.push(e), chatFn, personas: loadPersonas(), skills: new Map() });
  return events;
}

test("newProject: a draft with the playbook's plan, a title from the goal, and a playbook suggested from the words", () => {
  const p = newProject({ goal: "  Kampanye Instagram untuk toko kopi baru di Cianjur dengan anggaran kecil dan target anak muda  ", now: 1000 });
  assert.equal(p.playbook, "campaign");
  assert.equal(p.status, "draft");
  assert.deepEqual(p.plan.map((s) => s.id), PLAYBOOKS.campaign.steps.map((s) => s.id));
  assert.ok(p.title.length <= 70 && p.title.endsWith("…"));
  assert.equal(titleFrom("pendek"), "pendek");
  assert.equal(newProject({ goal: "Aplikasi absensi", playbook: "software" }).playbook, "software");
  assert.notEqual(newProject({ goal: "a goal" }).id, newProject({ goal: "a goal" }).id);
});

test("applyEvent: a whole run turns a draft into a finished project, step by step", async () => {
  const p = newProject({ goal: "Buat aplikasi absensi karyawan untuk pabrik" });
  const seen = [];
  for (const ev of await recorded()) { applyEvent(p, ev, 5000); seen.push(p.status); }
  assert.equal(p.status, "done");
  assert.deepEqual(progress(p), { done: 7, total: 7 });
  assert.equal(nextAction(p), "none");
  assert.ok(p.plan.every((s) => s.name && s.role), "the plan carries the people's names");
  assert.ok(Object.values(p.steps).every((s) => s.status === "done" && s.attempt >= 1));
  assert.equal(p.artifacts.design.kind, "mockup");
  assert.match(p.artifacts.prd.content, /^# PRD/);
  assert.equal(p.artifacts.prd.note, "Catatan PRD.");
  assert.deepEqual([p.reviews.qa.verdict, p.reviews.qa.final], ["approved", true]);
  assert.equal(p.feed.filter((f) => f.type === "handoff").length, 5);
  assert.equal(p.summary.finished, 7);
  assert.ok(seen.includes("running"));
});

test("applyEvent: a review that asks for changes shows the revision; a paused or failed run says what can be done", async () => {
  const p = newProject({ goal: "Buat aplikasi absensi karyawan untuk pabrik" });
  for (const ev of await recorded({ verdicts: ["changes", "approved"] })) applyEvent(p, ev);
  assert.equal(p.artifacts.build.revision, 1, "the engineer's second version");
  assert.equal(p.status, "done");
  assert.ok(p.feed.some((f) => f.type === "handoff" && /Perlu perbaikan: - perbaiki a/.test(f.text.replace(/\s+/g, " ")) || /perbaiki a/.test(f.text)));
  const q = newProject({ goal: "x goal here" });
  applyEvent(q, { type: "plan", playbook: "software", title: "t", steps: PLAYBOOKS.software.steps.map((s) => ({ ...s, name: "N", role: "R", status: "pending" })) });
  applyEvent(q, { type: "step", phase: "start", id: "prd", agent: "po", attempt: 2 });
  assert.deepEqual([q.steps.prd.status, q.steps.prd.attempt, q.current], ["running", 2, "prd"]);
  applyEvent(q, { type: "step", phase: "end", id: "prd", agent: "po", status: "failed", error: "model down" });
  applyEvent(q, { type: "paused", reason: "failed", next: "prd" });
  assert.deepEqual([q.status, q.steps.prd.error, nextAction(q), q.feed.at(-1).type], ["failed", "model down", "retry", "failed"]);
  applyEvent(q, { type: "paused", reason: "time", next: "stories" });
  assert.deepEqual([q.status, nextAction(q)], ["paused", "continue"]);
  applyEvent(q, { type: "plan", playbook: "software", title: "t", steps: PLAYBOOKS.software.steps.map((s) => ({ ...s, name: "N", role: "R", status: "pending" })) });
  assert.equal(q.status, "running", "a new plan event starts a run again");
  applyEvent(q, { type: "end" });
  assert.equal(q.status, "paused", "a stream that ended without a verdict can be continued");
  applyEvent(q, { type: "unknown" });
  assert.equal(applyEvent(q, null), q);
});

test("runBody: resuming sends the goal and only the finished work; a redo names one step with the comment", async () => {
  const p = newProject({ goal: "Buat aplikasi absensi karyawan untuk pabrik" });
  const events = await recorded();
  for (const ev of events.slice(0, events.findIndex((e) => e.type === "artifact" && e.id === "design"))) applyEvent(p, ev); // stops before the design is stored
  p.steps.design = { status: "running" };
  const b = runBody(p);
  assert.deepEqual(Object.keys(b.done), ["prd", "stories"]);
  assert.deepEqual(Object.keys(b.done.prd), ["note", "artifact"]);
  assert.deepEqual([b.goal, b.playbook, b.provider], [p.goal, "software", "quran"]);
  assert.equal(b.only, undefined);
  assert.deepEqual([runBody(p, { only: "prd", feedback: "ubah" }).only, runBody(p, { only: "prd", feedback: "ubah" }).feedback], ["prd", "ubah"]);
  // and the server takes it: the resumed run does the rest
  const rest = await recorded({ done: b.done });
  assert.deepEqual(rest.filter((e) => e.type === "artifact").map((e) => e.id), ["design", "tech", "build", "qa", "summary"]);
  for (const ev of rest) applyEvent(p, ev);
  assert.equal(p.status, "done");
  assert.deepEqual(progress(p), { done: 7, total: 7 });
});

test("settle: a project that was running when the page closed can be continued, with nothing stuck on 'running'", () => {
  const p = newProject({ goal: "Buat aplikasi absensi karyawan untuk pabrik" });
  p.status = "running"; p.steps.prd = { status: "running" }; p.steps.stories = { status: "done" };
  settle([p]);
  assert.equal(p.status, "paused");
  assert.equal(p.steps.prd.status, "pending");
  assert.equal(p.steps.stories.status, "done");
  assert.equal(nextAction(p), "continue");
});

test("storage: newest first, at most the limit, and a broken store is an empty list", () => {
  const st = memory();
  const list = Array.from({ length: MAX_PROJECTS + 5 }, (_, i) => ({ ...newProject({ goal: `Proyek nomor ${i} untuk pengujian`, now: 1000 + i }), updatedAt: 1000 + i }));
  const kept = save(st, list);
  assert.equal(kept.length, MAX_PROJECTS);
  assert.equal(kept[0].updatedAt, 1000 + MAX_PROJECTS + 4, "newest first");
  assert.equal(load(st).length, MAX_PROJECTS);
  st.setItem(KEY, "bukan json");
  assert.deepEqual(load(st), []);
  st.setItem(KEY, JSON.stringify([{ id: "x" }, null, { id: "y", plan: [], status: "done" }]));
  assert.deepEqual(load(st).map((p) => p.id), ["y"], "entries that are not projects are dropped");
  const big = { ...newProject({ goal: "Proyek besar untuk pengujian ukuran", now: 5 }), updatedAt: 5 };
  big.artifacts.prd = { kind: "document", title: "x", content: "x".repeat(1_300_000), note: "" };
  const small = { ...newProject({ goal: "Proyek kecil untuk pengujian ukuran", now: 9 }), updatedAt: 9 };
  assert.deepEqual(save(memory(), [big, small]).map((p) => p.id), [small.id], "the oldest goes first when the store would be too big");
  assert.doesNotThrow(() => save({ setItem() { throw new Error("full"); } }, [small]), "a full store is not an error");
  assert.ok(MAX_FEED >= 40);
});

test("bundleMarkdown: one file with every deliverable in order, with who wrote it; a mockup as an HTML block", async () => {
  const p = newProject({ goal: "Buat aplikasi absensi karyawan untuk pabrik" });
  for (const ev of await recorded()) applyEvent(p, ev);
  const md = bundleMarkdown(p, { po: "Raka" });
  assert.match(md, /^# Buat aplikasi absensi/);
  assert.match(md, /> Tujuan: Buat aplikasi absensi karyawan untuk pabrik/);
  assert.ok(md.indexOf("## PRD") < md.indexOf("## User story") && md.indexOf("## User story") < md.indexOf("## Ringkasan pengiriman"));
  assert.match(md, /_Raka · Product Owner_/);
  assert.match(md, /```html\n<html><body>Mockup layar utama<\/body><\/html>\n```/);
  assert.doesNotMatch(md, /^# PRD$/m, "the document's own title line is not repeated under the section heading");
  assert.equal(bundleMarkdown(newProject({ goal: "tidak ada hasil apa pun" })).includes("---"), false, "an empty project has no sections");
});

test("the screen: built with DOM nodes (no innerHTML for anything a model wrote), accessible, and asks before it deletes", () => {
  assert.ok(!/\.innerHTML\s*=\s*[^;]*\b(a\.|p\.|st\.|rv\.|ev\.)/.test(view), "no innerHTML with project data");
  assert.match(view, /el\("textarea", "pj-goal"\)/);
  assert.match(view, /label\.htmlFor = "pj-goal"/);
  assert.match(view, /setAttribute\("role", "progressbar"\)/);
  assert.match(view, /aria-live/);
  assert.match(view, /confirm\(`Hapus proyek/);
  assert.match(view, /setAttribute\("aria-label", `Buka obrolan dengan \$\{ag\.name\}`\)/);
  assert.match(view, /`\$\{deps\.proxy\}\/team`/);
  assert.match(view, /429[\s\S]*Terlalu banyak proyek/);
  assert.match(view, /auto < 5/, "it goes on by itself when a run only ran out of time, a limited number of times");
});

test("the page: the project screen is loaded when first opened, the office hears what a project is doing, and the site publishes it", () => {
  assert.match(html, /await import\("\.\/project\/view\.js"\)/);
  assert.match(html, /id="project"/);
  assert.match(html, /id="pj-body"/);
  assert.match(html, /\.app\.project-mode \.side \{ display: none; \}/);
  assert.match(html, /#proyek\(\?:\\\/\(\[\\w-\]\+\)\)\?\$/, "the address #proyek/<id> opens one project");
  assert.match(html, /team: \{\s*busy: \(id, text\)[\s\S]*visit: \(from, to\)/);
  assert.match(html, /const teamBusy = new Map\(\)/);
  assert.match(workflow, /cp -r personas icons office project _site\//);
  assert.match(workflow, /mkdir _site\/src[\s\S]*cp src\/playbooks\.js src\/roster\.js _site\/src\//, "the playbooks the screen shows are published with it");
});

test("the project screen and the office both use the playbooks and the roster that the server uses", () => {
  assert.match(view, /from "\.\.\/src\/playbooks\.js"/);
  assert.match(view, /from "\.\.\/src\/roster\.js"/);
  const dir = readdirSync(new URL("../project/", import.meta.url));
  assert.deepEqual(dir.sort(), ["state.js", "view.js"]);
});

test("a project remembers its headline deliverable: the page for a website, nothing for the others", async () => {
  const { primaryArtifact } = await import("../project/state.js");
  const w = newProject({ goal: "Buatkan landing page untuk jasa pembuatan website" });
  assert.equal(w.playbook, "website");
  assert.equal(w.primary, "build");
  assert.equal(primaryArtifact(w), null, "not there until it is written");
  const events = await recorded({ goal: "Buatkan landing page untuk jasa pembuatan website", playbook: "website" });
  for (const ev of events) applyEvent(w, ev);
  assert.equal(w.status, "done");
  assert.equal(w.primary, "build");
  const main = primaryArtifact(w);
  assert.deepEqual([main.id, main.kind], ["build", "mockup"]);
  assert.match(main.content, /^<html/i);
  assert.equal(newProject({ goal: "Kampanye Instagram untuk toko kopi" }).primary, null);
  assert.equal(primaryArtifact(newProject({ goal: "Kampanye Instagram untuk toko kopi" })), null);
  const md = bundleMarkdown(w);
  assert.match(md, /```html/);
});

test("the screen puts the result first: it opens by itself when the project is done, has its own download, and says which step is the result", () => {
  assert.match(view, /const main = primaryArtifact\(p\); if \(main && currentId === p\.id\) showArtifact\(main, p\)/);
  assert.match(view, /deps\.setDocUrl\?\.\(art\.content, r\.fileUrl \?\? r\.url\)/, "a page open on the right gets its new-window button when it is published");
  assert.match(view, /if \(ev\.kind === "mockup"\) publishStage\(p, ev\.id/, "every page version is published as it arrives, the designer's too");
  assert.match(view, /callPublish\("publish", \{ id: p\.published\?\.id, token, html: art\.content, file: stepId \}\)/, "into the project's one folder, a file per stage");
  assert.match(html, /id="doc-open" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /\\\/p\\\/\[a-z0-9\]\{12\}\\\/\(\?:\[a-z0-9\]\[a-z0-9-\]\{0,39\}\\\.html\)\?\$/, "only a published page address (the folder, or one stage in it) gets the button");
  assert.match(view, /"Halamanmu sudah jadi"/);
  assert.match(view, /"Hasil utama"/);
  assert.match(view, /download\(`\$\{slug\(a\.title \|\| p\.title\)\}\.html`, a\.content, "text\/html"\)/);
  assert.match(view, /"Landing page untuk jasa pembuatan website/, "the first example is a landing page");
  assert.match(html, /const downloadText = \(name, text, type = "text\/markdown"\)/);
});

test("settle: a run cut off by a refresh is marked to go on by itself; one the visitor stopped is not", () => {
  const cut = { id: "a", plan: [], steps: {}, status: "running" }, stopped = { id: "b", plan: [], steps: {}, status: "paused", pause: { reason: "stopped", next: null } };
  settle([cut, stopped]);
  assert.deepEqual([cut.status, cut.resume, stopped.resume], ["paused", true, undefined]);
  assert.match(view, /cut\[0\]\.status === "paused"\) run\(cut\[0\]\)/);
});

test("a finished page's test run is kept with the project (strings only, capped) and shown under the step as text, never as markup", () => {
  const p = newProject({ goal: "Landing page toko kopi" });
  applyEvent(p, { type: "artifact", id: "build", kind: "mockup", title: "Halaman", content: "<html></html>", note: "n", test: { passed: ["the menu button opens the menu", 7], problems: ["clicking a \"Detail\" throws"], steps: 9 } });
  assert.deepEqual(p.artifacts.build.test, { passed: ["the menu button opens the menu"], problems: ['clicking a "Detail" throws'] });
  applyEvent(p, { type: "artifact", id: "page", kind: "mockup", title: "Desain", content: "<html></html>", note: "n" });
  assert.equal(p.artifacts.page.test, undefined, "no test run, no report");
  assert.match(view, /if \(a\.test\) card\.append\(testReport\(a\.test\)\)/);
  assert.match(view, /li\.textContent = x/, "the report is text");
});
