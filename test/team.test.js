import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { backendTeam } from "../src/backend.js";
import { loadPersonas } from "../src/personas-fs.js";
import { PLAYBOOKS, stepById, suggestPlaybook, validatePlaybook } from "../src/playbooks.js";
import { BUDGET, LIMITS, buildStepPrompt, parseStepReply, parseTeamBody, projectPersona, runTeam } from "../src/team.js";

globalThis.__SKILLS__ = [];
const worker = (await import("../worker/pro.js")).default;
const personas = loadPersonas();
const skills = new Map([["writing-md", { name: "writing-md", body: "WRITING-RULES" }], ["mockup-html", { name: "mockup-html", body: "MOCKUP-RULES" }]]);
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const body = (o = {}) => parseTeamBody(JSON.stringify({ goal: "Buat aplikasi absensi karyawan untuk pabrik", playbook: "software", provider: "quran", ...o }));
const titleOf = (prompt) => /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
/** A model that does every step well: a document (or a mockup) and a handoff note, and approves reviews. Records every prompt. */
function fakeModel({ verdicts = [], fail = () => false, reply } = {}) {
  const m = { prompts: [], calls: 0 };
  let v = 0;
  m.chat = async (prompt) => {
    m.calls++; m.prompts.push(prompt);
    const title = titleOf(prompt);
    if (fail(title, prompt, m.calls)) throw new Error("model down");
    if (reply) return { text: reply(title, prompt, m.calls) };
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    const verdict = gate ? (verdicts[v++] ?? "approved") : null;
    const inner = title === "Prototipe berfungsi (kode)" || title === "Halaman jadi dengan JavaScript" ? `<document title="script.js">document.addEventListener("DOMContentLoaded", () => { const h = document.querySelector("h1"); if (!h) return; });</document>`
      : title === "Mockup layar utama" ? `<mockup title="Layar utama"><!doctype html><html><body><h1>${title}</h1></body></html></mockup>` : `<document title="${title}">\n# ${title}\n\nIsi lengkap untuk ${title}. `.padEnd(250, "x") + "\n</document>";
    const tail = gate ? (verdict === "approved" ? "<verdict>approved</verdict>" : "<verdict>changes</verdict><changes>- tambahkan validasi\n- jelaskan error</changes>") : "";
    return { text: `${inner}\n<handoff>Catatan ${title}.</handoff>\n${tail}` };
  };
  return m;
}
const collect = async (b, opts = {}) => { const events = []; const summary = await runTeam(b, { send: (e) => events.push(e), personas, skills, ...opts }); return { events, summary }; };
const kinds = (events) => events.map((e) => e.type + (e.phase ? ":" + e.phase : ""));

test("playbooks are consistent, and a goal picks one", () => {
  for (const pb of Object.values(PLAYBOOKS)) { assert.doesNotThrow(() => validatePlaybook(pb)); assert.ok(pb.steps.length >= 5); assert.ok(pb.steps.some((s) => s.gate), "a review step"); }
  assert.throws(() => validatePlaybook({ id: "x", steps: [{ id: "a", agent: "po", kind: "document", uses: ["b"], task: "" }] }), /does not come earlier/);
  assert.throws(() => validatePlaybook({ id: "x", steps: [{ id: "a", agent: "nobody", kind: "document", uses: [], task: "" }] }), /unknown agent/);
  assert.equal(suggestPlaybook("Kampanye Instagram untuk toko kopi"), "campaign");
  assert.equal(suggestPlaybook("Aplikasi absensi karyawan"), "software");
});

test("parseTeamBody: a goal is needed; the rest is cleaned and capped", () => {
  assert.throws(() => parseTeamBody("{}"), /tujuan/);
  assert.throws(() => parseTeamBody("bukan json"), /tujuan/);
  const b = parseTeamBody(JSON.stringify({ goal: "  " + "a".repeat(5000), playbook: "nonexistent", provider: "evil", only: "ghost", feedback: "f".repeat(5000),
    done: { prd: { note: "n".repeat(2000), artifact: { kind: "mockup", title: "T", content: "c".repeat(60000) } }, ghost: { note: "x" }, stories: "not an object" } }));
  assert.equal(b.goal.length, LIMITS.goal);
  assert.equal(b.playbook, "software");
  assert.equal(b.provider, "quran", "the faster source by default");
  assert.equal(b.only, undefined);
  assert.equal(b.feedback.length, LIMITS.feedback);
  assert.deepEqual(Object.keys(b.done), ["prd"]);
  assert.equal(b.done.prd.note.length, LIMITS.note);
  assert.equal(b.done.prd.artifact.content.length, LIMITS.artifact);
  assert.equal(b.done.prd.artifact.kind, "mockup");
  assert.equal(parseTeamBody(JSON.stringify({ goal: "Kampanye promosi", playbook: "campaign", provider: "islam", only: "copy" })).only, "copy");
});

