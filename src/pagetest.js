// A test run of a finished page, the way a visitor would use it, before QA looks at it: load it in a simulated browser (jsdom), run its scripts, click
// every button and every "#" link, open the menu, send the form empty and then filled in, and write down what broke. Nobody in the team can run code;
// this is the part of the team that does.
//
// What it cannot see: layout, colours, the look of a 3D scene (jsdom draws nothing). Libraries from the internet are not downloaded: Tailwind, Lucide
// and three.js are replaced by stand-ins that accept every call, so a page is judged on its own code, quickly and without the network.
// jsdom is loaded only when a test runs (the backend has it; anything without it skips the test and says so).

const VISITOR = { email: "budi.santoso@contoh.id", tel: "081234567890", number: "3", date: "2026-12-01", url: "https://contoh.id", text: "Budi Santoso", textarea: "Halo, saya tertarik dan ingin tahu lebih lanjut." };
const NOISE = /Not implemented|Could not load (script|link)|Could not parse CSS|Error: Could not load img/i;

/** A stand-in for a library: every property is another stand-in, every call and `new` returns one, numbers come out as 0. domElement is a real
 *  <canvas>, because code puts the renderer's element into the page. */
function anything(document) {
  const make = () => {
    const store = {};
    let canvas = null;
    const fn = function () {};
    return new Proxy(fn, {
      get(_, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === "then") return undefined; // never look like a promise
        if (key === "domElement") return (canvas ??= document.createElement("canvas"));
        if (key === "toString" || key === "valueOf") return () => "";
        if (typeof key === "symbol") return undefined;
        return key in store ? store[key] : (store[key] = make());
      },
      set(_, key, value) { store[key] = value; return true; },
      apply() { return make(); },
      construct() { return make(); },
    });
  };
  return make();
}

