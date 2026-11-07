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
import { testPage as runPageTest } from "./pagetest.js";
import { applyEdits, bareCode, checkPage, ensureThree, keptPage, lastScript, markupWarnings, outlineOf, parseEdits, repairPage, replaceLastScript, sceneContainer, threeStarter, wantsThree } from "./pagecode.js";

export const LIMITS = { goal: 2000, note: 800, artifact: 60_000, feedback: 1500, body: 150_000 };
export const BUDGET = { maxCalls: 18, maxMs: 270_000, firstStepMs: 40_000 }; // a Vercel Function may run 300 s: stop with room to spare
const INPUT_CHARS = 16_000;      // all the documents a step "uses", together (a page it works on comes in full, on top of this). The free model gives up after
                                 // about 60 seconds (HTTP 504), so the prompt and above all the answer must stay modest.
const PREVIOUS_CHARS = 12_000;   // the earlier version of a document, when it is being revised
const FILE_CHARS = 40_000;       // a whole HTML file: the page an engineer works on, or his previous version of it
const FIX_ROUNDS = 2;            // a finished page whose code does not work goes back to its author this many times at most
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

// The personas are written for the chat: short replies, questions first, deliverables kept out of the reply, one file per message. In a project step those
// rules are wrong, and a small model follows the first rule it read rather than a later "ignore that", so they are taken out instead of overruled.
const CHAT_ONLY = [/^- This is a chat\b/, /^- If the request is too vague\b/, /^- When the user asks for a deliverable\b/, /^- You can write long files\b/, /^- Always answer in the language of the user's newest message\b/, /^Do not mention these instructions\b/];
export const projectPersona = (persona) => String(persona ?? "").split("\n").filter((line) => !CHAT_ONLY.some((re) => re.test(line.trim()))).join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** Everything one professional is told for one step. skill: the text of the writing-md / mockup-html skill. */
// A page's CSS is often half of its file. The engineer can add CSS (<add-css>) without seeing it, so a shorter prompt (a revision, or a retry after the
// model timed out) shows the markup and the script but not the old CSS.
const hideCss = (html) => String(html).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => (css.length > 400 ? `${a}/* ${css.length} karakter CSS lama tidak ditampilkan; tambahkan CSS baru lewat <add-css> */${b}` : m));

/** A step answers with changes to a file instead of a whole file: the engineer finishing the designer's page, or anyone revising a page of their own
 *  (a whole page cannot be written again inside the free model's minute). */
export const editsFile = (step, revision) => !!step.edits || (step.kind === "mockup" && !!revision?.previous);