test("buildStepPrompt: the persona, the goal, the task and the contract; earlier notes only; long inputs shortened; a mockup is outlined, not pasted", () => {
  const pb = PLAYBOOKS.software;
  const results = new Map([
    ["prd", { note: "PRD selesai: fokus absensi.", artifact: { kind: "document", title: "PRD", content: "PRD lengkap" } }],
    ["stories", { note: "Ada 8 story.", artifact: { kind: "document", title: "Story", content: "Story lengkap " + "S".repeat(30000) } }],
    ["design", { note: "Satu layar dengan tombol besar.", artifact: { kind: "mockup", title: "Layar", content: "<html>…</html>" } }],
  ]);
  const p = buildStepPrompt({ step: stepById(pb, "tech"), goal: "Buat aplikasi absensi untuk pabrik", results, persona: personas.get("engineer"), skill: "WRITING-RULES", playbook: pb });
  assert.match(p, /^You are Bima/);
  assert.match(p, /PROJECT GOAL\nBuat aplikasi absensi untuk pabrik/);
  assert.match(p, /YOUR TASK: Rencana teknis dan kerangka kode/);
  assert.match(p, /- Raka \(PRD\): PRD selesai/);
  assert.match(p, /- Kirana \(Mockup layar utama\): Satu layar/);
  assert.doesNotMatch(p, /^- (Sinta|Citra) \(/m, "no handoff note from a step that has not happened");
  assert.ok(!p.includes("S".repeat(9000)), "a long input is shortened");
  assert.match(p, /dipersingkat/);
  assert.match(p, /Story lengkap/);
  assert.match(p, /HTML page "Layar"[\s\S]*inline scripts: 0/, "the engineer is told what the page holds");
  assert.doesNotMatch(p, /<html>/, "the mockup's HTML is not pasted, its outline is");
  assert.match(p, /ONE <document title="...">/);
  assert.doesNotMatch(p, /<verdict>approved<\/verdict> or/, "no verdict for an ordinary step");
  assert.match(p, /Tulis semuanya dalam Bahasa Indonesia/);
  assert.match(p, /FORMAT RULES FOR THE DELIVERABLE\nWRITING-RULES/);
  const q = buildStepPrompt({ step: stepById(pb, "qa"), goal: "Build an attendance app for a factory", results, persona: personas.get("qa"), skill: "", playbook: pb });
  assert.match(q, /<verdict>approved<\/verdict> or <verdict>changes<\/verdict>/);
  assert.match(q, /Write everything in English/);
  const d = buildStepPrompt({ step: stepById(pb, "design"), goal: "x", results: new Map(), persona: "You are Kirana.", skill: "", playbook: pb });
  assert.match(d, /ONE <mockup title="...">/);
  const r = buildStepPrompt({ step: stepById(pb, "tech"), goal: "x", results, persona: "You are Bima.", skill: "", playbook: pb, revision: { by: "qa", changes: "- tambah validasi", previous: "VERSI LAMA" } });
  assert.match(r, /REVIEW FEEDBACK from Sinta[\s\S]*- tambah validasi[\s\S]*YOUR PREVIOUS VERSION\nVERSI LAMA/);
  assert.match(buildStepPrompt({ step: stepById(pb, "tech"), goal: "x", results, persona: "p", skill: "", playbook: pb, revision: { by: "user", changes: "ubah", previous: "" } }), /from the client/);
});

test("parseStepReply: the deliverable, the note, the verdict; tolerant of a forgetful model", () => {
  const step = stepById(PLAYBOOKS.software, "prd"), gate = stepById(PLAYBOOKS.software, "qa"), mock = stepById(PLAYBOOKS.software, "design");
  let r = parseStepReply('Siap!\n<document title="PRD Absensi">\n# PRD Absensi\n\nIsi.\n</document>\n<handoff>Fokus pada shift pagi.</handoff>', step);
  assert.deepEqual([r.artifact.kind, r.artifact.title, r.note], ["document", "PRD Absensi", "Fokus pada shift pagi."]);
  assert.match(r.artifact.content, /^# PRD Absensi/);
  r = parseStepReply('<document title="X">isi <handoff>di dalam dokumen</handoff> lanjut</document>', step);
  assert.doesNotMatch(r.artifact.content, /handoff/, "a note written inside the document is taken out of it");
  assert.equal(r.note, "di dalam dokumen");
  r = parseStepReply('<mockup title="Layar"><html><body>hi</body></html></mockup><handoff>tata letak sederhana</handoff>', mock);
  assert.deepEqual([r.artifact.kind, r.artifact.title], ["mockup", "Layar"]);
  r = parseStepReply('<document title="Desain">teks bukan mockup</document>', mock);
  assert.equal(r.artifact.kind, "document", "a document instead of a mockup is kept rather than lost");
  r = parseStepReply("# Judul\n\n" + "Ini jawaban biasa tanpa tag sama sekali. ".repeat(8), step);
  assert.equal(r.artifact.title, step.title);
  assert.ok(r.note.length > 20 && r.note.length <= LIMITS.note, "a note is made from the text when there is none");
  assert.equal(parseStepReply("Maaf, saya tidak bisa.", step).artifact, null);
  r = parseStepReply('<document title="Tes">rencana</document><handoff>ok</handoff><verdict>CHANGES</verdict><changes>- a\n- b</changes>', gate);
  assert.deepEqual([r.verdict, r.changes], ["changes", "- a\n- b"]);
  assert.equal(parseStepReply('<document title="Tes">rencana</document>', gate).verdict, null);
});

test("runTeam: the whole software playbook, in order, with handoffs, the review and a summary", async () => {
  const m = fakeModel();
  const { events, summary } = await collect(body(), { chatFn: m.chat });
  assert.equal(events[0].type, "plan");
  assert.deepEqual(events[0].steps.map((s) => s.name), ["Raka", "Nadia", "Kirana", "Bima", "Bima", "Sinta", "Citra"]);
  assert.ok(events[0].steps.every((s) => s.status === "pending"));
  assert.deepEqual(events.filter((e) => e.type === "artifact").map((e) => e.id), ["prd", "stories", "design", "tech", "build", "qa", "summary"]);
  assert.equal(events.find((e) => e.id === "design" && e.type === "artifact").kind, "mockup");
  assert.deepEqual(events.filter((e) => e.type === "handoff").map((e) => `${e.from}>${e.to}`), ["po>ba", "ba>designer", "designer>engineer", "engineer>qa", "qa>delivery"]);
  const rv = events.find((e) => e.type === "review");
  assert.deepEqual([rv.id, rv.by, rv.verdict, rv.final], ["qa", "qa", "approved", true]);
  assert.equal(events.at(-1).type, "done");
  assert.deepEqual([events.at(-1).summary.finished, events.at(-1).summary.total, summary.calls, summary.revisions], [7, 7, 7, 0]);
  assert.match(m.prompts[3], /- Nadia \(User story dan kriteria penerimaan\): Catatan User story/, "Bima got Nadia's note");
  assert.match(m.prompts[1], /Isi lengkap untuk PRD/, "Nadia got the PRD itself");
  assert.equal(events.filter((e) => e.type === "step" && e.phase === "start").length, 7);
});

test("runTeam: a review that asks for changes sends the author back once, then the reviewer checks again", async () => {
  const m = fakeModel({ verdicts: ["changes", "approved"] });
  const { events, summary } = await collect(body(), { chatFn: m.chat });
  const order = events.filter((e) => ["review", "handoff"].includes(e.type) || (e.type === "artifact" && ["build", "qa"].includes(e.id))).map((e) => `${e.type}:${e.id ?? e.from + ">" + e.to}${e.revision ? ":rev" : ""}${e.type === "review" ? ":" + e.verdict + (e.final ? ":final" : "") : ""}`);
  assert.deepEqual(order.slice(order.indexOf("artifact:build")), [
    "artifact:build", "handoff:engineer>qa", "artifact:qa", "review:qa:changes", "handoff:qa>engineer", "artifact:build:rev", "handoff:engineer>qa", "artifact:qa", "review:qa:approved:final", "handoff:qa>delivery"]);
  assert.equal(summary.revisions, 1);
  assert.equal(summary.calls, 9);
  const fix = m.prompts.find((p) => /REVIEW FEEDBACK from Sinta/.test(p));
  assert.match(fix, /tambahkan validasi/);
  assert.match(fix, /YOUR PREVIOUS VERSION OF THE FILE[\s\S]*<!doctype html>[\s\S]*document\.addEventListener/);
  assert.match(m.prompts.at(-2), /second review/, "the reviewer is told it is the second look");
  assert.equal(events.at(-1).type, "done");
});

test("runTeam: a review that still wants changes after one revision is final: the work goes on with the open points", async () => {
  const m = fakeModel({ verdicts: ["changes", "changes"] });
  const { events } = await collect(body(), { chatFn: m.chat });
  const reviews = events.filter((e) => e.type === "review");
  assert.deepEqual(reviews.map((r) => [r.verdict, r.final]), [["changes", false], ["changes", true]]);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.filter((e) => e.type === "artifact" && e.id === "summary").length, 1, "the summary is still written");
});

test("runTeam: resume: finished steps are not done again, and say so in the plan", async () => {
  const first = fakeModel();
  const run1 = await collect(body(), { chatFn: first.chat, budget: { ...BUDGET, maxCalls: 2 } });
  assert.equal(run1.events.at(-1).type, "paused");
  assert.deepEqual([run1.events.at(-1).reason, run1.events.at(-1).next], ["calls", "design"]);
  const done = Object.fromEntries(run1.events.filter((e) => e.type === "artifact").map((e) => [e.id, { note: e.note, artifact: { kind: e.kind, title: e.title, content: e.content } }]));
  assert.deepEqual(Object.keys(done), ["prd", "stories"]);
  const second = fakeModel();
  const run2 = await collect(body({ done }), { chatFn: second.chat });
  assert.deepEqual(run2.events[0].steps.map((s) => s.status), ["done", "done", "pending", "pending", "pending", "pending", "pending"]);
  assert.equal(second.calls, 5);
  assert.match(second.prompts[0], /- Nadia \(User story/, "the earlier notes came back with the project");
  assert.equal(run2.events.at(-1).type, "done");
  assert.equal(run2.events.at(-1).summary.finished, 7);
});

test("runTeam: it stops cleanly before it runs out of time", async () => {
  let t = 0;
  const m = fakeModel();
  const chat = async (p, o) => { t += 100_000; return m.chat(p, o); };  // each call takes 100 s on the fake clock
  const { events, summary } = await collect(body(), { chatFn: chat, now: () => t });
  assert.deepEqual([events.at(-1).type, events.at(-1).reason], ["paused", "time"]);
  assert.equal(summary.paused, "time");
  assert.ok(summary.calls <= 3, "after about 270 s of fake time");
  assert.ok(!events.some((e) => e.type === "done"));
});

test("runTeam: a failing step is tried twice, then reported with everything before it kept", async () => {
  let failures = 0;
  const m = fakeModel({ fail: (title) => title === "Mockup layar utama" && ++failures <= 1 });
  let { events } = await collect(body(), { chatFn: m.chat });
  assert.equal(events.filter((e) => e.type === "step" && e.phase === "start" && e.id === "design").map((e) => e.attempt).join(), "1,2", "the second try worked");
  assert.equal(events.at(-1).type, "done");
  const down = fakeModel({ fail: (title) => title === "Mockup layar utama" });
  ({ events } = await collect(body(), { chatFn: down.chat }));
  const end = events.find((e) => e.type === "step" && e.phase === "end" && e.status === "failed");
  assert.deepEqual([end.id, end.error], ["design", "model down"]);
  assert.deepEqual([events.at(-1).type, events.at(-1).reason, events.at(-1).next], ["paused", "failed", "design"]);
  assert.deepEqual(events.filter((e) => e.type === "artifact").map((e) => e.id), ["prd", "stories"]);
  const garbled = fakeModel({ reply: () => "Maaf, saya tidak bisa membantu." });
  ({ events } = await collect(body(), { chatFn: garbled.chat }));
  assert.match(events.find((e) => e.status === "failed").error, /kosong atau formatnya tidak terbaca/);
  assert.equal(garbled.calls, 2, "tried twice");
});

test("runTeam: a reply cut off inside a document is carried on and joined", async () => {
  const m = fakeModel({ reply: (title, prompt, n) => (/continue|lanjut/i.test(prompt) && !/YOUR TASK/.test(prompt) ? "bagian kedua yang utuh.\n</document>\n<handoff>selesai.</handoff>" : `<document title="${title}">\n# ${title}\n\nbagian pertama`) });
  const { events, summary } = await collect(body(), { chatFn: m.chat, budget: { ...BUDGET, maxCalls: 2 } });
  const prd = events.find((e) => e.type === "artifact" && e.id === "prd");
  assert.match(prd.content, /bagian pertama[\s\S]*bagian kedua yang utuh/);
  assert.ok(summary.calls >= 2);
});

test("runTeam: when the client asks for a change to one step, only that step runs again, with the feedback and the earlier version", async () => {
  const m0 = fakeModel();
  const first = await collect(body(), { chatFn: m0.chat });
  const done = Object.fromEntries(first.events.filter((e) => e.type === "artifact").map((e) => [e.id, { note: e.note, artifact: { kind: e.kind, title: e.title, content: e.content } }]));
  const m = fakeModel();
  const { events } = await collect(body({ done, only: "stories", feedback: "Tambahkan story untuk laporan bulanan." }), { chatFn: m.chat });
  assert.equal(m.calls, 1);
  assert.match(m.prompts[0], /REVIEW FEEDBACK from the client[\s\S]*Tambahkan story untuk laporan bulanan[\s\S]*YOUR PREVIOUS VERSION[\s\S]*Isi lengkap untuk User story/);
  assert.deepEqual(events.filter((e) => e.type === "artifact").map((e) => e.id), ["stories"]);
  assert.equal(events.at(-1).type, "done");
  assert.ok(!events.some((e) => e.type === "handoff"), "no handoff for a single redo");
});

test("runTeam: when the visitor leaves, it stops quietly: no more work, no 'paused', no 'done'", async () => {
  const ac = new AbortController();
  const m = fakeModel();
  const chat = async (p, o) => { const r = await m.chat(p, o); if (m.calls === 2) ac.abort(); return r; };
  const { events } = await collect(body(), { chatFn: chat, signal: ac.signal });
  assert.equal(m.calls, 2);
  assert.ok(!events.some((e) => ["done", "paused", "error"].includes(e.type)));
});

test("runTeam: a campaign also runs, review of the copy by the analyst included", async () => {
  const m = fakeModel();
  const { events } = await collect(body({ goal: "Kampanye Instagram untuk toko kopi baru", playbook: "campaign" }), { chatFn: m.chat });
  assert.deepEqual(events.filter((e) => e.type === "artifact").map((e) => e.id), ["brief", "calendar", "copy", "channels", "community", "measure"]);
  assert.equal(events.find((e) => e.type === "review").by, "analyst");
  assert.equal(events.at(-1).type, "done");
});

test("backendTeam: protected like /agent, validates the body, and streams the events then an end marker", async () => {
  const env = { PROXY_SECRET: "s3cret" };
  const req = (b, headers = { "x-pro-secret": "s3cret" }, method = "POST") => new Request("https://api.test/team", { method, headers, body: method === "POST" ? (typeof b === "string" ? b : JSON.stringify(b)) : undefined });
  const m = fakeModel();
  const opts = { skills: [], personas, chatFn: m.chat };
  assert.equal((await backendTeam(req({}), {}, opts)).status, 503);
  assert.equal((await backendTeam(req({}, { "x-pro-secret": "no" }), env, opts)).status, 401);
  assert.equal((await backendTeam(req(null, undefined, "GET"), env, opts)).status, 405);
  assert.equal((await backendTeam(req("x".repeat(LIMITS.body + 1)), env, opts)).status, 413);
  const bad = await backendTeam(req({ goal: "" }), env, opts);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /tujuan/);
  const ok = await backendTeam(req({ goal: "Buat aplikasi absensi untuk pabrik", playbook: "software" }), env, opts);
  assert.match(ok.headers.get("Content-Type"), /event-stream/);
  const events = (await ok.text()).split("\n\n").filter((b) => b.startsWith("data:")).map((b) => JSON.parse(b.slice(6)));
  assert.equal(events[0].type, "plan");
  assert.deepEqual(events.slice(-2).map((e) => e.type), ["done", "end"]);
});

test("worker /team: its own rate limit, a bigger body, the secret to the backend, the stream back with CORS; no backend means a clear 503", async () => {
  const ORIGIN = "https://pro.situs.id";
  const call = (body, env, { origin = ORIGIN, path = "/team" } = {}) => worker.fetch(new Request("https://pro-worker.test" + path, { method: "POST", headers: { Origin: origin, "CF-Connecting-IP": "1.2.3.4" }, body: typeof body === "string" ? body : JSON.stringify(body) }), { ALLOWED_ORIGINS: ORIGIN, ...env }, { waitUntil() {} });
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), secret: init.headers["x-pro-secret"], body: init.body }; return new Response('data: {"type":"plan"}\n\ndata: {"type":"end"}\n\n', { headers: { "Content-Type": "text/event-stream" } }); };
  const backend = { BACKEND_URL: "https://api.test/agent", BACKEND_SECRET: "s3cret" };
  const res = await call({ goal: "Buat aplikasi absensi pabrik" }, backend);
  assert.equal(res.status, 200);
  assert.equal(seen.url, "https://api.test/team", "the team path of the same backend");
  assert.equal(seen.secret, "s3cret");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.match(await res.text(), /"type":"plan"/);
  const limited = await call({ goal: "x" }, { ...backend, LIMITER_TEAM: { limit: async () => ({ success: false }) } });
  assert.equal(limited.status, 429);
  const chatLimiter = { limit: async () => { throw new Error("the chat limiter must not count a team run"); } };
  assert.equal((await call({ goal: "x" }, { ...backend, LIMITER: chatLimiter })).status, 200);
  assert.equal((await call({ goal: "x" }, {})).status, 503);
  assert.equal((await call("y".repeat(150_001), backend)).status, 413);
  assert.equal((await call("y".repeat(20_001), backend, { path: "/agent" })).status, 413, "/agent keeps its small limit");
  assert.equal((await call({ goal: "x" }, backend, { origin: "https://evil.example" })).status, 403);
  globalThis.fetch = async () => new Response('{"error":"tuliskan tujuan proyek"}', { status: 400 });
  const bad = await call({ goal: "" }, backend);
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /tujuan/);
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  assert.equal((await call({ goal: "x" }, backend)).status, 502);
});

