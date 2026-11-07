import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { colleagueTool } from "../src/colleagues.js";
import { loadPersonas } from "../src/personas-fs.js";
import { IDS, ROSTER, byId, findColleague } from "../src/roster.js";
import { parseAgentBody, runAgent } from "../src/serve.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const personas = loadPersonas();

test("the roster matches the page's list: same people, names and roles, in the same order", () => {
  const page = [...html.matchAll(/^\s*\{ id: "(\w+)", name: "(\w+)", persona: "personas\/(\w+)\.md", avatar: "[^"]+", color: "#[0-9a-f]{6}", about: "([^"]+)" \}/gm)].map((m) => ({ id: m[1], name: m[2], file: m[3], about: m[4] }));
  assert.equal(page.length, 13);
  assert.deepEqual(page.map((p) => p.id), IDS);
  for (const p of page) {
    const r = byId(p.id);
    assert.equal(p.name, r.name);
    assert.equal(p.about, `${r.group} · ${r.role}`);
    assert.equal(p.file, p.id, "a persona file is named after the id");
  }
});

test("the personas load for everybody on the server, each speaking as its own person", () => {
  assert.equal(personas.size, 13);
  for (const p of ROSTER) assert.match(personas.get(p.id), new RegExp(`^You are ${p.name}\\b`), p.id);
});

test("findColleague: by name, id, role words in English and Indonesian; never yourself; no match is null", () => {
  assert.equal(findColleague("Sinta", "engineer").id, "qa");
  assert.equal(findColleague("sinta", "engineer").id, "qa");
  assert.equal(findColleague("qa", "engineer").id, "qa");
  assert.equal(findColleague("QA tester", "engineer").id, "qa");
  assert.equal(findColleague("UI/UX designer", "engineer").id, "designer");
  assert.equal(findColleague("desain", "engineer").id, "designer");
  assert.equal(findColleague("product owner", "qa").id, "po");
  assert.equal(findColleague("devops", "engineer").id, "devops");
  assert.equal(findColleague("Kirana", "designer"), null, "not yourself");
  assert.equal(findColleague("copywriter", "brand").id, "copywriter");
  assert.equal(findColleague("manajer komunitas", "brand")?.id ?? "community", "community");
  assert.equal(findColleague("nobody at all", "engineer"), null);
  assert.equal(findColleague("", "engineer"), null);
});

test("colleagueTool: the colleague answers from their own persona, briefly; the visit is announced; it ends even when the colleague fails", async () => {
  const events = [], prompts = [];
  const tool = colleagueTool({ askerId: "engineer", personas, chatFn: async (q) => { prompts.push(q); return { text: " Cek kasus batas dulu. " }; }, onConsult: (e) => events.push(e) });
  assert.match(tool.does, /Sinta: QA/);
  assert.doesNotMatch(tool.does, /Bima:/, "not offered to ask yourself");
  const r = await tool.run({ colleague: "QA", question: "Test apa yang paling penting?" });
  assert.deepEqual(r, { colleague: "Sinta", role: "QA / QC Engineer", answer: "Cek kasus batas dulu." });
  assert.match(prompts[0], /^You are Sinta/);
  assert.match(prompts[0], /Bima \(Software Engineer\) asks you a quick question/);
  assert.match(prompts[0], /Do not use tools and do not ask anybody else/);
  assert.deepEqual(events.map((e) => [e.phase, e.from, e.to]), [["start", "engineer", "qa"], ["end", "engineer", "qa"]]);
  await assert.rejects(tool.run({ colleague: "Hantu", question: "halo?" }), /no teammate called "Hantu"; choose one of: Raka/);
  await assert.rejects(tool.run({ colleague: "Sinta", question: "  " }), /question is empty/);
  assert.equal((await tool.run({ colleague: "Sinta", question: "lagi" })).colleague, "Sinta", "a second question is fine");
  await assert.rejects(tool.run({ colleague: "Sinta", question: "dan lagi" }), /already asked two colleagues/, "a third is refused");
  const failing = colleagueTool({ askerId: "engineer", personas, chatFn: async () => { throw new Error("boom"); }, onConsult: (e) => events.push(e) });
  events.length = 0;
  await assert.rejects(failing.run({ colleague: "Sinta", question: "halo?" }), /boom/);
  assert.deepEqual(events.map((e) => e.phase), ["start", "end"]);
  assert.rejects(colleagueTool({ askerId: "engineer", personas: new Map(), chatFn: async () => ({ text: "x" }) }).run({ colleague: "Sinta", question: "a" }), /not available/);
});

test("parseAgentBody: who is asking is checked against the roster", () => {
  assert.equal(parseAgentBody('{"question":"a","agent":"engineer"}').agent, "engineer");
  assert.equal(parseAgentBody('{"question":"a","agent":"hacker"}').agent, undefined);
  assert.equal(parseAgentBody('{"question":"a"}').agent, undefined);
});

test("runAgent: a professional asks a colleague, the page is told (consult start and end), and the answer uses what the colleague said", async () => {
  const sent = [];
  const prompts = [];
  const chatFn = async (q) => {
    prompts.push(q);
    if (/asks you a quick question/.test(q)) return { text: "Uji kasus batas dan input kosong.", references: [] };
    if (/Uji kasus batas/.test(q)) return { text: "Menurut Sinta, uji kasus batas dan input kosong. Jadi tulis tes itu dulu.", references: [] };
    return { text: 'TOOL: {"name":"ask_colleague","args":{"colleague":"Sinta","question":"Tes apa dulu?"}}', references: [] };
  };
  const body = parseAgentBody(JSON.stringify({ question: "Bagaimana mengetes fungsi pembayaran?", message: "Bagaimana mengetes fungsi pembayaran?", persona: "You are Bima.", agent: "engineer" }));
  const summary = await runAgent(body, { send: (e) => sent.push(e), chatFn, personas, skills: undefined });
  const types = sent.map((e) => e.type + (e.phase ? ":" + e.phase : ""));
  assert.deepEqual(types.filter((t) => /consult|tool/.test(t)), ["tool:start", "consult:start", "consult:end", "tool:end"]);
  assert.deepEqual(sent.find((e) => e.type === "consult"), { type: "consult", phase: "start", from: "engineer", to: "qa", toName: "Sinta" });
  assert.match(sent.find((e) => e.type === "chunk").text, /Menurut Sinta/);
  assert.equal(summary.consults, 1);
  assert.match(prompts[0], /ask_colleague/, "the professional is told the tool exists");
  assert.equal(sent.at(-1).type, "done");
});

test("runAgent: without the personas (the Worker's own fallback) or without knowing who asks, there is no colleague tool", async () => {
  for (const [personasArg, agent] of [[undefined, "engineer"], [personas, undefined]]) {
    const prompts = [];
    await runAgent(parseAgentBody(JSON.stringify({ question: "halo", agent })), { send: () => {}, chatFn: async (q) => { prompts.push(q); return { text: "Halo!", references: [] }; }, personas: personasArg });
    assert.doesNotMatch(prompts[0], /ask_colleague/);
  }
});

test("a model that writes only the arguments (no name, no args wrapper) still calls the colleague tool", async () => {
  const { parseToolCall } = await import("../src/agent.js");
  assert.deepEqual(parseToolCall('TOOL: {"colleague":"Sinta","question":"Tes apa dulu?"}'), { name: "ask_colleague", args: { colleague: "Sinta", question: "Tes apa dulu?" } });
  assert.deepEqual(parseToolCall('Saya tanya dulu.\n{"colleague": "QA", "question": "x"}'), { name: "ask_colleague", args: { colleague: "QA", question: "x" } }, "alone on its line");
  assert.deepEqual(parseToolCall('Saya tanya dulu. TOOL: {"colleague": "QA", "question": "x"}'), { name: "ask_colleague", args: { colleague: "QA", question: "x" } }, "after words, with TOOL:");
  assert.equal(parseToolCall('{"colleague":"Sinta"}'), null, "a half call is not a call");
  assert.deepEqual(parseToolCall('TOOL: {"name":"web_search","args":{"query":"a"}}'), { name: "web_search", args: { query: "a" } }, "the normal shape is unchanged");
  assert.match(colleagueTool({ askerId: "engineer", personas, chatFn: async () => ({ text: "" }) }).does, /TOOL: \{"name": "ask_colleague"/, "the description shows a whole call");
});
