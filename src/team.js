// The team at work: a project goes through a playbook (src/playbooks.js) one step at a time. Each step is one professional writing one deliverable
// from the goal, the handoff notes of the steps before and the full text of the few they need. A review step can send work back once. Everything is
// reported as events (the page draws them, and the office shows who is doing what); a run stops cleanly when it is out of time and can be resumed,
// because the page keeps every result and sends the finished ones back.
//
//   {type:"plan",playbook,title,steps:[{id,agent,name,role,title,kind,gate,status}]}
//   {type:"step",phase:"start"|"part"|"end",id,agent,name,attempt,revision?,status?,error?}
//   {type:"artifact",id,kind:"document"|"mockup",title,content,note,revision}
//   {type:"handoff",from,to,note}   {type:"review",id,by,verdict:"approved"|"changes",changes,final}
//   {type:"paused",reason:"time"|"calls"|"failed",next}   {type:"error",message}   {type:"done",summary}
import { extractDocuments, extractMockups, finishReply } from "./agent.js";
import { PLAYBOOKS, stepById, suggestPlaybook } from "./playbooks.js";
import { PROVIDERS } from "./quran.js";
import { ROSTER, byId } from "./roster.js";
import { assemble, bareCode, lastScript, outlineOf, scriptProblem } from "./pagecode.js";

export const LIMITS = { goal: 2000, note: 800, artifact: 60_000, feedback: 1500, body: 150_000 };
export const BUDGET = { maxCalls: 18, maxMs: 270_000, firstStepMs: 40_000 }; // a Vercel Function may run 300 s: stop with room to spare
const INPUT_CHARS = 12_000;      // all the "uses" of one step together
const PREVIOUS_CHARS = 9_000;    // the earlier version of the work, when it is being revised
const MAX_REVISIONS = 1;

/** The JSON body of POST /team, cleaned. Throws a message the page can show. */
export function parseTeamBody(text) {
  let b = null;
  try { b = JSON.parse(text); } catch {}
  if (!b || typeof b.goal !== "string" || b.goal.trim().length < 5) throw new Error("tuliskan tujuan proyek (minimal beberapa kata)");
  const goal = b.goal.trim().slice(0, LIMITS.goal);
  const playbook = PLAYBOOKS[b.playbook] ? b.playbook : suggestPlaybook(goal);
  const done = {};
  for (const step of PLAYBOOKS[playbook].steps) {
    const r = b.done?.[step.id];
    if (!r || typeof r !== "object") continue;
    const a = r.artifact;
    done[step.id] = {
      note: String(r.note ?? "").slice(0, LIMITS.note),
      artifact: a && typeof a.content === "string" ? { kind: a.kind === "mockup" ? "mockup" : "document", title: String(a.title ?? step.title).slice(0, 120), content: a.content.slice(0, LIMITS.artifact) } : null,
    };
  }
  const only = typeof b.only === "string" && stepById(PLAYBOOKS[playbook], b.only) ? b.only : undefined;
  return { goal, playbook, provider: PROVIDERS.includes(b.provider) ? b.provider : "quran", done, only, feedback: typeof b.feedback === "string" ? b.feedback.trim().slice(0, LIMITS.feedback) : "" };
}

const isIndonesian = (text) => /\b(yang|dan|untuk|dengan|buat(kan)?|aplikasi|saya|kami|kita|di|ke|dari|agar|supaya|bisa|akan|ini|itu|tidak|ada|pada|sebagai)\b/i.test(text);
const cut = (text, n) => (text.length > n ? text.slice(0, n).replace(/\s+\S*$/, "") + "\n…[dipersingkat]" : text);

