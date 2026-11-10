import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COORDINATOR,
  GROUPS,
  groupOf,
  buildScreenPrompt,
  parseScreenReply,
  buildRound1Prompt,
  buildRound2Prompt,
  isPassReply,
  extractNumberedQuestions,
  hasNumberedQuestions,
  buildSummaryPrompt,
  buildRound3Prompt,
  buildFinalSummaryPrompt,
} from "../src/discuss.js";
import * as C from "../office/core.js";
import { OFFICE_COORDINATOR } from "../office/office.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const officeJs = readFileSync(new URL("../office/office.js", import.meta.url), "utf8");
const AGENT_IDS = [...html.matchAll(/^\s*\{ id: "(\w+)", name: "\w+", persona:/gm)].map((m) => m[1]);

test("navigation has 4 icon-only mode buttons: chat, discussion, project, office", () => {
  assert.match(html, /\.modes button span \{ display: none; \}/, "mode buttons are icon-only");
  assert.match(html, /for \(const mode of \["chat", "discussion", "project", "office"\]\)/);
  for (const mode of ["chat", "office", "project", "discussion"]) {
    assert.match(html, new RegExp(`${mode}:\\s*'<svg viewBox="0 0 24 24"`), `icon for ${mode}`);
  }
  assert.match(html, /h === "#diskusi" \? \{ view: "discussion" \}/);
});

test("3 discussion groups (Software House, Social Media, All) cover the roster and have avatar paths ready", () => {
  assert.deepEqual(
    GROUPS.map((g) => [g.id, g.name, g.avatar, g.members.length]),
    [
      ["group:software", "Software House", "personas/group-software.jpg", 7],
      ["group:social", "Social Media", "personas/group-social.jpg", 6],
      ["group:all", "All", "personas/group-all.jpg", 13],
    ],
  );
  assert.deepEqual(groupOf("group:all")?.members, AGENT_IDS);
  for (const g of GROUPS) {
    assert.match(html, new RegExp(`id: "${g.id}"`), `${g.id} in index.html`);
  }
});

test("Coordinator screener prompt and parser select only valid members of the active group", () => {
  const prompt = buildScreenPrompt(
    "Bagaimana arsitektur autentikasi JWT dan tampilan form login-nya?",
    "group:software",
  );
  assert.match(prompt, /"engineer": Bima/);
  assert.match(prompt, /"designer": Kirana/);
  assert.doesNotMatch(prompt, /"smm": Tara/, "Social Media members are not offered in Software House group");

  const parsed = parseScreenReply(
    '```json\n{"answerable": true, "agents": ["engineer", "designer", "smm", "engineer"], "intro": "Bima dan Kirana akan membahas sisi backend serta UI login."}\n```',
    "group:software",
  );
  assert.equal(parsed.answerable, true);
  assert.deepEqual(parsed.agents, ["engineer", "designer"], "deduplicated and filtered to group members");
  assert.match(parsed.intro, /Bima dan Kirana/);

  const rejected = parseScreenReply(
    '{"answerable": false, "agents": [], "intro": "Pertanyaan ini di luar cakupan tim Software House."}',
    "group:software",
  );
  assert.equal(rejected.answerable, false);
  assert.deepEqual(rejected.agents, []);

  const fallback = parseScreenReply("Maaf format tidak sesuai", "group:software", "Tanya Bima soal database");
  assert.equal(fallback.answerable, true);
  assert.deepEqual(fallback.agents, ["engineer"]);
});

test("2-round discussion, numbered clarifying questions (1. ...? 2. ...?), and Round 3 after user answers", () => {
  const r1 = buildRound1Prompt({
    question: "Buat sistem login",
    groupId: "group:software",
    agentId: "designer",
    pickedIds: ["engineer", "designer"],
    round1SoFar: [{ id: "engineer", text: "Gunakan HttpOnly cookie untuk menyimpan sesi. Apakah perlu SSO Google?" }],
  });
  assert.match(r1, /ROUND 1/);
  assert.match(r1, /Bima \(Software Engineer\): Gunakan HttpOnly cookie/);

  const r2 = buildRound2Prompt({
    question: "Buat sistem login",
    groupId: "group:software",
    agentId: "engineer",
    round1: [
      { id: "engineer", text: "Gunakan HttpOnly cookie. Apakah perlu SSO Google?" },
      { id: "designer", text: "Untuk tampilan mobile atau desktop terlebih dahulu?" },
    ],
    round2SoFar: [],
  });
  assert.match(r2, /ROUND 2/);
  assert.match(r2, /<pass\/>/);

  assert.equal(isPassReply("<pass/>"), true);
  assert.equal(isPassReply("  <pass> "), true);
  assert.equal(isPassReply("Untuk error state, API akan mengembalikan kode spesifik per field."), false);

  const numbered = extractNumberedQuestions(
    [
      { id: "engineer", text: "Kita bisa pakai JWT. Apakah perlu login dengan Google SSO?" },
      { id: "designer", text: "Saya siap buat wireframe. Apakah target utamanya layar mobile atau desktop?" },
    ],
    [],
  );
  assert.match(numbered, /^1\. Apakah perlu login dengan Google SSO\? \(Bima\)\n2\. Apakah target utamanya layar mobile atau desktop\? \(Kirana\)$/);
  assert.equal(hasNumberedQuestions(numbered), true);

  const sum = buildSummaryPrompt({
    question: "Buat sistem login",
    groupId: "group:software",
    round1: [
      { id: "engineer", text: "Gunakan HttpOnly cookie. Apakah perlu login dengan Google SSO?" },
      { id: "designer", text: "Form login dengan validasi input. Apakah target utamanya layar mobile atau desktop?" },
    ],
    round2: [
      { id: "engineer", text: "Tambahkan kode error per field dan proteksi CSRF." },
    ],
  });
  assert.match(sum, /Round 1 \(Specialist Perspectives\)/);
  assert.match(sum, /Round 2 \(Follow-up & Cross-Role Additions\)/);
  assert.match(sum, /1\. \.\.\.\?/);
  assert.match(sum, /2\. \.\.\.\?/);

  const r3 = buildRound3Prompt({
    question: "Buat sistem login",
    coordinatorQuestions: numbered,
    userAnswer: "1. Ya pakai Google SSO. 2. Utamakan mobile.",
    groupId: "group:software",
    agentId: "engineer",
    round1: [{ id: "engineer", text: "Gunakan HttpOnly cookie." }],
    round2: [],
    round3SoFar: [],
  });
  assert.match(r3, /ROUND 3/);
  assert.match(r3, /1\. Ya pakai Google SSO\. 2\. Utamakan mobile\./);

  const finalSum = buildFinalSummaryPrompt({
    question: "Buat sistem login",
    userAnswer: "1. Ya pakai Google SSO. 2. Utamakan mobile.",
    groupId: "group:software",
    round1: [{ id: "engineer", text: "Gunakan HttpOnly cookie." }],
    round2: [],
    round3: [{ id: "engineer", text: "OAuth2 PKCE + HttpOnly session untuk mobile web." }],
  });
  assert.match(finalSum, /After Round 3/);
  assert.ok(COORDINATOR.name);
});

test("meeting room has 2 tables and 16 chairs, and all 13 specialists + Coordinator (14 people) sit at the meeting tables during a discussion", () => {
  const tables = C.FURNITURE.filter((f) => f.type === "meetingtable");
  assert.equal(tables.length, 2, "two conference tables in the meeting room");
  const meetingChairs = C.POIS.filter((p) => p.id.startsWith("meeting-"));
  assert.equal(meetingChairs.length, 16, "16 meeting chairs (>= 14 people including Coordinator)");

  assert.equal(OFFICE_COORDINATOR.id, "coordinator");
  assert.equal(OFFICE_COORDINATOR.noChat, true, "Coordinator cannot be chatted with directly");
  assert.ok(C.LOOKS.coordinator, "Coordinator has a 3D look in the virtual office");
  assert.equal(C.DESKS.coordinator, undefined, "Coordinator has no personal desk");
  assert.match(officeJs, /if \(ag\?\.noChat \|\| id === "coordinator"\) \{\s*pinpointed = pinpointed === id \? null : id;\s*return;\s*\}/, "clicking Coordinator only pinpoints him without opening chat");

  const allIds = [...AGENT_IDS, "coordinator"];
  const sim = C.createSim({ ids: allIds });
  sim.update(1 / 30, {}); // first frame: office is open before the discussion starts
  const meetingState = Object.fromEntries(
    allIds.map((id) => [id, { busy: true, meeting: true, status: "berdiskusi…" }]),
  );
  for (let t = 0; t < 35; t += 1 / 30) sim.update(1 / 30, meetingState);

  const spots = new Set();
  for (const id of allIds) {
    const p = sim.agents.get(id);
    assert.equal(p.goal, "meeting", `${id} has goal=meeting`);
    assert.equal(p.mode, "seated", `${id} is seated at a meeting chair`);
    assert.equal(p.action, "talk", `${id} is talking/collaborating at the table`);
    assert.match(p.poi, /^meeting-\d+$/, `${id} is on a meeting chair, never a personal desk`);
    spots.add(p.poi);
  }
  assert.equal(spots.size, allIds.length, "all 14 people (13 specialists + Coordinator) have distinct chairs at the meeting tables");
});
