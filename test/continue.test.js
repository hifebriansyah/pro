import assert from "node:assert/strict";
import { test } from "node:test";
import { agentChat } from "../src/agent.js";
import { MAX_PARTS, cleanContinuation, continuationPrompt, openBlock, outline } from "../src/continue.js";

test("openBlock: knows what a reply is still inside", () => {
  assert.equal(openBlock("Halo, ini jawaban biasa."), null);
  assert.equal(openBlock('Ini.\n<document title="A">\n# A\nisi'), "document");
  assert.equal(openBlock('<document title="A">\n# A\n</document>\nSelesai.'), null);
  assert.equal(openBlock('Ini.\n<mockup title="A"><html><body>'), "mockup");
  assert.equal(openBlock('<mockup title="A"><svg></svg></mockup>'), null);
  assert.equal(openBlock("Kodenya:\n```js\nconst a = 1;\n"), "fence");
  assert.equal(openBlock("Kodenya:\n```js\nconst a = 1;\n```\nSelesai."), null);
  assert.equal(openBlock("~~~\nx"), "fence");
  // fences inside a finished document do not matter, an open document wins over its own fences
  assert.equal(openBlock('<document title="A">\n```js\nx\n```\n```js\nodd\n</document>'), null);
  assert.equal(openBlock('<document title="A">\n```js\nx\n```\nlanjut'), "document");
});

test("cleanContinuation: joins mid-word, removes a repeated start, a reopened fence or tag, and stops on DONE or a restart", () => {
  assert.equal(cleanContinuation("const ab", "c = 1;", "fence"), "c = 1;");
  const prev = "function total(items) {\n  let sum = 0;\n  for (const i of items) {";
  assert.equal(cleanContinuation(prev, "  let sum = 0;\n  for (const i of items) {\n    sum += i.price;\n  }", "fence"), "\n    sum += i.price;\n  }"); // the repeated end is dropped
  assert.equal(cleanContinuation("a\nb\n", "```js\nc();\n```", "fence"), "c();\n```"); // reopened fence
  assert.equal(cleanContinuation("# A\n\nisi", '<document title="A">\nlanjut\n</document>', "document"), "lanjut\n</document>"); // reopened tag
  assert.equal(cleanContinuation("# A", "DONE", "document"), "");
  assert.equal(cleanContinuation("# A", "  selesai.  ", "document"), "");
  assert.equal(cleanContinuation("<html><body><p>x", "<!doctype html><html><body><p>baru</p></body></html>", "mockup"), ""); // started the page over
  assert.equal(cleanContinuation("a short end", "short end and more", "document"), "short end and more"); // under the overlap minimum: kept
});

