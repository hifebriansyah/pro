import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPersonas } from "../src/personas-fs.js";
import { parseTeamBody, runTeam, splitChanges } from "../src/team.js";

const personas = loadPersonas();
const noTest = async () => ({ ran: false, problems: [], passed: [] });
const HEAD = `<!doctype html><html><head><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body class="bg-white">`;
const TOP = `${HEAD}<header id="top"><h1 class="text-2xl">Bengkel Jaya</h1></header><section id="hero"><h2>Servis cepat</h2></section>`;
const BOTTOM = `<section id="harga"><h2>Harga</h2></section><form id="booking"><input name="nama"></form><footer><p>Bekasi</p></footer></body></html>`;
const DOC = (title, prompt) => `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>Catatan ${title}.</handoff>${/<verdict>approved<\/verdict> or/.test(prompt) ? "<verdict>approved</verdict>" : ""}`;

async function run(reply, opts = {}) {
  const prompts = [], events = [];
  const chatFn = async (prompt) => { prompts.push(prompt); const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?"; return { text: await reply(title, prompt, prompts) }; };
  const { provider = "quran", ...rest } = opts;
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page bengkel motor di Bekasi", playbook: "website", provider })), { send: (e) => events.push(e), chatFn, personas, skills: new Map(), testPage: noTest, ...rest });
  return { prompts, events, artifacts: (id) => events.filter((e) => e.type === "artifact" && e.id === id) };
}

test("a new page is written in two halves: the second sees the first and continues it; the result is one whole page", async () => {
  const { prompts, artifacts } = await run((title, prompt) => {
    if (title === "Halaman landing page") return /ONLY PART 1/.test(prompt) ? `<mockup title="Bengkel Jaya">${TOP}\n<!-- BAGIAN 2 -->` : `${BOTTOM}<handoff>Hero, harga, booking.</handoff>`;
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">document.addEventListener("DOMContentLoaded", () => {});</document><handoff>n.</handoff>`;
    return DOC(title, prompt);
  });
  const second = prompts.find((p) => /ONLY PART 2/.test(p));
  assert.ok(second.includes(`PART 1\n${TOP}`), "the second half is written seeing the first");
  const page = artifacts("page")[0];
  assert.equal(page.title, "Bengkel Jaya");
  assert.ok(page.content.startsWith(HEAD) && page.content.includes('<section id="hero">') && page.content.includes('<form id="booking">') && /<\/body>\s*<\/html>$/.test(page.content));
  assert.equal(page.note, "Hero, harga, booking.");
});

test("a second half that does not come leaves the first half, closed, with a note; a model that wrote the whole page again is taken whole", async () => {
  let r = await run((title, prompt) => {
    if (title === "Halaman landing page") { if (/ONLY PART 2/.test(prompt)) throw new Error("quran-gpt: HTTP 504"); return `<mockup title="B">${TOP}<!-- BAGIAN 2 -->`; }
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">const a = 1;</document>`;
    return DOC(title, prompt);
  });
  let page = r.artifacts("page")[0];
  assert.ok(page.content.includes('<section id="hero">') && /<\/body>\s*<\/html>$/.test(page.content));
  assert.match(page.note, /Bagian bawah halaman belum sempat ditulis/);
  const whole = TOP.replace("</body>", "") + BOTTOM;
  r = await run((title, prompt) => {
    if (title === "Halaman landing page") return /ONLY PART 2/.test(prompt) ? `${whole}<handoff>n.</handoff>` : `<mockup title="B">${TOP}<!-- BAGIAN 2 -->`;
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">const a = 1;</document>`;
    return DOC(title, prompt);
  });
  page = r.artifacts("page")[0];
  assert.equal((page.content.match(/<head>/g) || []).length, 1, "the head is not there twice");
  assert.ok(page.content.includes('<form id="booking">'));
});

test("QA's change list says who must fix what: [desain] lines go to the designer, [kode] and untagged ones to the engineer", () => {
  assert.deepEqual(splitChanges("- [desain] Hero terlalu polos, tambah gambar\n- [kode] Form tidak menampilkan pesan sukses\n3. Tombol menu error"), { design: "- Hero terlalu polos, tambah gambar", code: "- Form tidak menampilkan pesan sukses\n- Tombol menu error" });
  assert.deepEqual(splitChanges("- [UI] warna\n"), { design: "- warna", code: "" });
});

test("a design point from QA: the designer revises her page with edits, the engineer does his work again on the new page with QA's code points, QA checks again", async () => {
  let qa = 0;
  const { prompts, events, artifacts } = await run((title, prompt, all) => {
    if (title === "Halaman landing page") {
      if (/THE FILE YOU WORK ON: YOUR PREVIOUS VERSION/.test(prompt)) return `<change><find><h2>Servis cepat</h2></find><replace><h2>Servis cepat, harga jujur</h2></replace></change><handoff>Judul hero diperjelas.</handoff>`;
      return /ONLY PART 2/.test(prompt) ? `${BOTTOM}<handoff>n.</handoff>` : `<mockup title="B">${TOP}<!-- BAGIAN 2 -->`;
    }
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">document.addEventListener("DOMContentLoaded", () => { /* v${all.length} */ });</document><handoff>Skrip.</handoff>`;
    if (title === "Penilaian halaman") return qa++ === 0
      ? `<document title="QA">\n# QA\n${"isi ".repeat(300)}\n</document><handoff>n.</handoff><verdict>changes</verdict><changes>- [desain] Judul hero kurang jelas\n- [kode] Form booking tidak memberi konfirmasi</changes>`
      : `<document title="QA">\n# QA\n${"isi ".repeat(300)}\n</document><handoff>n.</handoff><verdict>approved</verdict>`;
    return DOC(title, prompt);
  });
  const qaAsk = prompts.find((p) => /YOUR TASK: Penilaian halaman/.test(p));
  assert.match(qaAsk, /\[desain\] for the look, layout, sections, copy or markup \(Kirana, the designer\), or \[kode\] for behaviour/);
  const designFix = prompts.find((p) => /THE FILE YOU WORK ON: YOUR PREVIOUS VERSION/.test(p));
  assert.match(designFix, /YOUR TASK: Halaman landing page[\s\S]*Judul hero kurang jelas/);
  assert.doesNotMatch(designFix, /Form booking tidak memberi konfirmasi/, "the code point is not hers");
  assert.match(designFix, /4\. No JavaScript: the behaviour is the engineer's work\./);
  const pages = artifacts("page");
  assert.equal(pages.length, 2);
  assert.equal(pages[1].revision, 1);
  assert.match(pages[1].content, /<h2>Servis cepat, harga jujur<\/h2>/, "her edit is in the page");
  assert.ok(pages[1].content.includes('<form id="booking">'), "the rest of her page is kept");
  const rebuild = prompts.filter((p) => /YOUR TASK: Halaman jadi dengan JavaScript/.test(p)).at(-1);
  assert.match(rebuild, /QA ALSO ASKED FOR THESE FIXES IN THE CODE[\s\S]*Form booking tidak memberi konfirmasi/);
  assert.match(rebuild, /Servis cepat, harga jujur/, "he works on her new page");
  const builds = artifacts("build");
  assert.equal(builds.length, 2);
  assert.match(builds[1].content, /Servis cepat, harga jujur/);
  const order = events.filter((e) => e.type === "handoff").map((e) => `${e.from}>${e.to}`);
  assert.ok(order.includes("qa>designer") && order.includes("designer>engineer") && order.includes("engineer>qa"));
  assert.equal(events.filter((e) => e.type === "review").at(-1).verdict, "approved");
  assert.equal(events.at(-1).type, "done");
});

test("a code-only point from QA goes straight back to the engineer, who changes his own file", async () => {
  let qa = 0;
  const { prompts, artifacts } = await run((title, prompt) => {
    if (title === "Halaman landing page") return /ONLY PART 2/.test(prompt) ? `${BOTTOM}<handoff>n.</handoff>` : `<mockup title="B">${TOP}<!-- BAGIAN 2 -->`;
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">document.addEventListener("DOMContentLoaded", () => {});</document><handoff>Skrip.</handoff>`;
    if (title === "Penilaian halaman") return qa++ === 0 ? `<document title="QA">x</document><verdict>changes</verdict><changes>- [kode] Form booking tidak memberi konfirmasi</changes>` : `<document title="QA">x</document><verdict>approved</verdict>`;
    return DOC(title, prompt);
  });
  assert.equal(artifacts("page").length, 1, "the designer is not involved");
  assert.ok(prompts.some((p) => /YOUR PREVIOUS VERSION OF THE FILE[\s\S]*REVIEW FEEDBACK from Sinta[\s\S]*Form booking tidak memberi konfirmasi/.test(p)));
});

test("QA labels for content, layout or accessibility go to the designer too", () => {
  assert.deepEqual(splitChanges("- [testimoni] Verifikasi keaslian testimoni\n- [aksesibilitas] Kontras tombol kurang\n- [kode] Link #contact rusak"), { design: "- Verifikasi keaslian testimoni\n- Kontras tombol kurang", code: "- Link #contact rusak" });
});

test("DeepSeek and Qwen (no one-minute limit): the page is written in one go, with no size cap, and the steps see more of the earlier work", async () => {
  const { prompts, artifacts } = await run((title, prompt) => {
    if (title === "Halaman landing page") return `<mockup title="Bengkel Jaya">${TOP}${BOTTOM}</mockup><handoff>Satu kali tulis.</handoff>`;
    if (title === "Halaman jadi dengan JavaScript") return `<document title="script.js">document.addEventListener("DOMContentLoaded", () => {});</document><handoff>n.</handoff>`;
    return DOC(title, prompt);
  }, { provider: "deepseek" });
  assert.ok(!prompts.some((p) => /ONLY PART [12]/.test(p)), "no halves");
  const pagePrompt = prompts.find((p) => /YOUR TASK: Halaman landing page/.test(p));
  assert.doesNotMatch(pagePrompt, /about one minute/);
  const page = artifacts("page")[0];
  assert.ok(page.content.includes('<section id="hero">') && page.content.includes('<form id="booking">'));
  assert.equal(page.note, "Satu kali tulis.");

  const quran = await run((title, prompt) => /ONLY PART 1/.test(prompt) ? `<mockup title="B">${TOP}<!-- BAGIAN 2 -->` : /ONLY PART 2/.test(prompt) ? `${BOTTOM}<handoff>n.</handoff>` : DOC(title, prompt));
  assert.match(quran.prompts.find((p) => /ONLY PART 1/.test(p)), /about one minute/, "the free sources keep the cap");
});
