import assert from "node:assert/strict";
import { test } from "node:test";
import { agentChat, parseToolCall } from "../src/agent.js";
import { assertPublicUrl, htmlToText, parseDdg } from "../src/tools.js";

test("parseToolCall: a TOOL line, a normal answer, broken JSON", () => {
  assert.deepEqual(parseToolCall('TOOL: {"name":"web_search","args":{"query":"x"}}'), { name: "web_search", args: { query: "x" } });
  assert.equal(parseToolCall("Puasa adalah menahan diri."), null);
  assert.equal(parseToolCall("TOOL: {oops"), null);
});

test("agentChat: runs the tool, feeds the result back, streams only the final answer", async () => {
  const prompts = [], chunks = [];
  const replies = ['TOOL: {"name":"web_search","args":{"query":"jadwal"}}', "Jawaban akhir"];
  const chatFn = async (prompt, { onChunk }) => {
    prompts.push(prompt);
    const text = replies.shift();
    onChunk?.(text);
    return { text, references: [] };
  };
  const tools = { web_search: { run: async ({ query }) => [{ title: query }], usage: "{}", does: "d" } };
  const res = await agentChat("kapan?", { chatFn, tools, onChunk: (t) => chunks.push(t) });
  assert.equal(res.text, "Jawaban akhir");
  assert.equal(res.steps, 1);
  assert.deepEqual(chunks, ["Jawaban akhir"]);
  assert.match(prompts[1], /Result:\n\[\{"title":"jadwal"\}\]/);
});

test("agentChat: unknown tool becomes an error result, and maxSteps stops the loop", async () => {
  const chatFn = async (_p, { onChunk }) => {
    const text = 'TOOL: {"name":"nope","args":{}}';
    onChunk?.(text);
    return { text, references: [] };
  };
  const res = await agentChat("q", { chatFn, tools: {}, maxSteps: 1, onChunk: () => {} });
  assert.equal(res.steps, 1);
});

test("assertPublicUrl: blocks localhost, private IPs and non-http", async () => {
  for (const u of ["http://localhost/x", "http://127.0.0.1/", "http://192.168.1.5/", "http://169.254.169.254/latest", "file:///etc/passwd"]) {
    await assert.rejects(assertPublicUrl(u), u);
  }
});

test("htmlToText and parseDdg", () => {
  assert.equal(htmlToText("<head><title>t</title></head><script>x()</script><p>Halo &amp; <b>dunia</b></p>"), "Halo & dunia");
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.com%2Fa&rut=1">Judul</a> <a class="result__snippet" href="#">Cuplikan <b>teks</b></a>';
  assert.deepEqual(parseDdg(html), [{ title: "Judul", url: "https://ex.com/a", snippet: "Cuplikan teks" }]);
});

test("parseToolCall: accepts a bare JSON call without the TOOL: prefix", () => {
  assert.deepEqual(parseToolCall(' {"name": "web_search", "args": {"query": "x"}}'), { name: "web_search", args: { query: "x" } });
});

test("agentChat: a tool call streamed in small pieces is never shown", async () => {
  const chunks = [];
  const replies = [['TOOL:', ' {"name":"t",', '"args":{}}'], ["Ja", "waban"]];
  const chatFn = async (_p, { onChunk }) => {
    const parts = replies.shift();
    parts.forEach((p) => onChunk?.(p));
    return { text: parts.join(""), references: [] };
  };
  await agentChat("q", { chatFn, tools: { t: { run: async () => 1, usage: "", does: "" } }, onChunk: (t) => chunks.push(t) });
  assert.equal(chunks.join(""), "Jawaban");
});

test("agentChat: chatter before the tool line is dropped, and a leftover tool line is stripped from the answer", async () => {
  const chunks = [];
  const replies = ['Halo! Sebentar ya, aku cek dulu.\n\nTOOL: {"name":"t","args":{}}', "Hasilnya 3 November.\nTOOL: {\"name\":\"t\",\"args\":{}}"];
  const chatFn = async () => ({ text: replies.shift(), references: [] });
  const res = await agentChat("q", { chatFn, maxSteps: 1, tools: { t: { run: async () => 1, usage: "", does: "" } }, onChunk: (t) => chunks.push(t) });
  assert.deepEqual(chunks, ["Hasilnya 3 November."]);
  assert.equal(res.text, "Hasilnya 3 November.");
});

