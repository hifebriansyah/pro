import assert from "node:assert/strict";
import { test } from "node:test";
import { testPage } from "../src/pagetest.js";
import { loadPersonas } from "../src/personas-fs.js";
import { parseTeamBody, runTeam } from "../src/team.js";

const page = ({ head = "", body = "", script = "" } = {}) => `<!doctype html><html><head>${head}</head><body>${body}<script>${script}</script></body></html>`;

const GOOD_BODY = `<header><nav><span>Toko</span><button id="menu-btn" aria-expanded="false" aria-label="Menu"><i data-lucide="menu"></i></button><ul id="menu-links" class="hidden"><li><a href="#harga">Harga</a></li></ul></nav></header>
<main><section id="harga"><h2>Harga</h2><button id="more">Lihat semua</button></section>
<form id="kontak"><input id="nama" name="nama" required><input id="email" type="email" name="email" required><p id="status"></p><button type="submit">Kirim</button></form></main>`;
const GOOD_SCRIPT = `document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("menu-btn"), links = document.getElementById("menu-links");
  btn.addEventListener("click", () => { const open = links.classList.toggle("hidden") === false; btn.setAttribute("aria-expanded", String(open)); });
  document.addEventListener("click", (e) => { if (!btn.contains(e.target) && !links.contains(e.target)) { links.classList.add("hidden"); btn.setAttribute("aria-expanded", "false"); } });
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => { const t = a.getAttribute("href").length > 1 && document.querySelector(a.getAttribute("href")); if (t) { e.preventDefault(); t.scrollIntoView({ behavior: "smooth" }); } }));
  document.getElementById("more").addEventListener("click", () => document.getElementById("harga").insertAdjacentHTML("beforeend", "<p>Paket lengkap</p>"));
  const form = document.getElementById("kontak"), status = document.getElementById("status");
  form.addEventListener("submit", (e) => { e.preventDefault(); const n = form.nama.value.trim(), m = form.email.value.trim();
    status.textContent = !n ? "Nama wajib diisi." : !/\\S+@\\S+\\.\\S+/.test(m) ? "Email tidak valid." : "Terima kasih, pesanmu terkirim."; if (n && m) form.reset(); });
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {}
  new IntersectionObserver(() => {}).observe(document.body);
  if (window.lucide) lucide.createIcons();
});`;

