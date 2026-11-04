#!/usr/bin/env node
// Chat with islam-gpt.org in the terminal.
//   node bin/chat.js                 interactive: type a question, the answer streams in
//   node bin/chat.js "apa itu puasa" one question, then exit
//   node bin/chat.js --web ...       the model may search the web / read pages (BRAVE_API_KEY optional, else DuckDuckGo)
// In the chat: /refs shows the sources of the last answer, /web toggles web tools, /exit (or Ctrl+D) quits.
import { createInterface } from "node:readline/promises";
import { chat } from "../src/islam.js";
import { agentChat } from "../src/agent.js";
import { loadSkills } from "../src/skills-fs.js";

let lastRefs = [];
let web = process.argv.includes("--web");

async function answer(question) {
  try {
    const onChunk = (t) => process.stdout.write(t);
    const { references, images = [], documents = [] } = web
      ? await agentChat(question, { skills: loadSkills(), onChunk, onTool: (t) => console.error(`\n[${t.name} ${JSON.stringify(t.args)}${t.error ? ` -> ${t.error}` : ""}]`) })
      : await chat(question, { onChunk });
    lastRefs = references;
    for (const d of documents) process.stdout.write(`\n\n--- ${d.title} ---\n${d.markdown}\n---`);
    for (const i of images) process.stdout.write(`\n[image] ${i.title} (${i.credit}) ${i.url}`);
    process.stdout.write(`\n${references.length ? `(${references.length} sources, /refs to show)\n` : ""}`);
  } catch (e) {
    console.error(`\nerror: ${e.message}`);
  }
}

const arg = process.argv.slice(2).filter((a) => a !== "--web").join(" ").trim();
if (arg) {
  await answer(arg);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("islam-gpt chat. /refs = sources of the last answer, /web = toggle web tools, /exit = quit.");
rl.on("close", () => process.exit(0));
for (;;) {
  const line = (await rl.question("\n> ")).trim();
  if (!line) continue;
  if (line === "/exit") break;
  if (line === "/web") {
    web = !web;
    console.log(`web tools ${web ? "on" : "off"}`);
    continue;
  }
  if (line === "/refs") {
    lastRefs.forEach((r, i) => console.log(`[${i + 1}] ${r.source}: ${String(r.content).slice(0, 160)}...`));
    continue;
  }
  await answer(line);
}
rl.close();