test("agentChat: an image tool's picture is returned in images and the model only gets its title", async () => {
  const prompts = [];
  const replies = ['TOOL: {"name":"show_image","args":{"query":"Kaaba"}}', "Ini Kabah."];
  const chatFn = async (p) => (prompts.push(p), { text: replies.shift(), references: [] });
  const pic = { url: "https://upload.wikimedia.org/x.jpg", title: "Kaaba", credit: "A, CC BY", page: "https://commons.wikimedia.org/wiki/File:x.jpg" };
  const tools = { show_image: { run: async () => pic, image: true, usage: "", does: "" } };
  const res = await agentChat("q", { chatFn, tools, onChunk: () => {} });
  assert.deepEqual(res.images, [pic]);
  assert.match(prompts[1], /shown to the user: Kaaba/);
  assert.doesNotMatch(prompts[1], /upload\.wikimedia/);
});

test("agentChat: onToolStart fires before the tool runs, and the persona is restated last after a tool result", async () => {
  const order = [], prompts = [];
  const replies = ['TOOL: {"name":"t","args":{"a":1}}', "Jawaban"];
  const chatFn = async (p) => (prompts.push(p), { text: replies.shift(), references: [] });
  const tools = { t: { run: async () => (order.push("run"), "hasil"), usage: "", does: "" } };
  await agentChat("kapan?", { chatFn, tools, persona: "You are Maria.", onToolStart: () => order.push("start"), onTool: () => order.push("end"), onChunk: () => {} });
  assert.deepEqual(order, ["start", "run", "end"]);
  assert.ok(!prompts[0].includes("Stay in character"));
  assert.match(prompts[1], /Result:\n"hasil"[\s\S]*Stay in character, exactly as described above:\nYou are Maria\.[\s\S]*Now answer/);
  assert.ok(prompts[1].trimEnd().endsWith("or call another tool."));
});