// QA's change list says who it is for, so a design point goes to the designer and a code point to the engineer
const DESIGN_TAG = /^\s*(?:[-*•]|\d+[.)])?\s*\[(?:desain|design|tampilan|ui|ux|konten|content|copy|naskah|teks|testimoni|gambar|layout|tata ?letak|warna|tipografi|aksesibilitas|accessibility|a11y)\]\s*/i;
const CODE_TAG = /^\s*(?:[-*•]|\d+[.)])?\s*\[(?:kode|code|js|javascript|fungsi)\]\s*/i;
export function splitChanges(changes) {
  const design = [], code = [];
  for (const line of String(changes ?? "").split("\n")) {
    if (!line.trim()) continue;
    if (DESIGN_TAG.test(line)) design.push("- " + line.replace(DESIGN_TAG, "").trim());
    else code.push("- " + line.replace(CODE_TAG, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim());
  }
  return { design: design.join("\n"), code: code.join("\n") };
}

export function buildStepPrompt({ step, goal, results, persona, skill, revision, reviewing, playbook, compact = false, qaNotes = "" }) {
  const me = byId(step.agent);
  const team = ROSTER.map((p) => `${p.name} (${p.role})`).join(", ");
  const earlier = playbook.steps.filter((s) => results.has(s.id) && s.id !== step.id);
  const notes = earlier.map((s) => `- ${byId(s.agent).name} (${s.title}): ${results.get(s.id).note || "(tanpa catatan)"}`).join("\n");
  const per = Math.max(1500, Math.floor((compact ? INPUT_CHARS / 2 : INPUT_CHARS) / Math.max(1, step.uses.length)));
  if (compact) skill = ""; // the retry after a timeout: the format is still stated below, the long skill text is left out
  const inputs = step.uses.filter((id) => results.has(id)).map((id) => {
    const r = results.get(id), s = stepById(playbook, id), a = r.artifact;
    if (a?.kind === "mockup" && step.edits === id) { // the file this step works on, all of it: the designer's page, or in a revision his own previous version of it
      const file = (revision?.previous || compact) ? hideCss(revision?.previous || a.content) : a.content;
      return `=== ${revision?.previous ? "YOUR PREVIOUS VERSION OF THE FILE" : `${s.title}, by ${byId(s.agent).name}`}: THE FILE YOU WORK ON (complete, ${file.length} characters) ===\nWhat is in it:\n${outlineOf(file)}\n\nThe file:\n${cut(file, FILE_CHARS)}`;
    }
    const tested = r.test && (step.gate || step.id === "launch") ? `\nTEST RUN (the page was loaded and used like a visitor would: buttons, links, menu, form empty and filled in):\n${[...r.test.passed.map((x) => "- passed: " + x), ...r.test.problems.map((x) => "- PROBLEM: " + x)].join("\n") || "- nothing to test"}` : "";
    const body = !a ? "(tidak ada berkas)" : a.kind === "mockup" ? `HTML page "${a.title}" (${a.content.length} characters). What is in it:\n${outlineOf(a.content)}${tested}${step.gate || step.id === "launch" ? `\nIts JavaScript:\n${cut(lastScript(a.content), per)}` : ""}` : cut(a.content, per);
    return `=== ${s.title}, by ${byId(s.agent).name} ===\n${body}`;
  }).join("\n\n");
  const lines = [
    projectPersona(persona),
    "---",
    "PROJECT MODE: you are not chatting now. The deliverable IS your reply: complete and thorough, in the format below, with no questions back.",
    `You are ${me.name}, ${me.role}, working in a virtual product team (${team}) on a shared project. Your teammates already did their part; do yours so the next person can build on it.`,
    `PROJECT GOAL\n${goal}`,
    `YOUR TASK: ${step.title}\n${step.task}`,
  ];
  if (inputs) lines.push(`WHAT YOU NEED FROM EARLIER STEPS\n${inputs}`);
  const editing = editsFile(step, revision);
  if (editing && !step.edits) lines.push(`THE FILE YOU WORK ON: YOUR PREVIOUS VERSION (complete, ${revision.previous.length} characters)\nWhat is in it:\n${outlineOf(revision.previous)}\n\nThe file:\n${cut(revision.previous, FILE_CHARS)}`);
  if (qaNotes) lines.push(`QA ALSO ASKED FOR THESE FIXES IN THE CODE (the designer has just revised the page above; do your work on this new version and include these):\n${qaNotes}`);
  if (notes) lines.push(`HANDOFF NOTES SO FAR\n${notes}`);
  if (step.edits && wantsThree(goal) && !revision) {
    const page = results.get(step.edits)?.artifact?.content ?? "";
    lines.push(`STARTER CODE FOR THE 3D PART (it works as it is: three.js r128 from ${"https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"}, which you load with a <script src> line). Adapt it to this page: the object, colours and motion that fit the goal${sceneContainer(page) ? `; it already renders into #${sceneContainer(page)}, the container the designer left` : "; give it a container in the hero with <change> or <add-html>"}. Keep it working.\n${threeStarter(sceneContainer(page))}`);
  }
  if (revision && editing) lines.push(`REVIEW FEEDBACK from ${revision.by === "user" ? "the client" : byId(revision.by).name} on your previous version (the file above): fix every point with your changes to that file.${step.edits ? " Your JavaScript replaces the file's current script, so send all of it." : ""}\n${revision.changes}`);
  else if (revision) lines.push(`REVIEW FEEDBACK from ${revision.by === "user" ? "the client" : byId(revision.by).name} on your previous version: fix every point.\n${revision.changes}\n\nYOUR PREVIOUS VERSION\n${cut(revision.previous, step.kind === "mockup" ? FILE_CHARS : PREVIOUS_CHARS)}\n\nWrite the complete improved version (not a list of edits).`);
  if (reviewing) lines.push(`This is the second review: ${byId(reviewing.author).name} revised the work after your feedback. Check whether your points were fixed.`);
  if (editing) {
    lines.push([
      "HOW TO ANSWER",
      "Do NOT send the whole file back (it is too long for one answer). Send only your changes; they are applied to the file for you, in this order:",
      "1. <change><find>an exact piece of the file, copied character for character</find><replace>what it becomes</replace></change> for each change to existing markup or CSS (as many as you need; keep each find short but unique: a tag with its attributes, a CSS rule).",
      "2. <add-css>...</add-css> with the CSS you add, and <add-html>...</add-html> with markup added at the end of the body (a toast, a back to top button, a dialog), if any.",
      "3. For a library the goal names: <script src=\"https://cdnjs.cloudflare.com/ajax/libs/...\"></script> on its own line.",
      step.edits ? "4. <document title=\"script.js\">...the complete JavaScript, only code, no <script> tags, no code fence...</document>: the main part." : "4. No JavaScript: the behaviour is the engineer's work.",
      "5. <handoff>...</handoff>: one short paragraph (at most 80 words) for the next person: what works, the ids you used or added, what is left.",
      "Keep the whole answer under about 9,000 characters. Use only ids that are in the file or that you add yourself. Do not use tools. " + (isIndonesian(goal) ? "Tulis semua teks halaman dan catatan dalam Bahasa Indonesia." : "Write all page text in English."),
    ].join("\n"));
    return lines.join("\n\n");
  }
  const tag = step.kind === "mockup" ? '<mockup title="...">...a complete HTML page...</mockup>' : '<document title="...">...Markdown...</document>';
  lines.push([
    "HOW TO ANSWER",
    `1. Write the deliverable as ONE ${tag}. It is the main thing: start with it, no preamble, no questions back. Make it thorough and specific: real names, numbers and examples, ${step.kind === "mockup" ? "a complete screen" : "about 600 to 900 words"}.${step.maxChars ? ` The whole file must stay under about ${step.maxChars.toLocaleString("en")} characters: you have about one minute to write it.` : ""}`,
    "2. Right after it write <handoff>...</handoff>: one short paragraph (at most 80 words) for the next person. Give the concrete decisions you made (choices, names, numbers) and what they must do or avoid. No generic reminders such as \"make sure to verify\".",
    step.gate ? "3. Then give your decision: <verdict>approved</verdict> or <verdict>changes</verdict> followed by <changes>- one required change per line</changes>. Be a demanding reviewer: approve only if you would let the team start building from this today, and name the exact gap in every change you ask for." : "",
    step.gate && stepById(playbook, step.gate.of)?.edits ? `   Start every change line with who must fix it: [desain] for the look, layout, sections, copy or markup (${byId(stepById(playbook, stepById(playbook, step.gate.of).edits).agent).name}, the designer), or [kode] for behaviour, the script, the form logic or an error in the test run (${byId(stepById(playbook, step.gate.of).agent).name}, the engineer).` : "",
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
export async function runTeam(body, { send, signal, chatFn, personas, skills = new Map(), now = Date.now, budget = BUDGET, testPage = runPageTest } = {}) {
  const playbook = PLAYBOOKS[body.playbook];
  const results = new Map(Object.entries(body.done ?? {}));
  const summary = { playbook: playbook.id, steps: 0, calls: 0, revisions: 0, artifacts: 0, paused: null, failed: null };
  const t0 = now();
  const stepTimes = [];
  // the skills are written for the chat, where an answer may run as long as it needs (it is continued when cut off). A project step has to finish inside
  // one model call, so the "no size limit, aim for 8,000+ characters" rule is taken out, and the step's own size is stated instead.
  const skillText = (kind) => String(skills.get(kind === "mockup" ? "mockup-html" : "writing-md")?.body ?? "").split("\n").filter((l) => !/^- \*\*No size limit/.test(l.trim())).join("\n");

  send({ type: "plan", playbook: playbook.id, title: playbook.title, primary: playbook.primary ?? null, steps: playbook.steps.map((s) => ({ id: s.id, agent: s.agent, name: byId(s.agent).name, role: byId(s.agent).role, title: s.title, kind: s.kind, gate: !!s.gate, status: results.has(s.id) && s.id !== body.only ? "done" : "pending" })) });

  /** One professional, one step. Returns the parsed reply or null (and has reported why). */
  const perform = async (step, extra = {}) => {
    const me = byId(step.agent), persona = personas?.get(step.agent);
    const info = { id: step.id, agent: step.agent, name: me.name, revision: extra.revision ? 1 : undefined };
    if (!persona) { send({ type: "step", phase: "end", ...info, status: "failed", error: `${me.name} tidak tersedia` }); return null; }
    let compact = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) return null;
      send({ type: "step", phase: "start", ...info, attempt });
      try {
        if (step.parts === 2 && !editsFile(step, extra.revision)) { const page = await inParts(step, info, persona, { ...extra, compact }); if (page) return page; throw new Error("halaman tidak terbaca"); }
        const prompt = buildStepPrompt({ step, goal: body.goal, results, persona, skill: skillText(step.kind), playbook, ...extra, compact });
        summary.calls++;
        let reply = await chatFn(prompt, { signal });
        reply = await finishReply(reply, `${step.title}: ${step.task}`.slice(-1500), chatFn, { signal }, { onToolStart: () => send({ type: "step", phase: "part", ...info }), onTool: () => { summary.calls++; } });
        const parsed = parseStepReply(String(reply.text ?? ""), step);
        if (editsFile(step, extra.revision)) {
          const built = await finishFile(step, String(reply.text ?? ""), parsed, info, persona, extra);
          if (built) return built;
          if (attempt === 2) throw new Error("perubahan untuk halaman tidak terbaca");
          continue;
        }
        if (parsed.artifact && step.minChars && parsed.artifact.content.length < step.minChars && !extra.deepened) {
          const fuller = await deepen(step, parsed, info, persona);
          if (fuller) return fuller;
        }
        if (parsed.artifact?.kind === "mockup") { const r = repairPage(parsed.artifact.content); parsed.artifact.content = r.html; }
        if (parsed.artifact) return parsed;
        if (attempt === 2) throw new Error("jawaban kosong atau formatnya tidak terbaca");
      } catch (e) {
        if (signal?.aborted) return null;
        if (/HTTP 50[234]|time ?out|timed out|aborted/i.test(String(e?.message ?? e))) compact = true; // the model gave up on a long prompt: the second try is shorter
        if (attempt === 2) { send({ type: "step", phase: "end", ...info, status: "failed", error: String(e.message ?? e).slice(0, 200) }); return null; }
      }
    }
    return null;
  };

  /** A step that finishes another step's page (the engineer on the designer's page). He reads her whole file and answers with his changes (parseEdits),
   *  which are applied to it; a whole file he sends anyway is taken if it still holds her page. Then the code checks the result, because nobody in the team
   *  can run it: its scripts must compile and find the elements they look up. What is wrong goes back to him (at most FIX_ROUNDS times, only the script, so it
   *  is quick); what stays wrong is said in his note, where QA reads it. Returns null when the reply holds nothing usable. */
  const finishFile = async (step, text, parsed, info, persona, extra) => {
    const mine = extra.revision?.previous ? results.get(step.id)?.artifact : null; // a revision changes his own previous file
    const base = mine?.kind === "mockup" ? mine : results.get(step.edits)?.artifact;
    if (!base || base.kind !== "mockup") return null;
    const sent = parsed.artifact?.kind === "mockup" ? parsed.artifact.content : null;
    let html, note = /<handoff>/i.test(text) ? parsed.note : ""; // without a handoff tag the "note" would be the start of his code
    if (sent && keptPage(base.content, sent)) html = sent;
    else {
      const edits = parseEdits(text);
      if (!edits.js && sent) edits.js = lastScript(sent);
      if (!edits.js && !edits.changes.length && !edits.css && !edits.html) return null;
      const applied = applyEdits(base.content, edits, { replaceScript: base === mine });
      html = applied.html;
      if (applied.missed.length) note = `${applied.missed.length} perubahan tidak dipasang karena teksnya tidak ada di halaman. ${note}`;
      if (sent) note = `Berkas lengkapnya tidak utuh, jadi kodenya dipasang ke halaman desainer. ${note}`;
    }
    if (!step.edits) { // a designer revising her own page: her changes and the safe repairs; the code is not hers to test
      const r = repairPage(html);
      return { ...parsed, note: (note || "Halaman sudah diperbaiki.").slice(0, LIMITS.note), artifact: { kind: "mockup", title: base.title, content: r.html } };
    }
    if (!note) note = "Kode halaman sudah dipasang.";
    // what has one safe answer, the code fixes itself first (icon sizes, dead pictures, the same id twice, libraries, the 3D scene the goal asked for),
    // so the test run sees the page as it will ship
    const done = [];
    const repair = (h) => { const r = repairPage(h), t = ensureThree(r.html, body.goal); done.push(...r.fixed, ...t.fixed); return t.html; };
    html = repair(html);
    // then the page is read (checkPage) and used like a visitor would (testPage): what is wrong goes back to the engineer
    const inspect = async (h) => { const test = await testPage(h).catch(() => ({ ran: false, problems: [], passed: [] })); return { problems: [...checkPage(h), ...test.problems], test }; };
    let { problems, test } = await inspect(html);
    for (let round = 0; problems.length && round < FIX_ROUNDS && !signal?.aborted; round++) {
      try {
        send({ type: "step", phase: "part", ...info });
        const prompt = [projectPersona(persona), "---", "PROJECT MODE: you are not chatting now; answer with the code only.", `You are ${byId(step.agent).name}, ${byId(step.agent).role}. PROJECT GOAL\n${body.goal}`, `YOUR TASK: ${step.title}\nFix the script of the page you finished.`,
          `THE PAGE YOU FINISHED, what is in it:\n${outlineOf(html)}`,
          `ITS SCRIPT DOES NOT WORK YET. An automatic check and a test run (the page loaded and clicked through like a visitor would) found:\n${problems.map((p) => "- " + p).join("\n")}`,
          `Answer with the corrected, complete JavaScript as <document title="script.js">...code...</document> (no <script> tags, no code fence), then <handoff>one sentence</handoff>. When a problem is in the markup (a link to a section that does not exist, a missing id), also send <change><find>exact text of the file</find><replace>what it becomes</replace></change> for it, before the script. Use only ids listed above or that you add. Check every bracket, quote and parenthesis; write simpler code where you are unsure.`,
          `THE CURRENT SCRIPT\n${cut(lastScript(html), 14_000)}`].join("\n\n");
        summary.calls++;
        let reply = await chatFn(prompt, { signal });
        reply = await finishReply(reply, "the corrected JavaScript", chatFn, { signal }, { onTool: () => { summary.calls++; } });
        const fix = parseEdits(String(reply.text ?? ""));
        if (!fix.js && !fix.changes.length) continue;
        const next = repair(applyEdits(html, { changes: fix.changes, js: fix.js }, { replaceScript: true }).html); // markup fixes too (a link to a missing section)
        const after = await inspect(next);
        if (after.problems.length <= problems.length) ({ problems, test } = after, html = next); // never take a "fix" that breaks more
      } catch { break; }
    }
    const left = [...problems, ...markupWarnings(html)];
    const fixedList = [...new Set(done)];
    if (fixedList.length) note = `Diperbaiki otomatis: ${fixedList.join("; ")}. ${note}`;
    if (left.length) note = `Peringatan dari pemeriksaan otomatis: ${left.join("; ")}. ${note}`;
    const report = test?.ran ? { passed: test.passed, problems: test.problems, steps: test.steps } : null; // the test run, for QA and for the page
    return { ...parsed, note: note.slice(0, LIMITS.note), test: report, artifact: { kind: "mockup", title: sent && keptPage(base.content, sent) ? parsed.artifact.title : base.title, content: html } };
  };

  /** A new page, written in two halves (about 4,000 characters each), because the free model gives up after about a minute and a whole page often takes
   *  longer. The second half is written seeing the first, so it continues in the same style. A second half that fails leaves the first half, closed. */
  const inParts = async (step, info, persona, extra) => {
    const full = buildStepPrompt({ step, goal: body.goal, results, persona, skill: skillText(step.kind), playbook, ...extra });
    summary.calls++;
    let reply = await chatFn(full + "\n\nTHIS PAGE IS WRITTEN IN TWO PARTS, so each answer finishes in time. Now write ONLY PART 1: <mockup title=\"...the page's name...\"> and then the file from <!doctype html>: the complete <head> (Tailwind with its config, fonts, a short <style> if needed), then the body from the header and navigation through the hero and the next sections, about half of the page (about 4,000 characters). End PART 1 with the line <!-- BAGIAN 2 --> and stop there: no closing tags, no handoff.", { signal });
    const t1 = String(reply.text ?? "");
    const title = /<mockup[^>]*title=["']([^"']+)["']/i.exec(t1)?.[1] || step.title;
    let first = t1.replace(/<\/?mockup[^>]*>/gi, "");
    const at = first.search(/<!doctype|<html/i);
    if (at < 0) return null;
    first = first.slice(at).split(/<!--\s*BAGIAN\s*2\s*-->/i)[0].replace(/<\/body>\s*<\/html>\s*$/i, "").replace(/<handoff>[\s\S]*$/i, "").trimEnd();
    send({ type: "step", phase: "part", ...info });
    let second = "", note = "";
    try {
      summary.calls++;
      const short = buildStepPrompt({ step, goal: body.goal, results, persona, skill: "", playbook, ...extra, compact: true });
      reply = await chatFn(`${short}\n\nPART 1 OF THE PAGE IS DONE (below). Now write ONLY PART 2, continuing right after it: the sections of the brief that part 1 does not have yet, the contact form, the footer, then </body></html>. Use the same Tailwind classes, colours and components as part 1; do not repeat the head or a section that is already there. Answer with the HTML of part 2 only (no <mockup> tag), then <handoff>...</handoff> for the whole page.\n\nPART 1\n${first}`, { signal });
      const t2 = String(reply.text ?? "");
      note = /<handoff>([\s\S]*?)(?:<\/handoff>|$)/i.exec(t2)?.[1]?.trim() ?? "";
      second = t2.replace(/<handoff>[\s\S]*$/i, "").replace(/<\/?mockup[^>]*>/gi, "").replace(/^[\s\S]*?(?=<)/, "").trim();
      if (/<head[\s>]/i.test(second)) second = keptPage(first, second) ? "\u0000" + second : second.replace(/^[\s\S]*?<body[^>]*>/i, ""); // it wrote the whole page again
    } catch { note = "Bagian bawah halaman belum sempat ditulis (model terlalu lama)."; }
    let html = second.startsWith("\u0000") ? second.slice(1) : `${first}\n${second}`;
    if (!/<\/body>/i.test(html)) html += "\n</body>\n</html>";
    return { artifact: { kind: "mockup", title, content: repairPage(html).html }, note: (note || `${title}: halaman lengkap.`).slice(0, LIMITS.note), verdict: null, changes: "" };
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
    results.set(step.id, { note: parsed.note, artifact: parsed.artifact, test: parsed.test ?? null });
    summary.artifacts++;
    send({ type: "artifact", id: step.id, ...parsed.artifact, note: parsed.note, revision: revision ? 1 : 0, ...(parsed.test ? { test: parsed.test } : {}) });
    send({ type: "step", phase: "end", id: step.id, agent: step.agent, name: byId(step.agent).name, status: "done", revision: revision ? 1 : undefined });
  };

  const previousOf = (step) => results.get(step.id)?.artifact?.content ?? "";

  /** A review: the reviewer decides; "changes" sends the author back (once) and the reviewer looks again. */
  const review = async (step, parsed) => {
    const gate = stepById(playbook, step.gate.of);
    let verdict = parsed.verdict ?? "approved", changes = parsed.changes;
    for (let round = 0; verdict === "changes" && round < MAX_REVISIONS; round++) {
      send({ type: "review", id: step.id, by: step.agent, verdict, changes, final: false });
      summary.revisions++;
      const designer = gate.edits ? stepById(playbook, gate.edits) : null;
      const { design, code } = splitChanges(changes);
      let fixed;
      if (designer && design) {
        // a design point: the designer revises her page first; then the engineer does his work again on the new page, with QA's code points
        send({ type: "handoff", from: step.agent, to: designer.agent, note: `Perlu perbaikan desain: ${design.replace(/\s+/g, " ").slice(0, 300)}` });
        const page = await perform(designer, { revision: { by: step.agent, changes: design, previous: previousOf(designer) } });
        if (!page) return false;
        store(designer, page, true);
        send({ type: "handoff", from: designer.agent, to: gate.agent, note: page.note });
        fixed = await perform(gate, { qaNotes: code });
      } else {
        send({ type: "handoff", from: step.agent, to: gate.agent, note: `Perlu perbaikan: ${(code || changes).replace(/\s+/g, " ").slice(0, 300)}` });
        fixed = await perform(gate, { revision: { by: step.agent, changes: code || changes, previous: previousOf(gate) } });
      }
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
