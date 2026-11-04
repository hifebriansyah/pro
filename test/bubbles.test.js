import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

// The helpers that decide how a bubble is drawn are in index.html between <md-bubbles> markers: run exactly that code.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const block = /\/\/ <md-bubbles>([\s\S]*?)\/\/ <\/md-bubbles>/.exec(html)?.[1];
const sandbox = runInNewContext(`${block}; ({ hasBlocks, splitBlocks })`, {});
const hasBlocks = (t) => sandbox.hasBlocks(t);
const splitBlocks = (t) => [...sandbox.splitBlocks(t)]; // copied into this realm, so deepStrictEqual accepts it

test("hasBlocks: plain text and inline marks are not blocks; fences, lists, headings, quotes, tables and rules are", () => {
  for (const plain of ["Halo, apa kabar?", "Buka `index.html` lalu cek **tebal** dan *miring*.", "Lihat https://example.com/a-b dan 3 - 2 = 1", "satu\ndua\ntiga", "*miring* di awal", "2024-11-04 jam 10.30"]) {
    assert.equal(hasBlocks(plain), false, plain);
  }
  for (const block of ["```js\nlet a = 1;\n```", "~~~\nx\n~~~", "# Judul", "### Sub", "- satu\n- dua", "* satu", "1. satu\n2. dua", "2) dua", "> kutipan", "---", "***", "| a | b |\n|---|---|\n| 1 | 2 |", "intro\n\n- item"]) {
    assert.equal(hasBlocks(block), true, block);
  }
});

test("splitBlocks: one part per paragraph; blank lines inside a code fence do not split it; a loose list stays together", () => {
  assert.deepEqual(splitBlocks("satu\n\ndua\n\n\ntiga"), ["satu", "dua", "tiga"]);
  assert.deepEqual(splitBlocks("Ini kodenya:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nSelesai."), ["Ini kodenya:", "```js\nconst a = 1;\n\nconst b = 2;\n```", "Selesai."]);
  assert.deepEqual(splitBlocks("- a\n\n- b\n\n- c\n\nPenutup"), ["- a\n- b\n- c", "Penutup"]);
  assert.deepEqual(splitBlocks("1. a\n\n2. b"), ["1. a\n2. b"]);
  assert.deepEqual(splitBlocks("~~~\nx\n\ny\n~~~"), ["~~~\nx\n\ny\n~~~"]);
  assert.deepEqual(splitBlocks("```\nnever closed\n\nstill code"), ["```\nnever closed\n\nstill code"]); // an open fence swallows the rest
  assert.deepEqual(splitBlocks("a\r\n\r\nb"), ["a", "b"]);
  assert.deepEqual(splitBlocks("  \n\n"), []);
  assert.deepEqual(splitBlocks("Daftar:\n- a\n- b"), ["Daftar:\n- a\n- b"]); // no blank line: one part (rendered as a paragraph and a list)
});
