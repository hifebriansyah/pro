// Group discussions: three groups (Software House, Social Media, All), a Coordinator that screens who in the group should answer,
// two rounds of specialist perspectives at the meeting table (Round 2 is optional after hearing Round 1), and a Coordinator summary at the end.
// Pure functions and data, no DOM and no node: modules, so the page, the Worker, the backend and the tests can all use it.
import { ROSTER, byId } from "./roster.js";

export const COORDINATOR = {
  id: "coordinator",
  name: "Koordinator",
  role: "Coordinator",
  color: "#0f766e",
  about: "Koordinator Diskusi · Menyaring & merangkum",
};

export const GROUPS = [
  {
    id: "group:software",
    key: "software",
    name: "Software House",
    avatar: "personas/group-software.jpg",
    color: "#2563eb",
    about: "Software House · 7 spesialis",
    members: ROSTER.filter((p) => p.group === "Software House").map((p) => p.id),
  },
  {
    id: "group:social",
    key: "social",
    name: "Social Media",
    avatar: "personas/group-social.jpg",
    color: "#e11d48",
    about: "Social Media · 6 spesialis",
    members: ROSTER.filter((p) => p.group === "Social Media").map((p) => p.id),
  },
  {
    id: "group:all",
    key: "all",
    name: "All",
    avatar: "personas/group-all.jpg",
    color: "#d97706",
    about: "Software House & Social Media · 13 spesialis",
    members: ROSTER.map((p) => p.id),
  },
];

export const GROUP_IDS = GROUPS.map((g) => g.id);
export const groupOf = (id) => GROUPS.find((g) => g.id === id || g.key === id) ?? null;

const ROLE_HINTS = {
  po: "product vision, scope, priorities, PRD, user value, roadmap",
  ba: "business requirements, user stories, acceptance criteria, process flows, edge cases",
  engineer: "software architecture, code, APIs, database, frontend/backend implementation, performance",
  qa: "testing strategy, test cases, quality assurance, bugs, edge cases, release readiness",
  designer: "UI/UX design, layout, user flow, wireframes, HTML/CSS mockups, SVG logos/icons, accessibility",
  devops: "deployment, CI/CD, cloud infrastructure, hosting, monitoring, reliability, security",
  delivery: "project timeline, milestones, risk management, team coordination, delivery plan",
  brand: "brand positioning, identity, tone of voice, differentiation, audience perception",
  planner: "content strategy, content pillars, editorial calendar, publishing cadence",
  smm: "social media platforms (Instagram, TikTok, LinkedIn, X), growth, campaigns, engagement tactics",
  community: "community building, moderation, customer replies, crisis response, loyalty",
  copywriter: "captions, hooks, headlines, ad copy, scripts, storytelling, CTA",
  analyst: "social media metrics, KPIs, engagement rate, conversion tracking, A/B testing, insights",
};

/**
 * Prompt for the Coordinator screener (inspired by guru/agents/screener.md):
 * decides whether the group can answer and picks the specialists whose roles fit the question.
 */
export function buildScreenPrompt(question, groupId) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const list = g.members.map((id) => {
    const p = byId(id);
    return `- "${id}": ${p.name} — ${p.role} (${p.group}): ${ROLE_HINTS[id] ?? p.role}`;
  }).join("\n");
  return [
    "# Coordinator: decides which specialists in the group join the discussion",
    "",
    "## Who you are",
    `You are the Coordinator of the "${g.name}" group discussion. You do not answer the user's question yourself yet. First, you read the question and decide whether the specialists in this group can speak to it, and if so, which specialists should sit at the meeting table and answer.`,
    "",
    "## Available specialists in this group",
    list,
    "",
    "## How you decide",
    "- **Answerable (`true`):** any question, idea, problem, review, or request where at least one specialist in the list above has relevant professional expertise (software product, engineering, UI/UX design, QA, DevOps, project delivery, branding, content, social media, copywriting, analytics, business, career, or building/designing something).",
    "- **Pick only the specialists who truly have a distinct, valuable angle on this question** (typically 2 to 5 specialists; pick 1 if the question is strictly for one role or names one person; pick more if it is a broad cross-functional question). Order them in the natural sequence they should speak.",
    "- If the user explicitly names certain people or roles (e.g. \"tanya Raka dan Bima\" or \"dari sisi UI dan backend\"), pick those specialists.",
    "- **Not answerable (`false`):** pure greetings with no question (\"halo\", \"tes\"), gibberish, or topics completely outside the group's world (for example asking the Software House group a pure social-media-only question with no software angle, or asking for today's weather).",
    "- Do NOT call any tools (`TOOL:`). Reply with JSON only.",
    "",
    "## Your output",
    "Reply with JSON only, in exactly this shape and nothing else:",
    '{"answerable": true, "agents": ["po", "designer", "engineer"], "intro": "Koordinator mengundang Raka, Kirana, dan Bima ke meja rapat untuk membahas ini dari sisi produk, desain, dan teknis."}',
    "",
    "- `answerable`: true or false.",
    "- `agents`: array of specialist ids from the list above; empty `[]` when `answerable` is false.",
    "- `intro`: one or two short sentences in the language of the user's question. When `answerable` is true, briefly state who is joining the discussion and why. When `answerable` is false, kindly explain that this question is outside this group's scope and suggest what to ask.",
    "",
    `User question: ${String(question ?? "").trim()}`,
  ].join("\n");
}

