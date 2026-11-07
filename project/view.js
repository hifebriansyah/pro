// The project screen: start a team project (a goal and a playbook), watch it run step by step, open each deliverable, and stop, continue or redo.
// It draws into `host` with plain DOM nodes (never innerHTML for text that came from a model) and talks to the page through `deps`.
//   deps: { el, agentOf, paintAvatar, openDoc, closeDoc, openChat(id), proxy, getProvider(), setProvider(v), storage,
//           team: { busy(agentId, text|null), visit(from, to) }  (what the office shows), download(filename, text) }
import { PLAYBOOKS, suggestPlaybook } from "../src/playbooks.js";
import { ROSTER } from "../src/roster.js";
import { applyEvent, bundleMarkdown, load, newProject, nextAction, primaryArtifact, progress, runBody, save } from "./state.js";

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICON = {
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  stop: svg('<rect width="14" height="14" x="5" y="5" rx="2"/>'),
  pencil: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'),
  retry: svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  back: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
  arrow: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  layout: svg('<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/>'),
  sparkles: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'),
  globe: svg('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
};
const STATUS = { draft: "Belum dimulai", running: "Berjalan", paused: "Dijeda", failed: "Perlu dicoba lagi", done: "Selesai" };
const EXAMPLES = ["Landing page untuk jasa pembuatan website dengan form kontak dan daftar harga", "Aplikasi absensi karyawan untuk pabrik dengan 200 pekerja, bisa dipakai di ponsel", "Kampanye Instagram untuk membuka toko kopi baru di Cianjur", "Fitur reservasi meja untuk jaringan restoran"];
const TIMES = { quran: "sekitar 1 sampai 2 menit", islam: "sekitar 5 sampai 10 menit (sumber ini lebih lambat)" };
const SIZE = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} rb karakter` : `${n} karakter`);
const WHEN = (t) => new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function createProjectView({ host, deps }) {
  const { el, agentOf, paintAvatar } = deps;
  const icon = (name, cls) => { const s = el("span", cls ?? "pj-ico"); s.innerHTML = ICON[name]; return s; }; // constant markup
  const projects = load(deps.storage);
  let currentId = null;
  let running = null;                 // { id, ac, stopped }
  const ui = { goal: "", pick: null, edit: null, open: new Set(), error: "" }; // what the screen remembers between redraws
  let saveTimer = 0, drawTimer = 0;

  const by = (id) => projects.find((p) => p.id === id) ?? null;
  const persist = (now = false) => { clearTimeout(saveTimer); const go = () => { const kept = save(deps.storage, projects); projects.length = 0; projects.push(...kept); }; if (now) go(); else saveTimer = setTimeout(go, 1500); };
  const draw = () => { clearTimeout(drawTimer); drawTimer = setTimeout(render, 60); };
  const live = el("div", "pj-live"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); // read aloud by screen readers, not shown
  const say = (text) => { live.textContent = text; };

  // ---- running a project
  async function run(p, opts = {}, auto = 0) {
    if (running) return;
    const ac = new AbortController();
    running = { id: p.id, ac, stopped: false };
    p.status = "running"; p.pause = null; p.error = null; ui.error = "";
    engage(p); // everybody in this project is at work in the office until it is done
    persist(true); render();
    try {
      const res = await fetch(`${deps.proxy}/team`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runBody(p, opts)), signal: ac.signal });
      if (!res.ok) {
        const msg = res.status === 429 ? "Terlalu banyak proyek dalam semenit. Coba lagi sebentar lagi." : res.status === 503 ? "Proyek tim belum tersedia di server ini." : res.status === 404 ? "Server ini belum mendukung proyek tim." : (await res.json().catch(() => ({}))).error ?? `Server menjawab ${res.status}.`;
        throw Object.assign(new Error(msg), { fatal: true });
      }
      await readEvents(res, (ev) => { applyEvent(p, ev); effects(p, ev); persist(); draw(); });
    } catch (e) {
      if (running?.stopped) { p.status = "paused"; p.pause = { reason: "stopped", next: null }; }
      else { p.error = e.fatal ? e.message : "Tidak bisa menghubungi server. Proyek bisa dilanjutkan."; p.status = p.status === "running" ? "paused" : p.status; p.pause ??= { reason: "error", next: null }; }
    } finally {
      const stopped = running?.stopped;
      const again = !stopped && ["time", "calls"].includes(p.pause?.reason) && auto < 5; // a run that goes on by itself keeps the team at their desks
      if (!again) release(p);
      for (const st of Object.values(p.steps)) if (st.status === "running") st.status = "pending";
      running = null;
      if (p.status === "running") p.status = "paused";
      persist(true); render();
      // out of time or calls: the project simply goes on (a few times), unless the visitor stopped it
      if (!stopped && p.status === "paused" && ["time", "calls"].includes(p.pause?.reason) && auto < 5 && currentId !== "__gone") setTimeout(() => { if (!running && p.status === "paused") run(p, {}, auto + 1); }, 2000);
    }
  }
  const people = (p) => [...new Set(p.plan.map((s) => s.agent))];
  const engage = (p) => { for (const a of people(p)) deps.team.busy(a, `mengerjakan proyek "${p.title}"`); };
  const release = (p) => { for (const a of people(p)) deps.team.busy(a, null); };
  /** What a run's events do outside this screen: the office (who is working, who hands over to whom) and the screen reader. */
  function effects(p, ev) {
    const s = ev.id ? p.plan.find((x) => x.id === ev.id) : null;
    if (ev.type === "step" && ev.phase === "start" && s) { deps.team.busy(s.agent, `menulis ${s.title}…`); say(`${agentOf(s.agent).name} mulai menulis ${s.title}.`); }
    else if (ev.type === "step" && ev.phase === "end" && s) { deps.team.busy(s.agent, `mengerjakan proyek "${p.title}"`); if (ev.status === "failed") say(`${s.title} gagal.`); }
    else if (ev.type === "artifact" && s) say(`${s.title} selesai.`);
    else if (ev.type === "handoff") deps.team.visit(ev.from, ev.to);
    else if (ev.type === "done") { say("Proyek selesai."); const main = primaryArtifact(p); if (main && currentId === p.id) showArtifact(main); autoPublish(p, main); } // the result itself opens by itself
    else if (ev.type === "paused") say(ev.reason === "failed" ? "Proyek berhenti karena satu langkah gagal." : "Proyek dijeda.");
  }
  async function readEvents(res, onEvent) {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const blocks = buf.split(/\r?\n\r?\n/);
      buf = blocks.pop();
      for (const b of blocks) { const line = b.split("\n").find((l) => l.startsWith("data:")); if (!line) continue; try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* a line that is not an event */ } }
    }
  }
  const showArtifact = (a) => deps.openDoc(a.kind === "mockup" ? { kind: "mockup", title: a.title, html: a.content } : { kind: "doc", title: a.title, markdown: a.content });
  const saveArtifact = (a, p) => (a.kind === "mockup" ? deps.download(`${slug(a.title || p.title)}.html`, a.content, "text/html") : deps.download(`${slug(a.title || p.title)}.md`, a.content, "text/markdown"));
  const stop = () => { if (running) { running.stopped = true; running.ac.abort(); } };

  // ---- the start screen
  function startView() {
    const wrap = el("div", "pj-start");
    const hero = el("div", "pj-hero");
    hero.append(el("h2", null, "Proyek tim"), el("p", null, "Beri satu tujuan. Tim bekerja bergiliran, saling menyerahkan hasil dan saling menilai, lalu kamu menerima berkas yang siap dipakai."));
    const label = el("label", "pj-label", "Apa yang ingin dikerjakan tim?"); label.htmlFor = "pj-goal";
    const goal = el("textarea", "pj-goal"); goal.id = "pj-goal"; goal.rows = 3; goal.maxLength = 2000; goal.value = ui.goal; goal.placeholder = "Contoh: aplikasi absensi karyawan untuk pabrik dengan 200 pekerja";
    const chips = el("div", "pj-examples");
    for (const ex of EXAMPLES) { const c = el("button", "pj-chip", ex); c.type = "button"; c.onclick = () => { goal.value = ui.goal = ex; ui.pick = null; goal.focus(); sync(); }; chips.append(c); }

    const books = el("fieldset", "pj-books"); books.append(el("legend", null, "Cara kerja tim"));
    const cards = {};
    for (const pb of Object.values(PLAYBOOKS)) {
      const card = el("label", "pj-book"); const radio = el("input"); radio.type = "radio"; radio.name = "pj-book"; radio.value = pb.id;
      radio.onchange = () => { ui.pick = pb.id; sync(); };
      const faces = el("span", "pj-faces");
      for (const id of [...new Set(pb.steps.map((s) => s.agent))]) { const a = el("span", "pj-face"); paintAvatar(a, agentOf(id)); a.title = `${agentOf(id).name}, ${ROSTER.find((r) => r.id === id).role}`; faces.append(a); }
      const t = el("span", "pj-book-text"); t.append(el("b", null, pb.title), el("span", null, pb.about));
      const meta = el("span", "pj-book-meta"); meta.append(`${pb.steps.length} langkah`);
      card.append(radio, faces, t, meta); books.append(card); cards[pb.id] = { card, radio };
    }
    const go = el("button", "pj-primary"); go.type = "button"; go.append(icon("sparkles"), el("span", null, "Mulai proyek"));
    const hint = el("p", "pj-hint");
    const sync = () => {
      ui.goal = goal.value;
      const chosen = ui.pick ?? suggestPlaybook(goal.value);
      for (const [id, c] of Object.entries(cards)) { c.radio.checked = id === chosen; c.card.classList.toggle("on", id === chosen); }
      const ok = goal.value.trim().length >= 5;
      go.disabled = !ok;
      hint.textContent = `Sumber jawaban: ${deps.getProvider() === "quran" ? "quran-gpt" : "islam-gpt"}, ${TIMES[deps.getProvider()]}. Hasil tersimpan di peramban ini.`;
    };
    goal.oninput = sync;
    goal.onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !go.disabled) go.click(); };
    go.onclick = () => {
      const p = newProject({ goal: goal.value, playbook: ui.pick ?? suggestPlaybook(goal.value), provider: deps.getProvider() });
      projects.unshift(p); currentId = p.id; ui.goal = ""; ui.pick = null; persist(true); run(p);
    };
    const actions = el("div", "pj-actions"); actions.append(go, hint);
    wrap.append(hero, label, goal, chips, books, actions);
    if (ui.error) wrap.append(errorBox(ui.error));
    if (projects.length) wrap.append(recent());
    sync();
    return wrap;
  }
  function recent() {
    const sec = el("section", "pj-recent"); sec.append(el("h3", null, "Proyek sebelumnya"));
    const list = el("ul", "pj-recent-list");
    for (const p of projects) {
      const { done, total } = progress(p);
      const li = el("li"); const open = el("button", "pj-recent-item"); open.type = "button";
      const top = el("span", "pj-recent-top"); top.append(el("b", null, p.title), chip(p.status));
      open.append(top, el("span", "pj-recent-meta", `${PLAYBOOKS[p.playbook]?.title ?? p.playbook} · ${done}/${total} langkah · ${WHEN(p.updatedAt)}`));
      open.onclick = () => { currentId = p.id; render(); host.scrollTop = 0; };
      const del = el("button", "pj-iconbtn"); del.type = "button"; del.title = "Hapus proyek"; del.setAttribute("aria-label", `Hapus proyek ${p.title}`); del.append(icon("trash"));
      del.onclick = () => { if (running?.id === p.id || !confirm(`Hapus proyek "${p.title}"?`)) return; projects.splice(projects.indexOf(p), 1); persist(true); render(); };
      li.append(open, del); list.append(li);
    }
    sec.append(list);
    return sec;
  }
  const chip = (status) => { const c = el("span", "pj-chip-state", STATUS[status] ?? status); c.dataset.state = status; return c; };
  const errorBox = (text) => { const b = el("div", "pj-error"); b.setAttribute("role", "alert"); b.append(icon("alert"), el("span", null, text)); return b; };

  // ---- the run screen
  function runView(p) {
    const wrap = el("div", "pj-run");
    const { done, total } = progress(p);
    const head = el("header", "pj-head");
    const back = button("Kembali", "back", "pj-btn pj-back", () => api.newProject()); // to the list of projects: the route goes back to #proyek
    const title = el("div", "pj-title"); title.append(el("h2", null, p.title), el("p", null, p.goal));
    const status = el("div", "pj-status");
    const bar = el("div", "pj-bar"); const fill = el("i"); fill.style.width = `${Math.round((done / total) * 100)}%`; bar.append(fill);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(total)); bar.setAttribute("aria-valuenow", String(done)); bar.setAttribute("aria-label", "Kemajuan proyek");
    status.append(chip(p.status), bar, el("span", "pj-count", `${done} dari ${total} langkah`));
    const ctl = el("div", "pj-ctl");
    const act = nextAction(p), busyHere = running?.id === p.id;
    if (act === "stop" && busyHere) ctl.append(button("Hentikan", "stop", "pj-btn", stop));
    else if (act === "continue") ctl.append(button("Lanjutkan", "play", "pj-btn primary", () => run(p)));
    else if (act === "retry") ctl.append(button("Coba lagi", "retry", "pj-btn primary", () => run(p)));
    if (done) ctl.append(button("Unduh semua", "download", "pj-btn", () => deps.download(`${slug(p.title)}.md`, bundleMarkdown(p, Object.fromEntries(p.plan.map((s) => [s.agent, agentOf(s.agent).name]))), "text/markdown")));
    head.append(back, title, status, ctl);
    wrap.append(head);
    if (p.error) wrap.append(errorBox(p.error));
    if (p.status === "paused" && p.pause?.reason === "stopped") wrap.append(note("Proyek dijeda. Hasil yang sudah selesai tetap tersimpan."));
    if (p.status === "paused" && ["time", "calls"].includes(p.pause?.reason) && busyHere === false && running) wrap.append(note("Melanjutkan otomatis…"));

    const ol = el("ol", "pj-steps");
    p.plan.forEach((s, i) => ol.append(stepCard(p, s, i)));
    wrap.append(ol);
    if (p.status === "done") wrap.append(finish(p));
    return wrap;
  }
  const button = (label, ic, cls, onclick) => { const b = el("button", cls); b.type = "button"; b.append(icon(ic), el("span", null, label)); b.onclick = onclick; return b; };
  const note = (text) => el("p", "pj-note", text);
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "proyek";

  function stepCard(p, s, index) {
    const st = p.steps[s.id] ?? { status: "pending" }, a = p.artifacts[s.id], rv = p.reviews[s.id];
    const ag = agentOf(s.agent), role = ROSTER.find((r) => r.id === s.agent)?.role ?? "";
    const li = el("li", "pj-step"); li.dataset.state = st.status;
    const rail = el("div", "pj-rail");
    const face = el("button", "pj-avatar"); face.type = "button"; face.title = `Obrolan dengan ${ag.name}`; face.setAttribute("aria-label", `Buka obrolan dengan ${ag.name}`);
    const av = el("span", "pj-av"); paintAvatar(av, ag); face.append(av);
    const glyph = st.status === "done" ? ICON.check : st.status === "failed" ? ICON.x : ""; // one of two constant icons, chosen by the step's state
    const mark = el("span", "pj-mark"); mark.innerHTML = glyph;
    face.append(mark); face.onclick = () => deps.openChat(s.agent);
    rail.append(face);
    const card = el("div", "pj-card");
    const top = el("div", "pj-card-top");
    top.append(el("b", null, `${index + 1}. ${s.title}`), el("span", "pj-who", `${ag.name} · ${role}`));
    if (s.id === p.primary) top.append(el("span", "pj-main", "Hasil utama"));
    const line = el("p", "pj-line");
    line.textContent = st.status === "running" ? `sedang menulis…${st.attempt > 1 ? " (percobaan ke-" + st.attempt + ")" : ""}${st.revision ? " (revisi)" : ""}`
      : st.status === "failed" ? `gagal: ${st.error ?? "tidak diketahui"}` : st.status === "done" ? "selesai" : "menunggu giliran";
    card.append(top, line);
    if (a) {
      const open = el("button", "pj-art"); open.type = "button";
      open.append(icon(a.kind === "mockup" ? "layout" : "file"));
      const t = el("span", "pj-art-text"); t.append(el("b", null, a.title), el("span", null, `${a.kind === "mockup" ? "Mockup" : "Dokumen"} · ${SIZE(a.content.length)}${a.revision ? " · revisi 1" : ""}`));
      open.append(t, el("span", "pj-art-open", "Buka"));
      open.onclick = () => showArtifact(a);
      card.append(open);
      if (a.note) { const n = el("p", "pj-handoff"); n.append(el("span", "pj-handoff-label", "Catatan serah-terima"), document.createTextNode(a.note)); card.append(n); }
    }
    if (rv) {
      const r = el("div", "pj-review"); r.dataset.verdict = rv.verdict;
      const who = agentOf(rv.by).name;
      r.append(el("b", null, rv.verdict === "approved" ? `Disetujui oleh ${who}` : rv.final ? `${who} masih mencatat perbaikan` : `${who} meminta perbaikan`));
      if (rv.changes) r.append(el("span", null, rv.changes.replace(/^\s*[-*]\s*/gm, "• ").trim()));
      card.append(r);
    }
    const next = p.plan[index + 1];
    const sent = [...p.feed].reverse().find((f) => f.type === "handoff" && f.from === s.agent && next && f.to === next.agent);
    if (sent && st.status === "done") { const h = el("p", "pj-to"); h.append(icon("arrow"), el("span", null, `Diserahkan ke ${agentOf(sent.to).name}`)); card.append(h); }
    if ((st.status === "done" || st.status === "failed") && !running) {
      const row = el("div", "pj-step-actions");
      if (st.status === "failed") row.append(button("Coba lagi", "retry", "pj-link", () => run(p)));
      else row.append(button("Minta perubahan", "pencil", "pj-link", () => { ui.edit = { id: s.id, text: "" }; render(); }));
      if (a && st.status === "done") row.append(button(a.kind === "mockup" ? "Unduh .html" : "Unduh .md", "download", "pj-link", () => saveArtifact(a, p)));
      card.append(row);
    }
    if (ui.edit?.id === s.id && p.id === currentId) {
      const box = el("div", "pj-edit"); const ta = el("textarea"); ta.rows = 3; ta.value = ui.edit.text; ta.placeholder = `Apa yang perlu diubah ${ag.name}?`; ta.setAttribute("aria-label", "Permintaan perubahan");
      ta.oninput = () => (ui.edit.text = ta.value);
      const send = button("Kirim", "play", "pj-btn primary", () => { const text = ui.edit.text.trim(); if (text.length < 3) { ta.focus(); return; } ui.edit = null; run(p, { only: s.id, feedback: text }); });
      const cancel = button("Batal", "x", "pj-btn", () => { ui.edit = null; render(); });
      box.append(ta, el("div", "pj-edit-row")); box.lastChild.append(send, cancel); card.append(box);
      queueMicrotask(() => ta.focus());
    }
    li.append(rail, card);
    return li;
  }
  // "Terbitkan": the page goes to a public link. One project, one folder: publishing again (after a revision) replaces the page at the same link.
  const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function callPublish(path, body) {
    const res = await fetch(`${deps.proxy}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) throw new Error(data.error || "layanan penerbitan tidak bisa dihubungi, coba lagi");
    return data;
  }
  /** The devops colleague puts the finished page online by himself: first time, or again after a revision (the same folder, the same link).
   *  The visitor can take it down; then it stays down until they ask for it again. */
  const publishing = new Set(); // projects being published right now (so the screen never says "publishing" for something nobody is doing)
  async function autoPublish(p, main) {
    if (!main || main.kind !== "mockup" || p.takenDown || publishing.has(p.id)) return;
    publishing.add(p.id);
    try { await autoPublishNow(p, main); } finally { publishing.delete(p.id); }
  }
  async function autoPublishNow(p, main) {
    if (p.published && p.published.size === main.content.length) return; // nothing new to put online
    const devops = p.plan.find((x) => x.agent === "devops")?.agent ?? "devops";
    deps.team.busy(devops, "menerbitkan halaman…"); say("Devops menerbitkan halaman."); p.publishError = null; render();
    try { await publish(p, main); say("Halaman sudah terbit."); }
    catch (e) { p.publishError = e.message; }
    deps.team.busy(devops, null); persist(true); render();
  }
  async function publish(p, main) {
    const pub = p.published, token = pub?.token ?? randomToken();
    const r = await callPublish("publish", { id: pub?.id, token, html: main.content });
    p.published = { id: r.id, token, url: r.url, at: Date.now(), size: main.content.length }; p.takenDown = false; p.publishError = null;
    persist(true);
  }
  function publishRow(p, main) {
    const row = el("div", "pj-publish");
    const pub = p.published;
    const msg = el("p", "pj-hint", p.publishError ?? "");
    const run = async (b, label, work) => { b.disabled = true; msg.textContent = label; try { await work(); } catch (e) { msg.textContent = e.message; } b.disabled = false; };
    const again = () => { const b = button(p.takenDown ? "Terbitkan lagi" : "Coba terbitkan lagi", "globe", "pj-btn", () => run(b, "Menerbitkan…", async () => { await publish(p, main); render(); })); return b; };
    if (!pub) {
      if (p.takenDown || p.publishError) row.append(again());
      else if (publishing.has(p.id)) row.append(el("span", "pj-hint", "Devops sedang menerbitkan halaman ini…"));
      else row.append(again());
    } else {
      const a = el("a", "pj-link", pub.url); a.href = pub.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      const copy = button("Salin tautan", "copy", "pj-btn", async () => { try { await navigator.clipboard.writeText(pub.url); msg.textContent = "Tautan disalin."; } catch { msg.textContent = pub.url; } });
      const del = button("Turunkan", "trash", "pj-btn", () => run(del, "Menurunkan…", async () => { await callPublish("unpublish", { id: pub.id, token: pub.token }); delete p.published; p.takenDown = true; persist(true); render(); }));
      row.append(el("span", "pj-hint", "Sudah terbit oleh Devops. Kalau kamu minta revisi, terbitan ini ikut diperbarui di tautan yang sama. Hilang sendiri 30 hari setelah terbitan terakhir."), a);
      const ctl = el("div", "pj-ctl"); ctl.append(copy, del); row.append(ctl);
      if (pub.size !== main.content.length) row.append(again());
    }
    row.append(msg);
    return row;
  }
  function finish(p) {
    const box = el("section", "pj-finish");
    const main = primaryArtifact(p);
    if (main) {
      box.append(el("h3", null, main.kind === "mockup" ? "Halamanmu sudah jadi" : "Hasil utama sudah jadi"), el("p", null, `${main.title}. Buka untuk melihat hasilnya, atau unduh berkasnya. Berkas pendukung (brief, naskah, penilaian, peluncuran) ada di langkah-langkah di atas.`));
      const first = el("div", "pj-ctl");
      first.append(button(main.kind === "mockup" ? "Buka halaman" : "Buka dokumen", main.kind === "mockup" ? "layout" : "file", "pj-btn primary", () => showArtifact(main)), button(main.kind === "mockup" ? "Unduh .html" : "Unduh .md", "download", "pj-btn", () => saveArtifact(main, p)));
      box.append(first);
      if (main.kind === "mockup") box.append(publishRow(p, main));
    } else box.append(el("h3", null, "Proyek selesai"), el("p", null, `${p.plan.length} berkas siap: ${p.plan.map((s) => s.title).join(", ")}.`));
    const row = el("div", "pj-ctl pj-ctl-more");
    row.append(button("Unduh semua (.md)", "download", main ? "pj-btn" : "pj-btn primary", () => deps.download(`${slug(p.title)}.md`, bundleMarkdown(p, Object.fromEntries(p.plan.map((s) => [s.agent, agentOf(s.agent).name]))), "text/markdown")), button("Proyek baru", "sparkles", "pj-btn", () => api.newProject()));
    box.append(row);
    return box;
  }

  function render() {
    const keep = host.scrollTop;
    const p = currentId ? by(currentId) : null;
    host.replaceChildren(p ? runView(p) : startView(), live);
    host.scrollTop = keep;
    api.onChange?.(p);
    // a finished project that was never published (the page was closed while Devops was at it): Devops does it now
    if (p?.status === "done" && !p.published && !p.takenDown && !p.publishError && !running) { const main = primaryArtifact(p); if (main?.kind === "mockup") autoPublish(p, main); }
    deps.route?.(p ? p.id : null); // the address follows the screen: #proyek/<id> for a project, #proyek for the start screen
  }

  // a project that was running when the page was refreshed goes on by itself (one at a time: the first one found)
  const cut = projects.filter((p) => p.resume);
  for (const p of projects) delete p.resume;
  if (cut[0]) queueMicrotask(() => { if (!running && cut[0].status === "paused") run(cut[0]); });

  const api = {
    render, stop, get running() { return !!running; }, get current() { return currentId ? by(currentId) : null; }, onChange: null,
    newProject() { currentId = null; render(); host.scrollTop = 0; },
    /** Open the screen; an id from the address opens that project (an unknown one the start screen), no id keeps what was open. */
    show(id) { if (id !== undefined) currentId = id && by(id) ? id : null; render(); },
    /** A project that is running somewhere else in the app (e.g. started from the chat) could be opened here. */
    open(id) { if (by(id)) { currentId = id; render(); } },
    get count() { return projects.length; },
  };
  return api;
}
