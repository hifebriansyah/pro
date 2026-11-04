// Tool loop over a text-only API: islam-gpt.org has no function calling, so the prompt teaches the model a
// one-line protocol (TOOL: {"name":...,"args":{...}}), we run the tool, and ask again with the result inside.
import { chat as islamChat } from "./islam.js";
import { TOOLS } from "./tools.js";
import { matchingSkills, skillTool } from "./skills.js";

const MAX_STEPS = 3;
const RESULT_CHARS = 4000;
const SKILL_CHARS = 8000; // instructions are not search results: do not cut them like one

export function toolInstructions(tools = TOOLS, skills = new Map(), timeZone) {
  const list = Object.entries(tools).map(([n, t]) => `- ${n} ${t.usage}: ${t.does}`).join("\n");
  const skillList = skills.size ? `\n\nSkills (call load_skill with the name to read its instructions BEFORE doing that kind of task, then follow them):\n${[...skills.values()].map((k) => `- ${k.name}: ${k.description}`).join("\n")}\nA skill's rules for what it produces (a Markdown document, say) override your persona's plain-text and no-list rules for that output only; your chat sentences keep your persona's voice.` : "";
  return `Today is ${new Date().toLocaleDateString("en-CA", { timeZone })} (use this for questions about today's date; no search needed). You can look things up on the internet. Tools:\n${list}${skillList}\n\nTo use a tool, reply with ONLY that one line: no greeting, no "wait a moment", no other text before or after it: TOOL: {"name": "<tool>", "args": {...}}\nYou will then get the result and can answer. Use a tool only for recent or unknown facts; otherwise answer directly. Cite the URLs you used.`;
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
    const markdown = body.trim();
    if (markdown) documents.push({ title: (title ?? /^#\s+(.+)$/m.exec(markdown)?.[1] ?? "Dokumen").trim().slice(0, 120), markdown });
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), documents };
}

/**
 * Ask with web tools. Calls onChunk once, with the final answer (replies are held back until we know they are not tool calls).
 * Options: persona (who the model must stay as; repeated after every tool result so it does not drift), tools,
 * skills (a Map: loadSkills() from skills-fs.js on Node, skillsFromList() on Workers; default none), env (settings handed to the tools, e.g. BRAVE_API_KEY),
 * timeZone (for "today"; Workers run in UTC, so the Worker sets Asia/Jakarta), message (the user's latest text: skills whose trigger words it contains are preloaded), chatFn (for tests), onToolStart({name,args}) before a tool runs,
 * onTool({name,args,result|error}) after, onDocument({title,markdown}) for each document in the answer, plus the islam.js options.
 * Resolves to { text, references, images, documents, steps }.
 */
export async function agentChat(question, { onChunk, onTool, onToolStart, onDocument, skills = new Map(), env, timeZone, message = "", persona = "", tools = TOOLS, chatFn = islamChat, maxSteps = MAX_STEPS, ...opts } = {}) {
  if (skills.size && !tools.load_skill) tools = { ...tools, load_skill: skillTool(skills) };
  const images = [];
  const documents = [];
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
    const res = await chatFn(base + exchanges.join("") + tail, { ...opts });
    const call = step < maxSteps ? parseToolCall(res.text) : null;
    if (!call) {
      const found = extractDocuments(res.text);
      for (const d of found.documents) { documents.push(d); onDocument?.(d); }
      // a reply that is only a document still needs a chat line
      const text = stripToolLines(found.text) || (documents.length ? "Ini dokumennya, ada di panel kanan." : "");
      if (text) onChunk?.(text);
      return { ...res, text, images, documents, steps: step };
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