function extractJsonObject(text) {
  const s = String(text ?? "");
  const at = s.indexOf("{");
  if (at < 0) return null;
  let depth = 0, inStr = false;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(s.slice(at, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/**
 * Parse the Coordinator screener's reply: { answerable, agents, intro }.
 * Like guru's screen(), if the model returns broken JSON, fall back to a sensible set of specialists so a broken screener never blocks a real question.
 */
export function parseScreenReply(text, groupId, question = "") {
  const g = groupOf(groupId) ?? GROUPS[2];
  const allowed = new Set(g.members);
  const obj = extractJsonObject(text);
  if (obj && typeof obj.answerable === "boolean") {
    const raw = Array.isArray(obj.agents) ? obj.agents : Array.isArray(obj.specialists) ? obj.specialists : [];
    const agents = [...new Set(raw.filter((id) => typeof id === "string" && allowed.has(id)))];
    if (!obj.answerable) {
      const intro = String(obj.intro || obj.message || "Pertanyaan ini di luar cakupan diskusi grup ini.").trim().slice(0, 500);
      return { answerable: false, agents: [], intro };
    }
    if (agents.length) {
      const names = agents.map((id) => byId(id)?.name).filter(Boolean).join(", ");
      const intro = String(obj.intro || obj.message || `Koordinator mengundang ${names} ke meja rapat.`).trim().slice(0, 500);
      return { answerable: true, agents, intro };
    }
  }
  // Fallback when the model did not return valid JSON or left agents empty: check if any member names/ids were mentioned, else pick up to 3 core members
  const q = `${question} ${text}`.toLowerCase();
  const mentioned = g.members.filter((id) => {
    const p = byId(id);
    return new RegExp(`\\b${id}\\b`, "i").test(q) || new RegExp(`\\b${p.name}\\b`, "i").test(q) || q.includes(p.role.toLowerCase());
  });
  const agents = mentioned.length ? mentioned.slice(0, 5) : g.members.slice(0, 3);
  const names = agents.map((id) => byId(id)?.name).filter(Boolean).join(", ");
  return {
    answerable: true,
    agents,
    intro: `Koordinator mengundang ${names} ke meja rapat untuk membahas pertanyaan ini.`,
  };
}

/**
 * Build the prompt for a specialist's Round 1 turn.
 * round1SoFar: [{ id, text, docs?, mockups? }] from specialists who already spoke in Round 1.
 */
export function buildRound1Prompt({ question, groupId, agentId, pickedIds = [], round1SoFar = [], history = "" }) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const me = byId(agentId);
  const peers = pickedIds.filter((id) => id !== agentId).map((id) => { const p = byId(id); return p ? `${p.name} (${p.role})` : id; }).join(", ");
  const earlier = round1SoFar.length
    ? "\n\nWhat your colleagues have already said in Round 1 (do not repeat their points; focus on your own specialist angle):\n" +
      round1SoFar.map((r) => {
        const p = byId(r.id);
        const extras = [...(r.docs ?? []).map((d) => `[Dokumen: ${d.title}]`), ...(r.mockups ?? []).map((m) => `[Mockup: ${m.title}]`)].join(" ");
        return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 600)}${extras ? " " + extras : ""}`;
      }).join("\n")
    : "";
  const hist = history ? `\n\nEarlier in this group chat (background only):\n${history}` : "";
  return [
    `GROUP DISCUSSION (${g.name}) — ROUND 1 (Specialist Perspective)`,
    `You are sitting at the meeting room table with: ${peers || "your team"}.`,
    `Speak strictly from your perspective as ${me ? `${me.name} (${me.role})` : agentId}. Focus on what matters most in your domain, give concrete advice, and do not try to cover everybody else's job (the Coordinator will summarize after Round 2).`,
    "If the user's request calls for a deliverable in your domain (a Markdown document, an HTML mockup, or an SVG logo/icon), you may create it.",
    hist,
    earlier,
    `\nUser question: ${String(question ?? "").trim()}`,
    "\n(Reply in the language of the user's question above.)",
  ].filter(Boolean).join("\n");
}

/**
 * Build the prompt for a specialist's Round 2 turn (after everyone has spoken in Round 1).
 * Adding a message in Round 2 is optional: the specialist can reply with <pass/> if nothing needs to be added.
 */
export function buildRound2Prompt({ question, groupId, agentId, round1 = [], round2SoFar = [] }) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const me = byId(agentId);
  const r1Text = round1.map((r) => {
    const p = byId(r.id);
    const extras = [...(r.docs ?? []).map((d) => `[Dokumen: ${d.title}]`), ...(r.mockups ?? []).map((m) => `[Mockup: ${m.title}]`)].join(" ");
    return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 800)}${extras ? " " + extras : ""}`;
  }).join("\n");
  const r2Text = round2SoFar.length
    ? "\n\nRound 2 additions so far:\n" +
      round2SoFar.map((r) => {
        const p = byId(r.id);
        return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 500)}`;
      }).join("\n")
    : "";
  return [
    `GROUP DISCUSSION (${g.name}) — ROUND 2 (Cross-Specialist Response, Optional)`,
    `You are ${me ? `${me.name} (${me.role})` : agentId}. Everyone at the meeting table has finished Round 1.`,
    "",
    `User question: ${String(question ?? "").trim()}`,
    "",
    "Round 1 answers from the table:",
    r1Text,
    r2Text,
    "",
    "## Instructions for Round 2",
    "- You have now heard all of your colleagues' thoughts from Round 1.",
    "- Adding a message in Round 2 is **allowed but optional**.",
    "- Speak ONLY if you have a concrete reaction to a colleague's point, an important trade-off or dependency between their proposal and your role, a missing risk, or a follow-up improvement.",
    "- Keep it concise and focused on the interaction between your role and what others said (no need to repeat your Round 1 answer).",
    "- If your Round 1 answer and your colleagues' points already cover everything well and you have nothing substantive to add, reply with ONLY `<pass/>` and nothing else.",
    "",
    "(If you reply, write in the language of the user's question above.)",
  ].filter(Boolean).join("\n");
}

