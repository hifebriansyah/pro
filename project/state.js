// A team project on the page, without any DOM: its shape, how every event of a run (src/team.js) updates it, what is sent back to resume it, and how
// projects are kept in the browser. Pure, so Node tests run it; project/view.js draws it.
import { PLAYBOOKS, suggestPlaybook } from "../src/playbooks.js";

export const KEY = "islam-chat:projects:v1";
export const MAX_PROJECTS = 12;
export const MAX_FEED = 80;
const MAX_STORED_CHARS = 1_200_000; // a quarter of what a browser usually allows; older projects go first

let counter = 0;
export const newId = (now = Date.now()) => `p${now.toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const titleFrom = (goal) => { const t = String(goal).trim().replace(/\s+/g, " "); return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, "") + "…" : t; };

export function newProject({ goal, playbook, provider = "quran", now = Date.now() }) {
  const pb = PLAYBOOKS[playbook] ? playbook : suggestPlaybook(goal);
  return {
    id: newId(now), title: titleFrom(goal), goal: String(goal).trim(), playbook: pb, provider, createdAt: now, updatedAt: now,
    primary: PLAYBOOKS[pb].primary ?? null, // the step whose deliverable is the result itself (the landing page): the screen opens it and offers it for download
    status: "draft", // draft (not started), running, paused (out of time or stopped: can continue), failed (a step failed: retry), done
    plan: PLAYBOOKS[pb].steps.map((s) => ({ id: s.id, agent: s.agent, title: s.title, kind: s.kind, gate: !!s.gate })),
    steps: {}, artifacts: {}, reviews: {}, feed: [], pause: null,
  };
}

const step = (p, id) => (p.steps[id] ??= { status: "pending", attempt: 0, revision: 0, error: null, startedAt: null, endedAt: null });
const feed = (p, item, now) => { p.feed.push({ t: now, ...item }); if (p.feed.length > MAX_FEED) p.feed.splice(0, p.feed.length - MAX_FEED); };

/** Apply one event of a run to the project (in place) and return it. Unknown events are ignored. */
export function applyEvent(p, ev, now = Date.now()) {
  p.updatedAt = now;
  switch (ev?.type) {
    case "plan":
      p.plan = ev.steps.map((s) => ({ id: s.id, agent: s.agent, name: s.name, role: s.role, title: s.title, kind: s.kind, gate: !!s.gate }));
      for (const s of ev.steps) { const st = step(p, s.id); if (s.status === "done" && p.artifacts[s.id]) st.status = "done"; else if (st.status !== "done") st.status = "pending"; }
      p.primary = ev.primary ?? p.primary ?? null;
      p.status = "running"; p.pause = null; p.error = null;
      break;
    case "step": {
      const st = step(p, ev.id);
      if (ev.phase === "start") { Object.assign(st, { status: "running", attempt: ev.attempt ?? 1, revision: ev.revision ?? st.revision, error: null, startedAt: now, endedAt: null }); p.current = ev.id; }
      else if (ev.phase === "end") { st.status = ev.status === "failed" ? "failed" : "done"; st.error = ev.error ?? null; st.endedAt = now; if (st.status === "failed") feed(p, { type: "failed", agent: ev.agent, step: ev.id, text: ev.error ?? "gagal" }, now); }
      break;
    }
    case "artifact":
      p.artifacts[ev.id] = { kind: ev.kind, title: ev.title, content: ev.content, note: ev.note ?? "", revision: ev.revision ?? 0 };
      step(p, ev.id).status = "done";
      break;
    case "handoff": feed(p, { type: "handoff", from: ev.from, to: ev.to, text: ev.note ?? "" }, now); break;
    case "review": p.reviews[ev.id] = { by: ev.by, verdict: ev.verdict, changes: ev.changes ?? "", final: !!ev.final }; break;
    case "paused": p.status = ev.reason === "failed" ? "failed" : "paused"; p.pause = { reason: ev.reason, next: ev.next }; p.current = null; break;
    case "done": p.status = "done"; p.pause = null; p.current = null; p.summary = ev.summary ?? null; break;
    case "error": p.error = String(ev.message ?? "gagal"); if (p.status === "running") p.status = "paused"; break;
    case "end": if (p.status === "running") p.status = "paused"; break; // the stream ended without a verdict: it can be continued
  }
  return p;
}

/** The body of POST /team: the goal, and the finished work to resume from (only steps that are done and have a result). */
export function runBody(p, { only, feedback } = {}) {
  const done = {};
  for (const s of p.plan) {
    const a = p.artifacts[s.id];
    if (p.steps[s.id]?.status === "done" && a) done[s.id] = { note: a.note, artifact: { kind: a.kind, title: a.title, content: a.content } };
  }
  return { goal: p.goal, playbook: p.playbook, provider: p.provider, done, ...(only ? { only, feedback: feedback ?? "" } : {}) };
}

/** The headline deliverable of a project that has one and has it: {id, ...artifact}, or null. */
export const primaryArtifact = (p) => (p.primary && p.artifacts[p.primary] ? { id: p.primary, ...p.artifacts[p.primary] } : null);

export const progress = (p) => ({ done: p.plan.filter((s) => p.steps[s.id]?.status === "done" && p.artifacts[s.id]).length, total: p.plan.length });

/** What the primary button should do. */
export function nextAction(p) {
  if (p.status === "running") return "stop";
  if (p.status === "done") return "none";
  if (p.status === "failed") return "retry";
  if (p.status === "paused") return "continue";
  return "start";
}

/** A project that was running when the page closed is not running any more: it can be continued. */
export function settle(list) { for (const p of list) if (p.status === "running") { p.status = "paused"; p.pause = p.pause ?? { reason: "stopped", next: null }; for (const st of Object.values(p.steps)) if (st.status === "running") st.status = "pending"; } return list; }

/** All the documents of a finished (or partly finished) project as one Markdown file; a mockup goes in as an HTML block. */
export function bundleMarkdown(p, names = {}) {
  const out = [`# ${p.title}`, "", `> Tujuan: ${p.goal}`, `> Dibuat oleh tim virtual · ${new Date(p.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`];
  for (const s of p.plan) {
    const a = p.artifacts[s.id];
    if (!a) continue;
    out.push("", "---", "", `## ${s.title}`, `_${names[s.agent] ?? s.name ?? s.agent}${s.role ? ` · ${s.role}` : ""}_`, "");
    out.push(a.kind === "mockup" ? "```html\n" + a.content.trim() + "\n```" : a.content.trim().replace(/^#\s+.+\n+/, ""));
  }
  return out.join("\n") + "\n";
}

export function load(storage) {
  try { const list = JSON.parse(storage.getItem(KEY) || "[]"); return settle(Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && Array.isArray(p.plan)) : []); } catch { return []; }
}
/** Save newest first, at most MAX_PROJECTS and about MAX_STORED_CHARS; returns what was kept. */
export function save(storage, list) {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROJECTS);
  let json = JSON.stringify(sorted);
  while (json.length > MAX_STORED_CHARS && sorted.length > 1) { sorted.pop(); json = JSON.stringify(sorted); }
  try { storage.setItem(KEY, json); } catch { /* full or blocked: the project stays in memory */ }
  return sorted;
}