test("the website playbook: a goal about a page picks it, and its result is the page itself", () => {
  const pb = PLAYBOOKS.website;
  assert.equal(pb.primary, "build", "the result is the engineer's finished page");
  assert.equal(stepById(pb, "build").kind, "mockup");
  assert.equal(stepById(pb, "build").edits, "page", "the engineer finishes the designer's page");
  assert.throws(() => validatePlaybook({ id: "x", steps: [{ id: "a", agent: "po", kind: "document", uses: [], task: "" }, { id: "b", agent: "engineer", kind: "mockup", uses: ["a"], edits: "a", task: "" }] }), /edits a must be an earlier mockup/);
  assert.equal(stepById(pb, "build").agent, "engineer", "the software engineer writes the JavaScript");
  assert.deepEqual(pb.steps.map((s) => s.id), ["brief", "copy", "design", "page", "build", "qa", "launch"]);
  assert.equal(stepById(pb, "design").agent, "designer", "the UI/UX designer writes the design system first");
  assert.equal(stepById(pb, "design").kind, "document");
  assert.deepEqual(stepById(pb, "page").uses, ["brief", "copy", "design"], "the page is built from the copy and the design system");
  assert.deepEqual(stepById(pb, "build").uses, ["page", "copy"], "the engineer builds on the designer's page");
  assert.equal(stepById(pb, "qa").gate.of, "build", "the reviewer looks at the finished page");
  for (const goal of ["Buatkan landing page untuk jasa pembuatan website", "Bikin website company profile untuk CV Maju", "Saya butuh halaman web untuk toko kue", "Landing page promo Ramadan", "one page portfolio fotografer"]) assert.equal(suggestPlaybook(goal), "website", goal);
  assert.equal(suggestPlaybook("Kampanye Instagram untuk toko kopi"), "campaign");
  assert.equal(suggestPlaybook("Aplikasi absensi karyawan pabrik"), "software");
  assert.equal(suggestPlaybook("Fitur reservasi meja untuk restoran"), "software");
  assert.throws(() => validatePlaybook({ id: "x", primary: "ghost", steps: [{ id: "a", agent: "po", kind: "document", uses: [], task: "" }] }), /primary ghost is not a step/);
});