test("continuationPrompt: the request, the last 1,200 characters, the place, and the closing word", () => {
  const text = "x".repeat(3000) + "TAIL-END";
  const p = continuationPrompt({ request: "buatkan PRD", text, kind: "document", part: 2 });
  assert.match(p, /REQUEST:\nbuatkan PRD/);
  assert.ok(p.includes("TAIL-END") && !p.includes("x".repeat(1300)), "only the end is shown");
  assert.match(p, /inside a <document>/);
  assert.match(p, /close it with <\/document>/);
  assert.match(p, /reply with exactly DONE/);
  assert.match(continuationPrompt({ request: "r", text: "```js\na", kind: "fence", part: 3 }), /closing ``` line/);
});

const scripted = (...replies) => { const prompts = []; const fn = async (p) => (prompts.push(p), { text: replies.shift() ?? "DONE", references: [] }); fn.prompts = prompts; return fn; };

test("agentChat: a document cut off twice is carried on and arrives as one complete document", async () => {
  const chatFn = scripted('Ini PRD-nya.\n<document title="PRD">\n# PRD\n\n## Latar\nSatu dua tiga ', "empat lima.\n\n## Tujuan\nTujuan satu", " dan dua.\n</document>\nCek asumsinya.");
  const docs = [], chunks = [], tools = [];
  const res = await agentChat("buatkan PRD", { chatFn, tools: {}, message: "buatkan PRD lengkap", onDocument: (d) => docs.push(d), onChunk: (t) => chunks.push(t), onToolStart: (t) => tools.push(["start", t.name, t.args.part]), onTool: (t) => tools.push(["end", t.name, t.args.part]) });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].markdown, "# PRD\n\n## Latar\nSatu dua tiga empat lima.\n\n## Tujuan\nTujuan satu dan dua.");
  assert.deepEqual(chunks, ["Ini PRD-nya.\n\nCek asumsinya."]);
  assert.deepEqual(tools, [["start", "continue", 2], ["end", "continue", 2], ["start", "continue", 3], ["end", "continue", 3]]);
  assert.equal(chatFn.prompts.length, 3);
  assert.match(chatFn.prompts[1], /REQUEST:\nbuatkan PRD lengkap/); // the user's latest message, not the whole prompt
  assert.match(chatFn.prompts[2], /Tujuan satu\n>>>/); // the end of the text so far, including the first continuation
  assert.equal(res.documents.length, 1);
});

test("agentChat: a cut-off mockup and a cut-off code fence are carried on too; a finished answer is not", async () => {
  const mocks = [];
  await agentChat("x", { chatFn: scripted('<mockup title="Home"><!doctype html><html><body><h1>Halo', "</h1><p>dunia</p></body></html></mockup>"), tools: {}, onMockup: (m) => mocks.push(m), onChunk: () => {} });
  assert.deepEqual(mocks, [{ title: "Home", html: "<!doctype html><html><body><h1>Halo</h1><p>dunia</p></body></html>" }]);

  const chunks = [];
  await agentChat("x", { chatFn: scripted("Kodenya:\n```js\nconst a = 1;\n", "const b = 2;\n```\nSelesai."), tools: {}, onChunk: (t) => chunks.push(t) });
  assert.equal(chunks[0], "Kodenya:\n```js\nconst a = 1;\nconst b = 2;\n```\nSelesai.");

  const done = scripted('<document title="A">\n# A\n</document>');
  await agentChat("x", { chatFn: done, tools: {}, onChunk: () => {} });
  assert.equal(done.prompts.length, 1, "a closed document is not continued");
});

test("agentChat: limits and failures: at most MAX_PARTS parts, DONE stops, an error keeps what was written, a tool call is not continued", async () => {
  // the model never closes: stops after MAX_PARTS calls, keeps everything
  let n = 0;
  const endless = async () => ({ text: `<document title="E">\npart${++n} ` , references: [] });
  const docs = [];
  const chunks = [];
  await agentChat("x", { chatFn: async (p) => (n ? { text: `more${++n} `, references: [] } : endless()), tools: {}, onDocument: (d) => docs.push(d), onChunk: (t) => chunks.push(t) });
  assert.equal(n, MAX_PARTS);
  assert.ok(docs[0].markdown.startsWith("part1 more2 more3 more4 more5 more6"), docs[0].markdown);

  const stopped = scripted('<document title="A">\n# A\ntext', "DONE");
  const d2 = [];
  await agentChat("x", { chatFn: stopped, tools: {}, onDocument: (d) => d2.push(d), onChunk: () => {} });
  assert.equal(stopped.prompts.length, 2);
  assert.equal(d2[0].markdown, "# A\ntext");

  let calls = 0;
  const failing = async () => { if (++calls >= 2) throw new Error("HTTP 502"); return { text: '<document title="A">\n# A\ntexte', references: [] }; };
  const d3 = [], ev = [];
  await agentChat("x", { chatFn: failing, tools: {}, onDocument: (d) => d3.push(d), onChunk: () => {}, onTool: (t) => ev.push(t) });
  assert.equal(calls, 3, "one retry, then it gives up");
  assert.equal(d3[0].markdown, "# A\ntexte");
  assert.match(ev.at(-1).error, /502/);

  // a one-off failure is retried and the continuation goes through
  let tries = 0;
  const flaky = async () => (++tries === 1 ? { text: '<document title="A">\n# A\ntexte ', references: [] } : tries === 2 ? (() => { throw new Error("fetch failed"); })() : { text: "lanjut\n</document>", references: [] });
  const d4 = [];
  await agentChat("x", { chatFn: flaky, tools: {}, onDocument: (d) => d4.push(d), onChunk: () => {} });
  assert.equal(d4[0].markdown, "# A\ntexte lanjut");

  // a stalled continuation is cut off by the timeout signal it is given
  let seen;
  await agentChat("x", { chatFn: async (_p, o) => { seen = o.signal; return { text: seen ? "DONE" : '<document title="A">\n# A\nx', references: [] }; }, tools: {}, onChunk: () => {} });
  assert.ok(seen instanceof AbortSignal, "the continuation call carries a timeout signal");

  // a tool call that happens to contain an open tag is a tool call, not a cut-off answer
  const tool = scripted('TOOL: {"name":"t","args":{}}', "Hasil akhir.");
  await agentChat("x", { chatFn: tool, tools: { t: { run: async () => "ok", usage: "", does: "" } }, onChunk: () => {} });
  assert.equal(tool.prompts.length, 2);
  assert.doesNotMatch(tool.prompts[1], /cut off by a length limit/);
});

test("outline: the headings outside code, and the declarations of a program with their parameters, without locals", () => {
  const text = [
    "# Sistem Stok", "", "## Asumsi", "", "```bash", "# ini komentar, bukan judul", "node app.js", "```", "", "## Kode", "",
    "```js", "function csvEscape(value) {", "  const local = 1;", "  return value;", "}", "class Inventory {", "  constructor(name, items = []) {", "  }", "  addProduct(p) {", "    if (p) { return 1; }", "  }", "  static async load(path) {", "  }", "}",
    "class Order extends Inventory {", "  constructor(inventory, items) {", "  }", "}",
    "const MAX = 10;", "export async function main(argv, env) {", "}",
  ].join("\n");
  const o = outline(text);
  assert.deepEqual(o.headings, ["Sistem Stok", "Asumsi", "Kode"]); // the bash comment is not a heading
  assert.deepEqual(o.names, ["csvEscape(value)", "class Inventory", "Inventory.constructor(name, items = [])", "Inventory.addProduct(p)", "Inventory.load(path)", "class Order", "Order.constructor(inventory, items)", "MAX", "main(argv, env)"]);
  assert.ok(!o.names.some((n) => /local|^if/.test(n)));
  assert.deepEqual(outline("jawaban biasa tanpa apa-apa"), { headings: [], names: [] });
  const big = Array.from({ length: 400 }, (_, i) => `function nama${i}(a, b) {}`).join("\n");
  assert.ok(outline(big).names.join("; ").length <= 3500 + 2 * 400 && outline(big).names.length < 400, "capped");
});

test("continuationPrompt: lists what is already written, and says not to write it again", () => {
  const text = '<document title="A">\n# A\n\n## Tujuan\n\n```js\nfunction csvEscape(v) {\n  return v;\n}\nfunction tail() {';
  const p = continuationPrompt({ request: "r", text, kind: "document", part: 2 });
  assert.match(p, /ALREADY WRITTEN, DO NOT WRITE AGAIN/);
  assert.match(p, /Sections: A; Tujuan/);
  assert.match(p, /Declarations already written \(exact names and parameters; call them exactly like this\): csvEscape\(v\); tail\(\)/);
  assert.doesNotMatch(continuationPrompt({ request: "r", text: "<document>\nisi tanpa judul", kind: "document", part: 2 }), /ALREADY WRITTEN/);
});

import { readFileSync } from "node:fs";
test("the page shows which part is being written", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /name === "continue" \? `melanjutkan jawaban \(bagian \$\{args\?\.part \?\? "\?"\}\)…`/);
});