/** Is the element hidden, by itself or by an ancestor? (Tailwind is not loaded in the test, so its "hidden" class is read as the class it is.) */
function hiddenOf(el) {
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.hidden || e.classList?.contains("hidden") || e.classList?.contains("invisible") || e.classList?.contains("d-none")) return e;
    const st = e.getAttribute?.("style") ?? "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(st)) return e;
  }
  return null;
}
const describe = (el) => {
  if (!el) return "?";
  const id = el.id ? `#${el.id}` : "";
  if (el.tagName === "FORM" || (id && ["NAV", "HEADER", "MAIN", "FOOTER", "SECTION"].includes(el.tagName))) return `${el.tagName.toLowerCase()}${id}`; // a container: its text says nothing
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  return `${el.tagName.toLowerCase()}${id}${text ? ` "${text}"` : el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""}`;
};
const visibleText = (doc) => (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * Run the page. Returns { ran, problems: [string], passed: [string], steps } — problems in words a model can act on, passed for QA's report.
 * ran: false when jsdom is not available (then nothing was checked).
 */
export async function testPage(html, { timeoutMs = 4000 } = {}) {
  let JSDOM, VirtualConsole;
  try { ({ JSDOM, VirtualConsole } = await import("jsdom")); } catch { return { ran: false, problems: [], passed: [], steps: 0 }; }
  const errors = [];
  let phase = "loading the page";
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { const m = String(e?.message ?? e); if (!NOISE.test(m)) errors.push({ phase, message: m.split("\n")[0].slice(0, 200) }); });
  vc.on("error", (...a) => { const m = a.map(String).join(" "); if (!NOISE.test(m)) errors.push({ phase, message: `console.error: ${m.slice(0, 200)}` }); });

  const dom = new JSDOM(String(html), {
    runScripts: "dangerously", // the page's own inline scripts; nothing is downloaded (no "resources" option)
    pretendToBeVisual: true,
    url: "https://pro-worker.situs.id/p/test00000000/",
    virtualConsole: vc,
    beforeParse(w) {
      const doc = w.document;
      // what a real browser has and jsdom does not: stubs that do nothing, so a page is not blamed for jsdom's gaps
      w.matchMedia = () => ({ matches: false, media: "", addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.scrollTo = () => {}; w.scrollBy = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.HTMLElement.prototype.scrollTo = function () {};
      for (const name of ["ResizeObserver", "IntersectionObserver"]) w[name] ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      w.HTMLCanvasElement.prototype.getContext = () => anything(doc);
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => "";
      // a browser lets a script reach a form's field by its name (form.email); jsdom does not
      const named = () => { for (const f of doc.forms) for (const el of f.elements) { const n = el.name || el.id; if (n && !(n in f)) Object.defineProperty(f, n, { configurable: true, get: () => f.elements.namedItem(n) }); } };
      doc.addEventListener("DOMContentLoaded", named, true); // before the page's own handlers run
      w.__namedFields = named;
      w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
      // the libraries a page loads from the internet
      w.tailwind = { config: {} };
      w.lucide = { createIcons() {}, icons: {} };
      w.THREE = anything(doc);
      w.gsap = anything(doc); w.ScrollTrigger = anything(doc); w.Chart = anything(doc); w.L = anything(doc); w.AOS = anything(doc); w.Swiper = anything(doc);
    },
  });
  const w = dom.window, doc = w.document;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const problems = [], passed = [];
  const deadline = Date.now() + timeoutMs;
  let steps = 0;
  const newErrors = (from) => errors.slice(from);
  const blame = (list) => [...new Set(list.map((e) => e.message))].slice(0, 3).join(" | ");

  try {
    await new Promise((r) => (doc.readyState === "complete" ? r() : w.addEventListener("load", r, { once: true })));
    await wait(30);
    if (errors.length) problems.push(`the page throws an error as soon as it loads, so later code does not run: ${blame(errors)}`);
    else passed.push("the scripts run without errors on load");

    // the parts of the page a click must never make disappear
    const landmarks = () => [...doc.querySelectorAll("header, nav, main, footer, h1")].filter((e) => !hiddenOf(e));
    const click = async (el, label) => {
      if (Date.now() > deadline) return null;
      steps++;
      const before = errors.length, shown = landmarks();
      phase = `clicking ${label}`;
      el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
      await wait(10);
      const gone = shown.filter((e) => hiddenOf(e));
      return { errs: newErrors(before), gone };
    };

    // 1. the menu button: it opens, says so (aria-expanded), and never hides itself
    const menuBtn = [...doc.querySelectorAll("button, [role=button]")].find((b) => /menu|nav|burger|hamburger/i.test(`${b.id} ${b.className} ${b.getAttribute("aria-label") ?? ""} ${b.innerHTML}`));
    if (menuBtn) {
      const was = menuBtn.getAttribute("aria-expanded");
      const r = await click(menuBtn, describe(menuBtn));
      if (r) {
        if (r.errs.length) problems.push(`clicking the menu button ${describe(menuBtn)} throws: ${blame(r.errs)}`);
        if (hiddenOf(menuBtn)) problems.push(`clicking the menu button ${describe(menuBtn)} hides the button itself (it hides ${describe(hiddenOf(menuBtn))}, which contains it), so the menu can never be opened again: toggle only the menu's list of links`);
        else if (was !== null && menuBtn.getAttribute("aria-expanded") === was) problems.push(`the menu button ${describe(menuBtn)} does not change aria-expanded when clicked`);
        else if (!r.errs.length) passed.push("the menu button opens the menu");
        // a click somewhere else on the page must not hide the header or the menu button
        if (!hiddenOf(menuBtn)) {
          const r2 = await click(doc.querySelector("main") ?? doc.body, "an empty part of the page");
          if (r2?.gone.length) problems.push(`a click on an empty part of the page hides ${r2.gone.map(describe).slice(0, 2).join(" and ")}: an outside click should only close the open menu`);
          else if (r2 && hiddenOf(menuBtn)) problems.push(`after a click elsewhere on the page the menu button ${describe(menuBtn)} is hidden`);
        }
      }
    }

    // 2. every other button and every link to a part of the page
    const buttons = [...doc.querySelectorAll("button, [role=button]")].filter((b) => b !== menuBtn && b.type !== "submit" && !b.closest("form")).slice(0, 12);
    const links = [...doc.querySelectorAll('a[href^="#"]')].slice(0, 12);
    let broken = 0;
    for (const el of [...buttons, ...links]) {
      const r = await click(el, describe(el));
      if (!r) break;
      if (r.errs.length) { broken++; problems.push(`clicking ${describe(el)}${el.tagName === "A" ? ` (href="${el.getAttribute("href")}")` : ""} throws: ${blame(r.errs)}`); }
      else if (r.gone.length) problems.push(`clicking ${describe(el)} hides ${r.gone.map(describe).slice(0, 2).join(" and ")}`);
      if (broken >= 4) break;
    }
    if ((buttons.length || links.length) && !broken) passed.push(`${buttons.length} buttons and ${links.length} links can be clicked without errors`);
    for (const a of links) { const id = a.getAttribute("href").slice(1); if (id && !doc.getElementById(id)) problems.push(`the link ${describe(a)} points to #${id}, which is not on the page`); }

    // 3. every form: empty, then filled in like a visitor
    w.__namedFields?.(); // forms the script added later
    for (const form of [...doc.querySelectorAll("form")].slice(0, 3)) {
      if (Date.now() > deadline) break;
      const name = describe(form);
      const fields = [...form.querySelectorAll("input, textarea, select")].filter((f) => !["hidden", "submit", "button"].includes(f.type));
      const send = async (label) => {
        steps++;
        const before = errors.length, text = visibleText(doc);
        phase = `submitting ${name} ${label}`;
        const ev = new w.Event("submit", { bubbles: true, cancelable: true });
        form.dispatchEvent(ev);
        await wait(30);
        return { errs: newErrors(before), handled: ev.defaultPrevented, changed: visibleText(doc) !== text };
      };
      for (const f of fields) { if (f.type === "checkbox" || f.type === "radio") f.checked = false; else f.value = ""; }
      const empty = await send("empty");
      if (empty.errs.length) problems.push(`submitting ${name} empty throws: ${blame(empty.errs)}`);
      if (!empty.handled) problems.push(`${name} is not handled by the script (the submit is not prevented), so sending it reloads the page`);
      else if (!empty.changed) problems.push(`submitting ${name} empty shows no message: say next to each field what is missing`);
      for (const f of fields) {
        if (f.tagName === "SELECT") { if (f.options.length > 1) f.selectedIndex = 1; }
        else if (f.type === "checkbox" || f.type === "radio") f.checked = true;
        else f.value = VISITOR[f.type] ?? (f.tagName === "TEXTAREA" ? VISITOR.textarea : VISITOR.text);
        f.dispatchEvent(new w.Event("input", { bubbles: true }));
      }
      const full = await send("filled in");
      if (full.errs.length) problems.push(`submitting ${name} filled in correctly throws: ${blame(full.errs)}`);
      else if (full.handled && !full.changed) problems.push(`submitting ${name} filled in correctly shows no confirmation`);
      else if (full.handled && !empty.errs.length) passed.push(`${name} rejects an empty submit and confirms a correct one`);
    }
  } catch (e) {
    problems.push(`the test run could not finish: ${String(e?.message ?? e).slice(0, 160)}`);
  } finally {
    w.close(); // stops timers and animation frames
  }
  return { ran: true, problems: [...new Set(problems)].slice(0, 10), passed, steps };
}