test("runTeam: a draft that is too short is asked for once more, complete; the longer one is kept; a failing second try keeps the draft", async () => {
  // the design system has a minimum (minChars); the page has a maximum instead (maxChars), because the free model must finish it inside a minute
  const web = (o = {}) => body({ goal: "Buatkan landing page untuk jasa pembuatan website", playbook: "website", ...o });
  const doc = (n) => `<document title="Design system">\n# Design system\n\n${"token ".repeat(n)}\n</document><handoff>Palet dan tipografi.</handoff>`;
  const run = async (secondTry) => {
    const prompts = [];
    const chatFn = async (prompt) => {
      prompts.push(prompt);
      const title = titleOf(prompt);
      if (title === "Halaman jadi dengan JavaScript") return { text: `<document title="script.js">document.addEventListener("DOMContentLoaded", () => {});</document><handoff>Catatan skrip.</handoff>` };
      if (title === "Halaman landing page") return { text: `<mockup title="Halaman"><!doctype html><html><body>${"<section>isi</section>".repeat(300)}</body></html></mockup><handoff>n.</handoff>` };
      if (title === "Design system") { const second = /TOO SHORT AND TOO SIMPLE/.test(prompt); return second ? secondTry() : { text: doc(50) }; }
      const gate = /<verdict>approved<\/verdict> or/.test(prompt);
      return { text: `<document title="${title}">\n# ${title}\n\nisi dokumen ${"x".repeat(200)}\n</document><handoff>Catatan ${title}.</handoff>${gate ? "<verdict>approved</verdict>" : ""}` };
    };
    const { events, summary } = await collect(web(), { chatFn });
    return { events, summary, prompts, design: events.find((e) => e.type === "artifact" && e.id === "design") };
  };
  let r = await run(() => ({ text: doc(600) }));
  assert.equal(r.events[0].primary, "build", "the plan names the headline step");
  assert.ok(r.design.content.length > 2500, "the richer version replaced the draft");
  assert.equal(r.prompts.filter((p) => /TOO SHORT AND TOO SIMPLE/.test(p)).length, 1, "asked once, not in a loop");
  assert.match(r.prompts.find((p) => /TOO SHORT AND TOO SIMPLE/.test(p)), /YOUR DRAFT\n# Design system/);
  assert.equal(r.summary.calls, 8, "seven steps and one more call for the design system");
  assert.equal(r.events.at(-1).type, "done");
  assert.match(r.prompts.find((p) => /YOUR TASK: Halaman landing page/.test(p)), /must stay under about 8,000 characters/, "the page is told its size limit");
  assert.equal(r.prompts.filter((p) => /YOUR TASK: Halaman landing page/.test(p)).length, 1, "a page is never sent back for being short");
  r = await run(() => { throw new Error("model down"); });
  assert.ok(r.design.content.length < 2500 && r.design.content.length > 100, "the draft is kept when the second try fails");
  assert.equal(r.events.at(-1).type, "done");
  r = await run(() => ({ text: doc(20) }));
  assert.ok(r.design.content.length > 200, "an answer that is not longer is not taken");
  const software = fakeModel();
  await collect(body({ goal: "Kampanye Instagram untuk toko kopi", playbook: "campaign" }), { chatFn: software.chat });
  assert.equal(software.prompts.filter((p) => /TOO SHORT/.test(p)).length, 0, "playbooks without a minimum are untouched");
});

test("a project step never carries the persona's chat rules (short replies, questions first, one file per message), but keeps who they are and how they work", () => {
  for (const [id, text] of personas) {
    const p = buildStepPrompt({ step: stepById(PLAYBOOKS.website, "copy"), goal: "Landing page toko kopi", results: new Map(), persona: text, skill: "", playbook: PLAYBOOKS.website });
    assert.doesNotMatch(p, /three short paragraphs|ask at most two focused questions|one file per message|do not paste it into the chat|Just answer the user's message/, id);
    assert.match(p, /Stay in character as \w+/, `${id}: the identity stays`);
    assert.ok(projectPersona(text).split("\n").filter((l) => l.startsWith("- ")).length >= 4, `${id}: the professional rules stay`);
  }
});