/** True when a Round 2 reply chose to pass rather than add another message. */
export function isPassReply(text) {
  const s = String(text ?? "").trim();
  return !s || /^(?:<pass\s*\/?>|pass|skip|lewati|tidak ada tambahan\.?|cukup\.?)$/i.test(s);
}

/**
 * Extract questions asked by specialists in Round 1 and Round 2 into a numbered list ("1. ...?\n2. ...?").
 * Used both to detect whether the team has clarifying questions and as an instant fallback if the Coordinator hits a rate limit (429).
 */
export function extractNumberedQuestions(round1 = [], round2 = []) {
  const seen = new Set();
  const questions = [];
  for (const r of [...round1, ...round2]) {
    const p = byId(r.id);
    const text = String(r.text ?? "");
    // Match sentences/lines that end with a question mark
    const matches = text.match(/(?:[^.!?\n]|(?:\d+\.\s))+?\?/g) ?? [];
    for (const raw of matches) {
      const q = raw
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
        .replace(/^\s*\*+|\*+\s*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (q.length < 10 || q.length > 320) continue;
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(p ? `${q} (${p.name})` : q);
    }
  }
  if (!questions.length) return "";
  return questions.slice(0, 8).map((q, i) => `${i + 1}. ${q}`).join("\n");
}

/** True when the Coordinator's Round 2 message includes a numbered list of questions ("1. ...?") for Round 3. */
export function hasNumberedQuestions(text) {
  return /(?:^|\n)\s*1[.)]\s+[^\n]*\?/m.test(String(text ?? ""));
}

/**
 * Build the prompt for the Coordinator's summary after Round 2.
 * If the specialists asked clarifying questions, the Coordinator summarizes the discussion and lists the consolidated questions as:
 * 1. ...?
 * 2. ...?
 * so the user can answer them to trigger Round 3.
 */
