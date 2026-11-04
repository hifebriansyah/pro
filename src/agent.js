// Tool loop over a text-only API: islam-gpt.org has no function calling, so the prompt teaches the model a
// one-line protocol (TOOL: {"name":...,"args":{...}}), we run the tool, and ask again with the result inside.
import { chatBuffered as islamChat } from "./islam.js";
import { TOOLS } from "./tools.js";
import { matchingSkills, skillTool } from "./skills.js";
import { MAX_CHARS, MAX_PARTS, cleanContinuation, continuationPrompt, openBlock } from "./continue.js";

const MAX_STEPS = 3;
const RESULT_CHARS = 4000;
const CONTINUE_TIMEOUT_MS = 100_000; // one continuation call: islam-gpt takes about 30 s for a long part, so this only catches a stalled one
const SKILL_CHARS = 8000; // instructions are not search results: do not cut them like one

/**
 * Today's date as YYYY-MM-DD. A number is a fixed offset from UTC in minutes (Jakarta is 420): plain arithmetic. A string is an IANA time
 * zone, and that goes through Intl, which costs 10 ms or more of CPU the first time: enough to get a request on a cold Cloudflare Worker
 * killed (the free plan allows about 10 ms), so the Worker is configured with an offset.
 */
export function today(timeZone) {
  if (typeof timeZone === "number") return new Date(Date.now() + (Number.isFinite(timeZone) ? timeZone : 0) * 60_000).toISOString().slice(0, 10); // NaN (a bad setting) is UTC, never an error
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

export function toolInstructions(tools = TOOLS, skills = new Map(), timeZone) {
  const list = Object.entries(tools).map(([n, t]) => `- ${n} ${t.usage}: ${t.does}`).join("\n");
  const skillList = skills.size ? `\n\nSkills (call load_skill with the name to read its instructions BEFORE doing that kind of task, then follow them):\n${[...skills.values()].map((k) => `- ${k.name}: ${k.description}`).join("\n")}\nA skill's rules for what it produces (a Markdown document, say) override your persona's plain-text and no-list rules for that output only; your chat sentences keep your persona's voice.` : "";
  return `Today is ${today(timeZone)} (use this for questions about today's date; no search needed). You can look things up on the internet. Tools:\n${list}${skillList}\n\nTo use a tool, reply with ONLY that one line: no greeting, no "wait a moment", no other text before or after it: TOOL: {"name": "<tool>", "args": {...}}\nYou will then get the result and can answer. Use a tool only for recent or unknown facts; otherwise answer directly. Cite the URLs you used.`;
}

/** The first `TOOL: {...}` line of a reply as {name, args}, or null when the reply is a normal answer. */
export function parseToolCall(text) {
  const m = /^\s*(?:TOOL:\s*)?(\{.*\})\s*$/m.exec(text); // the model sometimes drops the "TOOL:" prefix
  if (!m) return null;
  try {
    const { name, args } = JSON.parse(m[1]);
    return typeof name === "string" ? { name, args: args ?? {} } : null;
  } catch {
    return null;
  }
}

/** Drop any tool-call lines from a reply that is shown to the user. */
export const stripToolLines = (text) => text.replace(/^[ \t]*(?:TOOL:[ \t]*)?\{"name".*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/** Pull <document title="..."> ... </document> blocks (the writing-md skill) out of a reply: { text, documents: [{title, markdown}] }. */
export function extractDocuments(reply) {
  const documents = [];
  const text = reply.replace(/<document(?:\s+title="([^"]*)")?\s*>([\s\S]*?)(?:<\/document>|$)/g, (_, title, body) => {
    let markdown = body.trim();
    if ((markdown.match(/^[ \t]*(?:```|~~~)/gm) ?? []).length % 2) markdown += "\n```"; // a document that ends inside a code block (cut off, or the model forgot) gets its fence closed
    if (markdown) documents.push({ title: (title ?? /^#\s+(.+)$/m.exec(markdown)?.[1] ?? "Dokumen").trim().slice(0, 120), markdown });
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), documents };
}

const MOCKUP_CHARS = 120_000;
/** The model sometimes wraps the HTML in a ```html fence inside the tag: take the fence off. */
const unfence = (html) => html.trim().replace(/^```(?:html)?[ \t]*\n?/i, "").replace(/\n?```[ \t]*$/, "").trim();

/**
 * Pull <mockup title="..."> ... </mockup> blocks (the mockup-html skill) out of a reply: { text, mockups: [{title, html}] }.
 * A tag that is never closed (the answer was cut off) takes the rest of the reply; the browser repairs unclosed HTML.
 */
export function extractMockups(reply) {
  const mockups = [];
  const text = reply.replace(/<mockup(?:\s+title="([^"]*)")?\s*>([\s\S]*?)(?:<\/mockup>|$)/g, (_, title, body) => {
    const html = unfence(body).slice(0, MOCKUP_CHARS);
    if (html) mockups.push({ title: (title ?? /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "Mockup").trim().slice(0, 120), html });
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), mockups };
}

/**
 * A reply that was cut off inside a document, a mockup or a code fence is carried on: the model is asked to continue from the last character
 * (src/continue.js) until the block is closed, up to MAX_PARTS parts. If a continuation fails, what was written so far is kept.
 */
async function finishReply(first, request, chatFn, opts, { onToolStart, onTool }) {
  let text = first.text;
  for (let part = 2; part <= MAX_PARTS && text.length < MAX_CHARS; part++) {
    const kind = openBlock(text);
    if (!kind) break;
    onToolStart?.({ name: "continue", args: { part } });
    let piece = "", failure;
    for (let attempt = 1; attempt <= 2; attempt++) { // one retry: a dropped connection or a stalled stream is usually a one-off
      try {
        const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(CONTINUE_TIMEOUT_MS)]) : AbortSignal.timeout(CONTINUE_TIMEOUT_MS);
        piece = cleanContinuation(text, (await chatFn(continuationPrompt({ request, text, kind, part }), { ...opts, signal })).text, kind);
        failure = undefined;
        break;
      } catch (e) {
        failure = e;
        if (opts.signal?.aborted) break; // the visitor left: no retry
      }
    }
    if (failure) {
      onTool?.({ name: "continue", args: { part }, error: failure.message });
      break;
    }
    onTool?.({ name: "continue", args: { part }, result: `${piece.length} characters` });
    if (!piece) break;
    text += piece;
  }
  return { ...first, text };
}

/**
 * Ask with web tools. Calls onChunk once, with the final answer (replies are held back until we know they are not tool calls).
 * Options: persona (who the model must stay as; repeated after every tool result so it does not drift), tools,
 * skills (a Map: loadSkills() from skills-fs.js on Node, skillsFromList() on Workers; default none), env (settings handed to the tools, e.g. BRAVE_API_KEY),
 * timeZone (for "today": an IANA name, or a number of minutes from UTC; Workers run in UTC, so the Worker sets 420 for Jakarta), message (the user's latest text: skills whose trigger words it contains are preloaded), chatFn (for tests), onToolStart({name,args}) before a tool runs,
 * onTool({name,args,result|error}) after, onDocument({title,markdown}) for each document and onMockup({title,html}) for each mockup in the answer, plus the islam.js options.
 * Resolves to { text, references, images, documents, mockups, steps }.
 */
export async function agentChat(question, { onChunk, onTool, onToolStart, onDocument, onMockup, skills = new Map(), env, timeZone, message = "", persona = "", tools = TOOLS, chatFn = islamChat, maxSteps = MAX_STEPS, ...opts } = {}) {
  if (skills.size && !tools.load_skill) tools = { ...tools, load_skill: skillTool(skills) };
  const images = [];
  const documents = [];
  const mockups = [];
  const exchanges = []; // what the tools returned so far, replayed on every round
  const preloaded = matchingSkills(skills, message);
  const preload = preloaded.map((k) => `Skill "${k.name}" applies to this request, follow it:\n${k.body}\n\n`).join("");
  const base = `${toolInstructions(tools, skills, timeZone)}\n\n${persona ? `${persona}\n\n` : ""}${preload}User question: ${question}`;
  for (let step = 0; ; step++) {
    // After a tool result the persona is far above in the prompt and the model drifts into a generic assistant, so restate it last.
    const tail = exchanges.length
      ? `\n\n${persona ? `Stay in character, exactly as described above:\n${persona}\n\n${skills.size ? "(If you loaded a skill, its output format overrides the persona's formatting rules for that output: e.g. a <document> may use headings, lists and tables. Your chat sentences stay in the persona's voice.)\n\n" : ""}` : ""}${step >= maxSteps ? "Now answer the user's question in full, without another tool call." : "Now answer the user's question, or call another tool."}`
      : "";
    // The reply may be a tool call with chatter around it ("Sebentar ya...\nTOOL: {...}"), so hold the whole
    // reply and show it only once we know it is the final answer.
    let res = await chatFn(base + exchanges.join("") + tail, { ...opts });
    const call = step < maxSteps ? parseToolCall(res.text) : null;
    if (!call) res = await finishReply(res, (message || question).slice(-1500), chatFn, opts, { onToolStart, onTool }); // a cut-off answer is carried on
    if (!call) {
      const withoutMockups = extractMockups(res.text); // first: the HTML inside must not be read as anything else
      for (const m of withoutMockups.mockups) { mockups.push(m); onMockup?.(m); }
      const found = extractDocuments(withoutMockups.text);
      for (const d of found.documents) { documents.push(d); onDocument?.(d); }
      // a reply that is only a document or a mockup still needs a chat line
      const text = stripToolLines(found.text) || (mockups.length ? "Ini mockup-nya, ada di panel kanan." : documents.length ? "Ini dokumennya, ada di panel kanan." : "");
      if (text) onChunk?.(text);
      return { ...res, text, images, documents, mockups, steps: step };
    }
    onToolStart?.(call);
    let out;
    try {
      const tool = tools[call.name];
      if (!tool) throw new Error(`unknown tool "${call.name}"`);
      const result = await tool.run(call.args, { signal: opts.signal, env });
      if (tool.image) {
        images.push(result);
        out = { result: `shown to the user: ${result.title}`, image: result };
      } else if (tool.skill) out = { result: String(result).slice(0, SKILL_CHARS) };
      else out = { result: JSON.stringify(result).slice(0, RESULT_CHARS) };
    } catch (e) {
      out = { error: e.message };
    }
    onTool?.({ ...call, ...out });
    exchanges.push(`\n\nYou called ${call.name} ${JSON.stringify(call.args)}. Result:\n${out.error ? `error: ${out.error}` : out.result}`);
  }
}