/** Everything one professional is told for one step. skill: the text of the writing-md / mockup-html skill. */
export function buildStepPrompt({ step, goal, results, persona, skill, revision, reviewing, playbook }) {
  const me = byId(step.agent);
  const team = ROSTER.map((p) => `${p.name} (${p.role})`).join(", ");
  const earlier = playbook.steps.filter((s) => results.has(s.id) && s.id !== step.id);
  const notes = earlier.map((s) => `- ${byId(s.agent).name} (${s.title}): ${results.get(s.id).note || "(tanpa catatan)"}`).join("\n");
  const per = Math.max(1500, Math.floor(INPUT_CHARS / Math.max(1, step.uses.length)));
  const inputs = step.uses.filter((id) => results.has(id)).map((id) => {
    const r = results.get(id), s = stepById(playbook, id), a = r.artifact;
    const body = !a ? "(tidak ada berkas)" : a.kind === "mockup" ? `HTML page "${a.title}" (${a.content.length} characters). What is in it:\n${outlineOf(a.content)}${/qa|launch/.test(step.id) ? `\nIts JavaScript:\n${cut(lastScript(a.content), per)}` : ""}` : cut(a.content, per);
    return `=== ${s.title}, by ${byId(s.agent).name} ===\n${body}`;
  }).join("\n\n");
  const lines = [
    persona,
    "---",
    `You are ${me.name}, ${me.role}, working in a virtual product team (${team}) on a shared project. Your teammates already did their part; do yours so the next person can build on it.`,
    `PROJECT GOAL\n${goal}`,
    `YOUR TASK: ${step.title}\n${step.task}`,
  ];
  if (inputs) lines.push(`WHAT YOU NEED FROM EARLIER STEPS\n${inputs}`);
  if (notes) lines.push(`HANDOFF NOTES SO FAR\n${notes}`);
  if (revision) lines.push(`REVIEW FEEDBACK from ${revision.by === "user" ? "the client" : byId(revision.by).name} on your previous version: fix every point.\n${revision.changes}\n\nYOUR PREVIOUS VERSION\n${cut(revision.previous, PREVIOUS_CHARS)}\n\nWrite the complete improved version (not a list of edits).`);
  if (reviewing) lines.push(`This is the second review: ${byId(reviewing.author).name} revised the work after your feedback. Check whether your points were fixed.`);
  const tag = step.script ? '<document title="script.js">...only the JavaScript code, no HTML, no <script> tags, no code fence...</document>' : step.kind === "mockup" ? '<mockup title="...">...a complete HTML page...</mockup>' : '<document title="...">...Markdown...</document>';
  lines.push([
    "HOW TO ANSWER",
    `1. Write the deliverable as ONE ${tag}. It is the main thing: start with it, no preamble, no questions back. Make it thorough and specific: real names, numbers and examples, ${step.script ? "complete working code" : step.kind === "mockup" ? "a complete screen" : "about 600 to 900 words"}.`,
    "2. Right after it write <handoff>...</handoff>: one short paragraph (at most 80 words) for the next person. Give the concrete decisions you made (choices, names, numbers) and what they must do or avoid. No generic reminders such as \"make sure to verify\".",
    step.gate ? "3. Then give your decision: <verdict>approved</verdict> or <verdict>changes</verdict> followed by <changes>- one required change per line</changes>. Be a demanding reviewer: approve only if you would let the team start building from this today, and name the exact gap in every change you ask for." : "",
    "Do not use tools. " + (isIndonesian(goal) ? "Tulis semuanya dalam Bahasa Indonesia." : "Write everything in English."),
  ].filter(Boolean).join("\n"));
  if (skill) lines.push(`FORMAT RULES FOR THE DELIVERABLE\n${skill}`);
  return lines.join("\n\n");
}

const TAG = (name) => new RegExp(`<${name}>([\\s\\S]*?)(?:</${name}>|$)`, "i");
const stripTags = (t) => t.replace(/<handoff>[\s\S]*?(?:<\/handoff>|$)/gi, "").replace(/<verdict>[\s\S]*?<\/verdict>/gi, "").replace(/<changes>[\s\S]*?(?:<\/changes>|$)/gi, "").trim();