export function buildSummaryPrompt({ question, groupId, round1 = [], round2 = [] }) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const fmt = (list) => list.map((r) => {
    const p = byId(r.id);
    const extras = [...(r.docs ?? []).map((d) => `[Dokumen: ${d.title}]`), ...(r.mockups ?? []).map((m) => `[Mockup: ${m.title}]`)].join(" ");
    return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 900)}${extras ? " " + extras : ""}`;
  }).join("\n");
  const detectedQuestions = extractNumberedQuestions(round1, round2);
  return [
    `# Coordinator Summary (${g.name})`,
    "You are the Coordinator of the group discussion. Both Round 1 and Round 2 at the meeting table are now over.",
    "Synthesize all specialists' perspectives into a clear, actionable summary for the user:",
    "1. **Inti Kesepakatan / Pandangan Tim**: how the different specialist angles fit together.",
    "2. **Catatan Silang / Trade-off Penting**: key dependencies or tensions raised across roles (especially from Round 2).",
    detectedQuestions
      ? [
          "3. **Pertanyaan Klarifikasi untuk Putaran 3**: the specialists raised questions for the user. Consolidate, deduplicate, and summarize their questions at the end as a clean numbered list ending with question marks:",
          "1. ...?",
          "2. ...?",
          "Tell the user briefly that once they reply with their answers, the team will continue into **Putaran 3 (Round 3)**.",
        ].join("\n")
      : "3. **Langkah Selanjutnya**: concrete recommended next steps.",
    "Keep it concise, well-structured, and written in the language of the user's question.",
    "",
    `User question: ${String(question ?? "").trim()}`,
    "",
    "Round 1 (Specialist Perspectives):",
    fmt(round1) || "(none)",
    "",
    "Round 2 (Follow-up & Cross-Role Additions):",
    round2.length ? fmt(round2) : "(no additional comments in Round 2)",
  ].join("\n");
}

/**
 * Build the prompt for a specialist's Round 3 turn, after the user has answered the Coordinator's numbered questions.
 */
export function buildRound3Prompt({
  question,
  coordinatorQuestions = "",
  userAnswer,
  groupId,
  agentId,
  round1 = [],
  round2 = [],
  round3SoFar = [],
}) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const me = byId(agentId);
  const fmt = (list) => list.map((r) => {
    const p = byId(r.id);
    return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 500)}`;
  }).join("\n");
  const r3Text = round3SoFar.length ? `\n\nRound 3 responses from colleagues so far:\n${fmt(round3SoFar)}` : "";
  return [
    `GROUP DISCUSSION (${g.name}) — ROUND 3 (Final Specialist Recommendation after User Clarification)`,
    `You are ${me ? `${me.name} (${me.role})` : agentId}, sitting at the meeting table.`,
    "In Rounds 1 & 2, the team discussed the user's initial request and the Coordinator summarized numbered clarifying questions. The user has now answered those questions.",
    "",
    `Initial user question: ${String(question ?? "").trim()}`,
    "",
    "Round 1 & 2 summary / Coordinator's numbered questions:",
    String(coordinatorQuestions ?? "").slice(0, 1200),
    "",
    `User's answers for Round 3: ${String(userAnswer ?? "").trim()}`,
    r3Text,
    "",
    "## Instructions for Round 3",
    "- Give your concrete, final specialist recommendation or deliverable based on the user's answers.",
    "- Do NOT ask more clarifying questions — make reasonable assumptions for anything left minor and deliver a practical answer from your role.",
    "- If a deliverable in your domain (a Markdown document, HTML mockup, or SVG) is appropriate, create it now.",
    "",
    "(Reply in the language of the user's message above.)",
  ].filter(Boolean).join("\n");
}

/**
 * Build the prompt for the Coordinator's final synthesis after Round 3 is complete.
 */
export function buildFinalSummaryPrompt({ question, userAnswer, groupId, round1 = [], round2 = [], round3 = [] }) {
  const g = groupOf(groupId) ?? GROUPS[2];
  const fmt = (list) => list.map((r) => {
    const p = byId(r.id);
    const extras = [...(r.docs ?? []).map((d) => `[Dokumen: ${d.title}]`), ...(r.mockups ?? []).map((m) => `[Mockup: ${m.title}]`)].join(" ");
    return `- ${p ? `${p.name} (${p.role})` : r.id}: ${String(r.text ?? "").slice(0, 800)}${extras ? " " + extras : ""}`;
  }).join("\n");
  return [
    `# Coordinator Final Summary — After Round 3 (${g.name})`,
    "You are the Coordinator of the group discussion. Round 3 (after the user answered the clarifying questions) is now complete.",
    "Write a clear, final synthesis for the user:",
    "1. **Keputusan & Solusi Akhir Tim**: the concrete plan/decisions agreed across all specialists based on the user's answers.",
    "2. **Rincian per Bidang**: key deliverables and action items from each specialist.",
    "3. **Langkah Eksekusi Berikutnya**: immediate next steps to execute.",
    "Do NOT ask further questions.",
    "",
    `Initial question: ${String(question ?? "").trim()}`,
    `User's clarification answers: ${String(userAnswer ?? "").trim()}`,
    "",
    "Round 1 & 2 highlights:",
    fmt([...round1, ...round2]).slice(0, 1500) || "(none)",
    "",
    "Round 3 (Final Specialist Recommendations):",
    fmt(round3) || "(none)",
  ].join("\n");
}