test("toolInstructions: today's date is the local date, not the UTC one", async () => {
  const { toolInstructions } = await import("../src/agent.js");
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  assert.ok(toolInstructions({}).startsWith(`Today is ${local} `));
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkill, skillTool } from "../src/skills.js";
import { loadSkills } from "../src/skills-fs.js";
import { extractDocuments, toolInstructions } from "../src/agent.js";

test("parseSkill / loadSkills: reads SKILL.md frontmatter, ignores folders without one", () => {
  assert.deepEqual(parseSkill("---\nname: x\ndescription: Does x\n---\n\n# Body\ntext"), { name: "x", description: "Does x", triggers: [], body: "# Body\ntext" });
  assert.equal(parseSkill("no frontmatter"), null);
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  mkdirSync(join(dir, "a")); writeFileSync(join(dir, "a", "SKILL.md"), "---\nname: a\ndescription: A\n---\nbody a");
  mkdirSync(join(dir, "empty"));
  assert.deepEqual([...loadSkills(dir).keys()], ["a"]);
  assert.equal(loadSkills("/nonexistent/dir").size, 0);
});

test("the repo ships a writing-md skill", () => {
  const k = loadSkills().get("writing-md");
  assert.ok(k && k.description && k.body.includes("<document"));
});

test("skillTool: returns the body, rejects unknown names (no path traversal)", async () => {
  const t = skillTool(new Map([["a", { name: "a", description: "", body: "BODY" }]]));
  assert.equal(await t.run({ name: "a" }), "BODY");
  await assert.rejects(t.run({ name: "../../etc/passwd" }), /unknown skill/);
});

test("extractDocuments: title attr, heading fallback, unclosed tag, no document", () => {
  assert.deepEqual(extractDocuments('Ini ya.\n\n<document title="Puasa">\n# Puasa\n- a\n</document>\n\nSemoga.'), { text: "Ini ya.\n\nSemoga.", documents: [{ title: "Puasa", markdown: "# Puasa\n- a" }] });
  assert.equal(extractDocuments("<document>\n# Judul\nisi").documents[0].title, "Judul");
  assert.deepEqual(extractDocuments("halo"), { text: "halo", documents: [] });
});

test("toolInstructions lists skills; agentChat loads a skill, then emits the document and a clean chat text", async () => {
  const skills = new Map([["writing-md", { name: "writing-md", description: "Write docs", body: "SKILL TEXT" }]]);
  assert.match(toolInstructions({}, skills), /- writing-md: Write docs/);
  const prompts = [], docs = [], chunks = [];
  const replies = ['TOOL: {"name":"load_skill","args":{"name":"writing-md"}}', 'Siap!\n<document title="Catatan">\n# Catatan\nisi\n</document>'];
  const chatFn = async (p) => (prompts.push(p), { text: replies.shift(), references: [] });
  const res = await agentChat("buatkan catatan", { chatFn, skills, tools: {}, onDocument: (d) => docs.push(d), onChunk: (t) => chunks.push(t) });
  assert.match(prompts[1], /Result:\nSKILL TEXT/);
  assert.deepEqual(docs, [{ title: "Catatan", markdown: "# Catatan\nisi" }]);
  assert.deepEqual(chunks, ["Siap!"]);
  assert.equal(res.documents.length, 1);
});

test("matchingSkills: whole-word trigger match, any case; agentChat preloads the matching skill's text", async () => {
  const { matchingSkills } = await import("../src/skills.js");
  const skills = new Map([["w", { name: "w", description: "d", triggers: ["catatan", "table"], body: "WRITE LIKE THIS" }]]);
  assert.equal(matchingSkills(skills, "Buatkan CATATAN singkat").length, 1);
  assert.equal(matchingSkills(skills, "kata catatanku?").length, 0);
  assert.equal(matchingSkills(skills, "stable").length, 0);
  assert.equal(matchingSkills(skills, "apa itu puasa").length, 0);
  const prompts = [];
  const chatFn = async (p) => (prompts.push(p), { text: "ok", references: [] });
  await agentChat("q", { chatFn, skills, tools: {}, message: "tolong buat catatan", onChunk: () => {} });
  await agentChat("q", { chatFn, skills, tools: {}, message: "apa itu puasa", onChunk: () => {} });
  assert.match(prompts[0], /Skill "w" applies to this request[\s\S]*WRITE LIKE THIS[\s\S]*User question: q/);
  assert.doesNotMatch(prompts[1], /WRITE LIKE THIS/);
});

import { webSearch } from "../src/tools.js";

const ddgPage = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fex.com%2Fa">Judul</a> <a class="result__snippet" href="#">Cuplikan</a>';
const withFetch = async (fake, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test("webSearch: DuckDuckGo via POST, then GET when POST is refused, then Wikipedia; every result says which", async () => {
  const calls = [];
  // 1. POST answers
  let out = await withFetch(async (u, i = {}) => (calls.push((i.method ?? "GET") + " " + new URL(String(u)).pathname), new Response(ddgPage, { status: 200 })), () => webSearch({ query: "x" }, { env: {} }));
  assert.deepEqual(out, [{ via: "duckduckgo", title: "Judul", url: "https://ex.com/a", snippet: "Cuplikan" }]);
  assert.deepEqual(calls, ["POST /html/"]);
  // 2. POST gets the 202 bot check, GET answers
  out = await withFetch(async (u, i = {}) => (i.method === "POST" ? new Response("challenge", { status: 202 }) : new Response(ddgPage)), () => webSearch({ query: "x" }, { env: {} }));
  assert.equal(out[0].via, "duckduckgo");
  // 3. both refused: Wikipedia
  out = await withFetch(async (u) => (String(u).includes("duckduckgo") ? new Response("no", { status: 202 }) : Response.json({ query: { search: [{ title: "Puasa", snippet: "x" }] } })), () => webSearch({ query: "x" }, { env: {} }));
  assert.deepEqual(out.map((r) => [r.via, r.url]), [["wikipedia", "https://id.wikipedia.org/wiki/Puasa"]]);
  // a Brave key that fails does not stop the search
  out = await withFetch(async (u) => (String(u).includes("brave") ? new Response("quota", { status: 429 }) : new Response(ddgPage)), () => webSearch({ query: "x" }, { env: { BRAVE_API_KEY: "k" } }));
  assert.equal(out[0].via, "duckduckgo");
});