/** What a step's reply holds: the deliverable, the handoff note, and for a review the verdict. Tolerant: a model forgets tags. */
export function parseStepReply(text, step) {
  const handoff = TAG("handoff").exec(text)?.[1]?.trim() ?? "";
  const verdictRaw = /<verdict>\s*(approved|changes)\s*<\/verdict>/i.exec(text)?.[1]?.toLowerCase();
  const changes = TAG("changes").exec(text)?.[1]?.trim() ?? "";
  const withMock = extractMockups(text);
  const withDoc = extractDocuments(withMock.text);
  let artifact = null;
  if (step.kind === "mockup" && withMock.mockups[0]) artifact = { kind: "mockup", title: withMock.mockups[0].title || step.title, content: withMock.mockups[0].html };
  else if (withDoc.documents[0]) artifact = { kind: "document", title: withDoc.documents[0].title || step.title, content: stripTags(withDoc.documents[0].markdown) };
  else if (withMock.mockups[0]) artifact = { kind: "mockup", title: withMock.mockups[0].title || step.title, content: withMock.mockups[0].html };
  else { const rest = stripTags(withDoc.text); if (rest.length >= 150) artifact = { kind: "document", title: step.title, content: rest }; } // the model answered in plain text: keep it as the deliverable
  const plain = (artifact?.kind === "document" ? artifact.content : "").replace(/[#*_`>|-]+/g, " ").replace(/\s+/g, " ").trim();
  const note = (handoff || plain.slice(0, 400)).slice(0, LIMITS.note);
  return { artifact, note, verdict: verdictRaw ?? null, changes };
}

/**
 * Run (or resume) a team project. body: parseTeamBody(...). Needs chatFn(prompt, {signal}) -> {text}, personas (Map id -> text) and skills (Map name -> {body}).
 * Never throws: failures are events. Resolves to a summary for the log.
 */
export async function runTeam(body, { send, signal, chatFn, personas, skills = new Map(), now = Date.now, budget = BUDGET } = {}) {
  const playbook = PLAYBOOKS[body.playbook];
  const results = new Map(Object.entries(body.done ?? {}));
  const summary = { playbook: playbook.id, steps: 0, calls: 0, revisions: 0, artifacts: 0, paused: null, failed: null };
  const t0 = now();
  const stepTimes = [];
  const skillText = (kind) => skills.get(kind === "mockup" ? "mockup-html" : "writing-md")?.body ?? "";

  send({ type: "plan", playbook: playbook.id, title: playbook.title, primary: playbook.primary ?? null, steps: playbook.steps.map((s) => ({ id: s.id, agent: s.agent, name: byId(s.agent).name, role: byId(s.agent).role, title: s.title, kind: s.kind, gate: !!s.gate, status: results.has(s.id) && s.id !== body.only ? "done" : "pending" })) });

  /** One professional, one step. Returns the parsed reply or null (and has reported why). */
  const perform = async (step, extra = {}) => {
    const me = byId(step.agent), persona = personas?.get(step.agent);
    const info = { id: step.id, agent: step.agent, name: me.name, revision: extra.revision ? 1 : undefined };
    if (!persona) { send({ type: "step", phase: "end", ...info, status: "failed", error: `${me.name} tidak tersedia` }); return null; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) return null;
      send({ type: "step", phase: "start", ...info, attempt });
      try {
        const prompt = buildStepPrompt({ step, goal: body.goal, results, persona, skill: skillText(step.kind), playbook, ...extra });
        summary.calls++;
        let reply = await chatFn(prompt, { signal });
        reply = await finishReply(reply, `${step.title}: ${step.task}`.slice(-1500), chatFn, { signal }, { onToolStart: () => send({ type: "step", phase: "part", ...info }), onTool: () => { summary.calls++; } });
        const parsed = parseStepReply(String(reply.text ?? ""), step);
        if (step.script && parsed.artifact) {
          const built = await assembleScript(step, parsed, info, persona, extra);
          if (built) return built;
          if (attempt === 2) throw new Error("kode JavaScript tidak bisa dirakit ke halaman");
          continue;
        }
        if (parsed.artifact && step.minChars && parsed.artifact.content.length < step.minChars && !extra.deepened) {
          const fuller = await deepen(step, parsed, info, persona);
          if (fuller) return fuller;
        }
        if (parsed.artifact) return parsed;
        if (attempt === 2) throw new Error("jawaban kosong atau formatnya tidak terbaca");
      } catch (e) {
        if (signal?.aborted) return null;
        if (attempt === 2) { send({ type: "step", phase: "end", ...info, status: "failed", error: String(e.message ?? e).slice(0, 200) }); return null; }
      }
    }
    return null;
  };

  /** An engineer's script step: the model writes only the JavaScript; it must compile (asked to fix it twice if not), and then goes into the designer's page. */
  const assembleScript = async (step, parsed, info, persona, extra) => {
    const page = results.get(step.script.into)?.artifact;
    if (!page || page.kind !== "mockup") return null;
    let js = bareCode(parsed.artifact.content), problem = scriptProblem(js), note = parsed.note;
    for (let fix = 0; problem && fix < 2 && !signal?.aborted; fix++) {
      try {
        send({ type: "step", phase: "part", ...info });
        const prompt = buildStepPrompt({ step, goal: body.goal, results, persona, skill: skillText(step.kind), playbook, ...extra }) +
          `\n\nYOUR JAVASCRIPT HAS A SYNTAX ERROR ("${problem}"), so the browser runs none of it. Return the complete corrected code in the same format (one <document title="script.js"> with only the code). Check every bracket, quote and parenthesis, and write simpler code where you are unsure.\n\nYOUR CODE\n${cut(js, 16_000)}`;
        summary.calls++;
        const reply = await chatFn(prompt, { signal });
        const again = parseStepReply(String(reply.text ?? ""), step);
        if (again.artifact) { js = bareCode(again.artifact.content); problem = scriptProblem(js); note = again.note || note; }
      } catch { break; }
    }
    if (problem) note = `Peringatan: skripnya masih punya kesalahan sintaks (${problem}), jadi fitur interaktifnya belum jalan. ${note}`.slice(0, LIMITS.note);
    return { ...parsed, note, script: js, artifact: { kind: "mockup", title: page.title, content: assemble(page.content, js) } };
  };

  /** A draft that is shorter than the step asks for (small free models write briefly): ask once for the complete, richer version; keep the draft if that fails. */
  const deepen = async (step, parsed, info, persona) => {
    if (signal?.aborted) return null;
    try {
      send({ type: "step", phase: "part", ...info });
      const prompt = buildStepPrompt({ step, goal: body.goal, results, persona, skill: skillText(step.kind), playbook }) +
        `\n\nYOUR DRAFT BELOW IS TOO SHORT AND TOO SIMPLE (${parsed.artifact.content.length} characters; the real deliverable needs at least ${step.minChars}). Write the complete, richer version now: every section fully built with the real content, polished styling, nothing left as a sketch or a placeholder. Same format and tags as before.\n\nYOUR DRAFT\n${cut(parsed.artifact.content, PREVIOUS_CHARS)}`;
      summary.calls++;
      let reply = await chatFn(prompt, { signal });
      reply = await finishReply(reply, `${step.title}: ${step.task}`.slice(-1500), chatFn, { signal }, { onTool: () => { summary.calls++; } });
      const again = parseStepReply(String(reply.text ?? ""), step);
      return again.artifact && again.artifact.kind === parsed.artifact.kind && again.artifact.content.length > parsed.artifact.content.length ? { ...again, note: again.note || parsed.note, verdict: again.verdict ?? parsed.verdict, changes: again.changes || parsed.changes } : null;
    } catch {
      return null;
    }
  };

  const store = (step, parsed, revision) => {
    results.set(step.id, { note: parsed.note, artifact: parsed.artifact });
    summary.artifacts++;
    send({ type: "artifact", id: step.id, ...parsed.artifact, note: parsed.note, revision: revision ? 1 : 0 });
    send({ type: "step", phase: "end", id: step.id, agent: step.agent, name: byId(step.agent).name, status: "done", revision: revision ? 1 : undefined });
  };

  const previousOf = (step) => (step.script ? lastScript(results.get(step.id)?.artifact?.content ?? "") : results.get(step.id)?.artifact?.content ?? "");

  /** A review: the reviewer decides; "changes" sends the author back (once) and the reviewer looks again. */
  const review = async (step, parsed) => {
    const gate = stepById(playbook, step.gate.of);
    let verdict = parsed.verdict ?? "approved", changes = parsed.changes;
    for (let round = 0; verdict === "changes" && round < MAX_REVISIONS; round++) {
      send({ type: "review", id: step.id, by: step.agent, verdict, changes, final: false });
      send({ type: "handoff", from: step.agent, to: gate.agent, note: `Perlu perbaikan: ${changes.replace(/\s+/g, " ").slice(0, 300)}` });
      summary.revisions++;
      const prev = previousOf(gate);
      const fixed = await perform(gate, { revision: { by: step.agent, changes, previous: prev } });
      if (!fixed) return false;
      store(gate, fixed, true);
      send({ type: "handoff", from: gate.agent, to: step.agent, note: fixed.note });
      const again = await perform(step, { reviewing: { author: gate.agent } });
      if (!again) return false;
      store(step, again, false);
      verdict = again.verdict ?? "approved"; changes = again.changes;
    }
    send({ type: "review", id: step.id, by: step.agent, verdict, changes, final: true });
    return true;
  };

  const todo = body.only ? [body.only] : playbook.steps.filter((s) => !results.has(s.id)).map((s) => s.id);
  for (const id of todo) {
    if (signal?.aborted) break;
    const avg = stepTimes.length ? stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length : budget.firstStepMs;
    if (summary.calls >= budget.maxCalls) { summary.paused = "calls"; send({ type: "paused", reason: "calls", next: id }); break; }
    if (now() - t0 + avg * 1.2 > budget.maxMs) { summary.paused = "time"; send({ type: "paused", reason: "time", next: id }); break; }
    const step = stepById(playbook, id), started = now();
    const redo = id === body.only && body.feedback ? { revision: { by: "user", changes: body.feedback, previous: previousOf(step) } } : {}; // the client asked for a change
    const parsed = await perform(step, redo);
    if (!parsed) { summary.failed = id; if (!signal?.aborted) send({ type: "paused", reason: "failed", next: id }); break; }
    store(step, parsed, false);
    summary.steps++;
    if (step.gate && !(await review(step, parsed))) { summary.failed = id; if (!signal?.aborted) send({ type: "paused", reason: "failed", next: id }); break; }
    stepTimes.push(now() - started);
    const next = playbook.steps[playbook.steps.findIndex((s) => s.id === id) + 1];
    if (next && next.agent !== step.agent && !body.only) send({ type: "handoff", from: step.agent, to: next.agent, note: results.get(id).note });
  }
  if (!summary.paused && !summary.failed && !signal?.aborted) send({ type: "done", summary: { ...summary, total: playbook.steps.length, finished: playbook.steps.filter((s) => results.has(s.id)).length } });
  return summary;
}