test("a page that works passes: the menu opens, buttons and links click without errors, the form rejects an empty submit and confirms a good one", async () => {
  const r = await testPage(page({ body: GOOD_BODY, script: GOOD_SCRIPT }));
  assert.equal(r.ran, true);
  assert.deepEqual(r.problems, []);
  assert.ok(r.passed.includes("the scripts run without errors on load"));
  assert.ok(r.passed.includes("the menu button opens the menu"));
  assert.ok(r.passed.some((p) => /form#kontak rejects an empty submit and confirms a correct one/.test(p)));
  assert.ok(r.steps >= 5);
});

test("the bugs a visitor would hit are found: a menu that hides itself, a '#' link that throws, a link to a missing section, an error on load", async () => {
  const body = `<header><nav id="top"><span>Toko</span><button id="menu-button" aria-expanded="false">Menu</button></nav></header><main><a href="#">Detail</a><a href="#hilang">Ke bagian</a></main>`;
  const script = `document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("menu-button"), nav = document.querySelector("nav");
    b.addEventListener("click", () => nav.classList.toggle("hidden"));
    document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.querySelector(a.getAttribute("href")).scrollIntoView(); }));
  });`;
  const r = await testPage(page({ body, script }));
  const all = r.problems.join("\n");
  assert.match(all, /menu button button#menu-button "Menu" hides the button itself \(it hides nav#top/);
  assert.match(all, /clicking a "Detail" \(href="#"\) throws: .*not a valid selector/);
  assert.match(all, /points to #hilang, which is not on the page/);
  const broken = await testPage(page({ body: "<h1>Halo</h1>", script: "document.getElementById('tidak-ada').addEventListener('click', () => {});" }));
  assert.match(broken.problems[0], /throws an error as soon as it loads/);
});

test("forms: one the script does not handle, and one that shows nothing for an empty submit, are reported", async () => {
  const unhandled = await testPage(page({ body: '<form id="f"><input name="a"><button type="submit">Kirim</button></form>', script: "const x = 1;" }));
  assert.match(unhandled.problems.join("\n"), /form#f is not handled by the script/);
  const silent = await testPage(page({ body: '<form id="g"><input name="a"><p id="s"></p></form>', script: `document.getElementById("g").addEventListener("submit", (e) => { e.preventDefault(); if (e.target.a.value) document.getElementById("s").textContent = "Terkirim"; });` }));
  assert.match(silent.problems.join("\n"), /submitting form#g empty shows no message/);
  assert.doesNotMatch(silent.problems.join("\n"), /filled in correctly shows no confirmation/, "the filled-in submit does confirm");
});

test("libraries from the internet are stood in for: a three.js scene, Tailwind's config and Lucide run without errors and without the network", async () => {
  const script = `tailwind.config = { theme: { extend: { colors: { primary: "#f26b4e" } } } };
  document.addEventListener("DOMContentLoaded", () => {
    const host = document.getElementById("scene");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, host.clientWidth / (host.clientHeight || 1), 0.1, 100);
    camera.position.set(0, 0, 6);
    const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.3, 100, 16), new THREE.MeshStandardMaterial({ color: new THREE.Color("#f26b4e") }));
    scene.add(mesh, new THREE.AmbientLight(0xffffff, 0.6));
    const frame = (t) => { mesh.rotation.y = t / 1000; renderer.render(scene, camera); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new ResizeObserver(() => {}).observe(host);
    lucide.createIcons();
    gsap.to("#scene", { opacity: 1 });
  });`;
  const r = await testPage(page({ head: '<script src="https://cdn.tailwindcss.com/3.4.17"></script>', body: '<div id="scene" style="height:300px"></div><i data-lucide="star"></i>', script }));
  assert.equal(r.ran, true);
  assert.deepEqual(r.problems, []);
});

test("in a project: a bug the test run finds goes back to the engineer, his fix is tested again, and QA receives the test report", async () => {
  const designer = `<!doctype html><html><head></head><body>${GOOD_BODY}${"<p>isi halaman</p>".repeat(400)}</body></html>`;
  const buggy = GOOD_SCRIPT.replace('links.classList.toggle("hidden") === false', 'btn.parentElement.classList.toggle("hidden") === false');
  const prompts = [], events = [];
  const chatFn = async (prompt) => {
    prompts.push(prompt);
    const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
    if (title === "Halaman jadi dengan JavaScript") return { text: `<document title="script.js">${/DOES NOT WORK YET/.test(prompt) ? GOOD_SCRIPT : buggy}</document><handoff>Menu, tautan dan form.</handoff>` };
    if (title === "Halaman landing page") return { text: `<mockup title="Halaman">${designer}</mockup><handoff>n.</handoff>` };
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    return { text: `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>n.</handoff>${gate ? "<verdict>approved</verdict>" : ""}` };
  };
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page untuk toko kucing", playbook: "website", provider: "quran" })), { send: (e) => events.push(e), chatFn, personas: loadPersonas(), skills: new Map() });
  const fix = prompts.find((p) => /DOES NOT WORK YET/.test(p));
  assert.ok(fix, "the engineer was sent back");
  assert.match(fix, /test run \(the page loaded and clicked through like a visitor would\)[\s\S]*hides the button itself/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.deepEqual(build.test.problems, [], "his fix passed the test run");
  assert.ok(build.test.passed.includes("the menu button opens the menu"));
  const qa = prompts.find((p) => /YOUR TASK: Penilaian halaman/.test(p));
  assert.match(qa, /TEST RUN \(the page was loaded and used like a visitor would[\s\S]*- passed: the menu button opens the menu/);
  assert.equal(events.at(-1).type, "done");
});

test("in a project: a broken link in the markup can be fixed in the engineer's fix round, with a markup change next to his script", async () => {
  const designer = `<!doctype html><html><head></head><body>${GOOD_BODY.replace('href="#harga"', 'href="#prices"')}${"<p>isi halaman</p>".repeat(400)}</body></html>`;
  const prompts = [], events = [];
  const chatFn = async (prompt) => {
    prompts.push(prompt);
    const title = /YOUR TASK: (.+)/.exec(prompt)?.[1] ?? "?";
    if (title === "Halaman jadi dengan JavaScript") return { text: /DOES NOT WORK YET/.test(prompt) ? `<change><find>href="#prices"</find><replace>href="#harga"</replace></change><document title="script.js">${GOOD_SCRIPT}</document><handoff>Tautan diperbaiki.</handoff>` : `<document title="script.js">${GOOD_SCRIPT}</document><handoff>n.</handoff>` };
    if (title === "Halaman landing page") return { text: /ONLY PART 2/.test(prompt) ? "</body></html>" : `<mockup title="H">${designer.replace("</body></html>", "")}<!-- BAGIAN 2 -->` };
    const gate = /<verdict>approved<\/verdict> or/.test(prompt);
    return { text: `<document title="${title}">\n# ${title}\n${"isi ".repeat(700)}\n</document><handoff>n.</handoff>${gate ? "<verdict>approved</verdict>" : ""}` };
  };
  await runTeam(parseTeamBody(JSON.stringify({ goal: "Landing page untuk toko kucing", playbook: "website", provider: "quran" })), { send: (e) => events.push(e), chatFn, personas: loadPersonas(), skills: new Map() });
  assert.match(prompts.find((p) => /DOES NOT WORK YET/.test(p)), /points to #prices, which is not on the page/);
  const build = events.find((e) => e.type === "artifact" && e.id === "build");
  assert.match(build.content, /href="#harga"/);
  assert.deepEqual(build.test.problems, []);
});
