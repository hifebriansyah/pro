// Working with the code of a finished page: what is in it, whether its JavaScript even compiles, and putting the engineer's script into the designer's page.
// A small free model writes a long script blind: one missing bracket and the browser runs none of it, so the team checks the script before it goes on.

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)(?![^>]*type=["']?(?:application\/(?:ld\+)?json|text\/template))[^>]*>([\s\S]*?)<\/script>/gi;
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** The inline scripts of a page, as source text. */
export const inlineScripts = (html) => [...String(html).matchAll(INLINE_SCRIPT)].map((m) => m[1]);

/** null when the JavaScript compiles; otherwise the engine's message. (Compiles only, never runs it. A runtime that forbids it says nothing.) */
export function scriptProblem(js) {
  try { new Function(String(js)); return null; } catch (e) { return e instanceof SyntaxError ? e.message : null; }
}

/** The first problem among a page's inline scripts, or null. */
export function pageProblem(html) {
  for (const s of inlineScripts(html)) { const p = scriptProblem(s); if (p) return p; }
  return null;
}

/** Code the model wrapped in a Markdown fence or in <script> tags: just the code. */
export function bareCode(raw) {
  let t = String(raw).trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(t);
  if (fence) t = fence[1];
  const tag = /^<script[^>]*>([\s\S]*?)<\/script>\s*$/i.exec(t);
  if (tag) t = tag[1];
  return t.trim();
}

/** The designer's page with the engineer's script before </body>. */
export function assemble(html, js) {
  const block = `<script>\n${String(js).replace(/<\/script/gi, "<\\/script")}\n</script>\n`;
  const h = String(html);
  const i = h.toLowerCase().lastIndexOf("</body>");
  if (i >= 0) return h.slice(0, i) + block + h.slice(i);
  const j = h.toLowerCase().lastIndexOf("</html>");
  return j >= 0 ? h.slice(0, j) + block + h.slice(j) : h + "\n" + block;
}

/** The script a finished page carries (the last inline one: the engineer's), for a revision or a review. */
export const lastScript = (html) => inlineScripts(html).at(-1) ?? "";

/** What a colleague who cannot read 30,000 characters needs to know about a page: its parts, the hooks the script can use, and whether the script works. */
export function outlineOf(html, { maxChars = 3500 } = {}) {
  const h = String(html);
  const list = (re, f, n) => [...new Set([...h.matchAll(re)].map(f).filter(Boolean))].slice(0, n);
  const lines = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1];
  if (title) lines.push(`title: ${text(title)}`);
  const heads = list(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi, (m) => `${m[1]} ${text(m[2]).slice(0, 70)}`, 16);
  if (heads.length) lines.push(`headings: ${heads.join(" | ")}`);
  const ids = list(/\sid=["']([\w-]+)["']/g, (m) => m[1], 50);
  if (ids.length) lines.push(`ids: ${ids.join(", ")}`);
  const data = list(/\s(data-[\w-]+)(?:=|\s|>)/g, (m) => m[1], 20);
  if (data.length) lines.push(`data attributes: ${data.join(", ")}`);
  const fields = list(/<(input|textarea|select)\b([^>]*)>/gi, (m) => { const a = m[2]; const n = /(?:name|id)=["']([\w-]+)["']/.exec(a)?.[1]; const t = /type=["'](\w+)["']/.exec(a)?.[1]; return n ? `${m[1]}${t ? ":" + t : ""} ${n}` : null; }, 20);
  if (fields.length) lines.push(`form fields: ${fields.join(", ")}`);
  const buttons = list(/<button\b[^>]*>([\s\S]*?)<\/button>/gi, (m) => text(m[1]).slice(0, 40), 14);
  if (buttons.length) lines.push(`buttons: ${buttons.join(" | ")}`);
  const anchors = list(/href=["'](#[\w-]+)["']/g, (m) => m[1], 20);
  if (anchors.length) lines.push(`anchor links: ${anchors.join(", ")}`);
  const scripts = inlineScripts(h);
  const external = list(/<script[^>]*\bsrc=["']([^"']+)["']/gi, (m) => m[1], 6);
  if (external.length) lines.push(`libraries loaded: ${external.join(", ")}`);
  const bad = pageProblem(h);
  lines.push(`inline scripts: ${scripts.length}${scripts.length ? bad ? `; SYNTAX ERROR, the script does not run: ${bad}` : "; they compile" : ""}`);
  const gone = scripts.length ? missingIds(h) : [];
  if (gone.length) lines.push(`the script looks up ids that are not on the page: ${gone.slice(0, 12).join(", ")}`);
  for (const w of [...markupWarnings(h), ...(scripts.length ? unusedLibraries(h).map((n) => `a library is loaded but never used: ${n}`) : [])]) lines.push(`warning: ${w}`);
  return lines.join("\n").slice(0, maxChars);
}

/** Ids the scripts look up (getElementById, querySelector("#x")) that are neither on the page nor made by the scripts themselves. */
export function missingIds(html) {
  const h = String(html), code = inlineScripts(h).join("\n");
  const markup = h.replace(INLINE_SCRIPT, "");
  const have = new Set([...markup.matchAll(/\sid=["']([\w-]+)["']/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\bid\s*=\s*["'`]([\w-]+)["'`]|setAttribute\(\s*["']id["']\s*,\s*["']([\w-]+)["']|\sid=\\?["']([\w-]+)\\?["']/g)) have.add(m[1] ?? m[2] ?? m[3]);
  const wanted = new Set([
    ...[...code.matchAll(/getElementById\(\s*["'`]([\w-]+)["'`]\s*\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/querySelector(?:All)?\(\s*["'`]#([\w-]+)["'`]\s*\)/g)].map((m) => m[1]),
  ]);
  return [...wanted].filter((id) => !have.has(id));
}

// a library loaded by address, and what code that uses it contains
const LIBS = [[/three(\.min)?\.js/i, /\bTHREE\./, "THREE"], [/gsap/i, /\bgsap\./, "gsap"], [/chart(\.umd)?(\.min)?\.js/i, /new Chart\(/, "new Chart(...)"], [/leaflet/i, /\bL\.(map|tileLayer)\(/, "L.map(...)"], [/lucide/i, /createIcons\s*\(/, "lucide.createIcons()"]];

/** A library the page loads that no script uses (the goal asked for three.js; the code never touched it). */
export function unusedLibraries(html) {
  const code = inlineScripts(html).join("\n");
  const srcs = [...String(html).matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  return LIBS.filter(([file, use]) => srcs.some((s) => file.test(s)) && !use.test(code)).map(([, , name]) => name);
}

/** Problems in the markup that a script fix cannot repair, for the reviewer to see: the same id twice, pictures from a placeholder service that is gone. */
export function markupWarnings(html) {
  const h = String(html).replace(INLINE_SCRIPT, "");
  const out = [];
  const ids = [...h.matchAll(/\sid=["']([\w-]+)["']/g)].map((m) => m[1]);
  const twice = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (twice.length) out.push(`the same id is used more than once: ${twice.slice(0, 8).join(", ")}`);
  if (/(?:src|url\()\s*=?\s*["']?https?:\/\/(?:via\.placeholder\.com|placehold\.it|placeholder\.com)/i.test(h)) out.push("pictures come from a placeholder service that no longer works (they show as broken): use CSS gradients or inline SVG");
  return out;
}

/** What is wrong with a finished page's code, in words a model can act on; [] when nothing is found. */
export function checkPage(html) {
  const out = [];
  const scripts = inlineScripts(html);
  if (!scripts.some((s) => s.trim())) out.push("the page has no JavaScript at all");
  scripts.forEach((s, i) => { const p = scriptProblem(s); if (p) out.push(`script ${i + 1} of ${scripts.length} has a syntax error, so the browser runs none of it: ${p}`); });
  const gone = missingIds(html);
  if (gone.length) out.push(`the script looks up ids that do not exist on the page (it will do nothing or throw there): ${gone.slice(0, 12).join(", ")}`);
  const unused = unusedLibraries(html);
  if (unused.length) out.push(`the page loads a library the script never uses (the goal asked for it): write the code that uses ${unused.join(", ")}`);
  return out;
}

/** The page with its last inline script replaced (or the script added when it has none). */
export function replaceLastScript(html, js) {
  const h = String(html);
  const all = [...h.matchAll(INLINE_SCRIPT)];
  const last = all.at(-1);
  if (!last) return assemble(h, js);
  return h.slice(0, last.index) + `<script>\n${String(js).replace(/<\/script/gi, "<\\/script")}\n</script>` + h.slice(last.index + last[0].length);
}

/** Did a rewrite of a page keep the page? (a model asked to "keep everything" sometimes returns a shortened or different page) */
export function keptPage(base, html) {
  const heads = (x) => [...String(x).matchAll(/<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => text(m[2]).toLowerCase()).filter(Boolean);
  const before = heads(base), after = new Set(heads(html));
  const kept = before.length ? before.filter((t) => after.has(t)).length / before.length : 1;
  return kept >= 0.6 && String(html).length >= String(base).length * 0.6;
}

// ---- an engineer's changes to a page, small enough for one model call (a free model answers in about 60 seconds at most, so it cannot rewrite a 15,000-character file)
//   <add-css>...</add-css>                       CSS added to the page's styles
//   <add-html>...</add-html>                     markup added at the end of the body (a toast, a back to top button, a dialog)
//   <change><find>exact text</find><replace>new text</replace></change>   any number: an exact piece of the file and what it becomes
//   <document title="script.js">...</document>   the JavaScript (or a <script> block)
const block = (name, t) => [...String(t).matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);

/** The changes in a reply. The JavaScript comes from a script.js document, a <script> block or a fenced code block, in that order. */
export function parseEdits(reply) {
  const t = String(reply);
  const changes = [...t.matchAll(/<change>\s*<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>\s*<\/change>/gi)].map((m) => ({ find: m[1].replace(/^\n|\n$/g, ""), replace: m[2].replace(/^\n|\n$/g, "") }));
  const rest = t.replace(/<change>[\s\S]*?<\/change>/gi, "").replace(/<add-(?:css|html)>[\s\S]*?<\/add-(?:css|html)>/gi, "");
  const doc = /<document[^>]*>([\s\S]*?)(?:<\/document>|$)/i.exec(rest)?.[1];
  const tag = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(rest)?.[1];
  const fence = /```(?:js|javascript)?\n([\s\S]*?)```/i.exec(rest)?.[1];
  const libs = [...rest.matchAll(/<script[^>]*\bsrc=["'](https:\/\/cdnjs\.cloudflare\.com\/[^"']+)["'][^>]*><\/script>/gi)].map((m) => m[1]);
  return { css: block("add-css", t).join("\n").trim(), html: block("add-html", t).join("\n").trim(), changes, libs, js: bareCode(doc ?? tag ?? fence ?? "") };
}

/** The page with the changes applied. A change whose text is not in the page is skipped and reported, never guessed. */
export function applyEdits(base, { css = "", html = "", changes = [], libs = [], js = "" }, { replaceScript = false } = {}) {
  let page = String(base);
  const missed = [];
  for (const c of changes) {
    if (c.find && page.includes(c.find)) page = page.replace(c.find, () => c.replace);
    else missed.push(c.find.slice(0, 80));
  }
  const before = (needle, add) => { const i = page.toLowerCase().lastIndexOf(needle); page = i >= 0 ? page.slice(0, i) + add + page.slice(i) : page + add; };
  if (css) before("</head>", `<style>\n${css}\n</style>\n`);
  if (html) before("</body>", `${html}\n`);
  for (const src of libs) if (!page.includes(src)) before("</body>", `<script src="${src}"></script>\n`);
  if (js) page = replaceScript ? replaceLastScript(page, js) : assemble(page, js); // a revision's script replaces the one before it
  return { html: page, missed };
}

// ---- repairs the code makes itself, after the engineer: things a model gets wrong often and that have one safe answer

/** Run fn on the markup only (never inside a script, where the same text may be a string the code builds). */
const onMarkup = (html, fn) => {
  const h = String(html), parts = [];
  let last = 0;
  for (const m of h.matchAll(INLINE_SCRIPT)) { parts.push(fn(h.slice(last, m.index)), m[0]); last = m.index + m[0].length; }
  parts.push(fn(h.slice(last)));
  return parts.join("");
};

/** An inline icon (an <svg> with a small viewBox) that has no width and height fills the whole width: give it 24 by 24. CSS that sizes it still wins,
 *  because width and height attributes are the weakest rule there is. Large illustrations are left alone. */
export function fixIcons(html) {
  let n = 0;
  const out = onMarkup(html, (part) => part.replace(/<svg\b([^>]*)>/gi, (tag, attrs) => {
    if (/\s(width|height)\s*=/i.test(attrs)) return tag;
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(attrs);
    if (!vb || Math.max(Number(vb[1]), Number(vb[2])) > 48) return tag;
    n++;
    return `<svg width="24" height="24"${attrs}>`;
  }));
  return { html: out, fixed: n ? [`${n} ikon SVG diberi ukuran 24x24`] : [] };
}

const DEAD_PICTURES = /https?:\/\/(?:via\.placeholder\.com|placehold\.it|placeholder\.com|dummyimage\.com)\/[^"'\s)]*/gi;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** A picture in the same size, drawn inline, that never breaks: a soft gradient with a label. */
export function placeholderPicture(url, label = "Gambar") {
  const size = /\/(\d{2,4})(?:x(\d{2,4}))?/.exec(String(url));
  const w = Math.min(Number(size?.[1] ?? 600), 2000), h = Math.min(Number(size?.[2] ?? size?.[1] ?? 400), 2000);
  const text = esc(String(label).slice(0, 40));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe6f7"/><stop offset="1" stop-color="#fbe9dd"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,sans-serif" font-size="${Math.max(12, Math.round(Math.min(w, h) / 9))}" fill="#7a6a8c">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
/** Pictures from a placeholder service that is gone show as broken: replace each with an inline picture of the same size, labelled with its alt text. */
export function fixPictures(html) {
  let n = 0;
  const out = onMarkup(html, (part) => part
    .replace(/<img\b[^>]*>/gi, (tag) => tag.replace(DEAD_PICTURES, (url) => { n++; return placeholderPicture(url, /\balt=["']([^"']*)["']/i.exec(tag)?.[1] || "Gambar"); }))
    .replace(DEAD_PICTURES, (url) => { n++; return placeholderPicture(url); }));
  return { html: out, fixed: n ? [`${n} gambar dari layanan placeholder yang sudah mati diganti gambar bawaan`] : [] };
}

/** The same id twice: an exact copy of an empty element is removed; any other repeat is renamed (id-2), so the first, which the script finds, keeps it. */
export function fixDuplicateIds(html) {
  const fixed = [];
  const out = onMarkup(html, (part) => {
    let p = part;
    const seen = new Map();
    // exact copies of an empty element, such as <div class="status" id="msg"></div> written twice
    p = p.replace(/<(\w+)\b([^>]*\sid=["']([\w-]+)["'][^>]*)>\s*<\/\1>/g, (whole, tag, attrs, id) => {
      const key = whole.replace(/\s+/g, " ");
      if (seen.get(id) === key) { fixed.push(`elemen kembar #${id} dihapus`); return ""; }
      if (!seen.has(id)) seen.set(id, key);
      return whole;
    });
    const count = new Map();
    p = p.replace(/(\sid=["'])([\w-]+)(["'])/g, (m, a, id, b) => {
      const k = (count.get(id) ?? 0) + 1; count.set(id, k);
      if (k === 1) return m;
      fixed.push(`id #${id} yang dobel diganti menjadi #${id}-${k}`);
      return `${a}${id}-${k}${b}`;
    });
    return p;
  });
  return { html: out, fixed };
}

/** A model that escapes its own output leaves a literal "\n" between tags, which shows on the page as text. */
export function fixStrayEscapes(html) {
  let n = 0;
  const out = onMarkup(html, (part) => part.replace(/>((?:\s*\\[nrt])+)\s*</g, (m) => { n++; return ">\n<"; }));
  return { html: out, fixed: n ? [`${n} teks "\\n" yang nyasar dihapus`] : [] };
}

/** All the repairs, in order. fixed: what was done, in words for the handoff note. */
export function repairPage(html) {
  let h = String(html), fixed = [];
  for (const fix of [fixStrayEscapes, fixIcons, fixPictures, fixDuplicateIds, ensureLibraries]) { const r = fix(h); h = r.html; fixed = fixed.concat(r.fixed); }
  return { html: h, fixed };
}

// ---- three.js: a free model rarely writes a working scene from nothing, but it adapts one well. The starter is given to the engineer, and used as is
// when the goal asks for three.js and his code still does not use it.
export const THREE_SRC = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
export const wantsThree = (goal) => /\bthree\s*\.?\s*js\b|\bthreejs\b|\bwebgl\b/i.test(String(goal ?? ""));
const SCENE_HOOK = /\sid=["']([\w-]*(?:scene|three|canvas|3d|webgl|viewer|hero-visual|hero-art)[\w-]*)["']/i;
/** The id of the container the designer left for the scene, if there is one. */
export const sceneContainer = (html) => SCENE_HOOK.exec(String(html).replace(INLINE_SCRIPT, ""))?.[1] ?? null;

/** A small, complete three.js scene (r128): fills its container, follows its size, a lit object that turns, colours from the page's --primary and
 *  --accent variables, still when the visitor prefers reduced motion. No container: it makes one at the top of the first section. */
export function threeStarter(containerId) {
  return `// 3D scene (three.js r128): a lit object that turns, sized to its container
(function startScene() {
  function run() {
    if (!window.THREE) return;
    var host = ${containerId ? `document.getElementById(${JSON.stringify(containerId)})` : "null"};
    if (!host) {
      host = document.createElement("div");
      host.id = "scene-3d";
      host.style.cssText = "width:100%;height:min(60vh,480px);";
      var first = document.querySelector("section, main, header");
      if (first && first.parentNode) first.parentNode.insertBefore(host, first.nextSibling); else document.body.prepend(host);
    }
    if (!host.clientHeight) host.style.minHeight = "320px";
    var css = getComputedStyle(document.documentElement);
    var colour = function (name, fallback) { var v = css.getPropertyValue(name).trim(); try { return new THREE.Color(v || fallback); } catch (e) { return new THREE.Color(fallback); } };
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 6);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(3, 4, 5);
    scene.add(sun);
    var shape = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, 0.38, 160, 24), new THREE.MeshStandardMaterial({ color: colour("--primary", "#6c5ce7"), roughness: 0.35, metalness: 0.2 }));
    scene.add(shape);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.03, 12, 120), new THREE.MeshBasicMaterial({ color: colour("--accent", "#ffc93c") }));
    ring.rotation.x = Math.PI / 2.4;
    scene.add(ring);
    function size() {
      var w = host.clientWidth || 300, h = host.clientHeight || 300;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(host); else window.addEventListener("resize", size);
    var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function frame(t) {
      if (!still) { shape.rotation.x = t / 2600; shape.rotation.y = t / 1800; ring.rotation.z = t / 4000; }
      renderer.render(scene, camera);
      if (!still) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
})();`;
}

/** The goal asks for three.js and the page does not use it: load it and add the starter scene (in the designer's container when she left one). */
export function ensureThree(html, goal) {
  if (!wantsThree(goal) || /\bTHREE\./.test(inlineScripts(html).join("\n"))) return { html, fixed: [] };
  let h = String(html);
  const lib = h.includes("three.min.js") || h.includes("three.module.js") ? "" : `<script src="${THREE_SRC}"></script>\n`;
  h = beforeLastScript(h, `${lib}<script>\n${threeStarter(sceneContainer(h))}\n</script>\n`);
  return { html: h, fixed: ["adegan 3D three.js dasar dipasang karena kodenya belum memakai three.js"] };
}

// ---- common libraries a landing page is built with: Tailwind CSS (Play CDN) for styling, Lucide for icons
export const TAILWIND_SRC = "https://cdn.tailwindcss.com/3.4.17";
export const LUCIDE_SRC = "https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js";

/** Put a block right before the page's last inline script (the engineer's), so that script stays the last one; or before </body>. */
export function beforeLastScript(html, block) {
  const h = String(html);
  const last = [...h.matchAll(INLINE_SCRIPT)].at(-1);
  if (last) return h.slice(0, last.index) + block + h.slice(last.index);
  const i = h.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? h.slice(0, i) + block + h.slice(i) : h + block;
}

const TW_CLASS = /^(?:(?:sm|md|lg|xl|hover|focus):)*(?:flex|grid|hidden|block|items-\w+|justify-\w+|gap-\d+|p[xytrbl]?-\d+|m[xytrbl]?-(?:\d+|auto)|w-(?:\d+|full|screen)|h-(?:\d+|full|screen)|text-(?:xs|sm|base|lg|[2-9]?xl|center|white|black|\w+-\d{2,3})|bg-(?:white|black|\w+-\d{2,3})|rounded(?:-\w+)?|shadow(?:-\w+)?|font-(?:bold|semibold|medium)|max-w-\w+|space-[xy]-\d+|border(?:-\w+)?)$/;
/** Lucide icons in the markup must be drawn (lucide.createIcons) or they stay empty; Tailwind classes need Tailwind loaded or the page is unstyled. */
export function ensureLibraries(html) {
  let h = String(html);
  const fixed = [];
  const markup = h.replace(INLINE_SCRIPT, "");
  const code = inlineScripts(h).join("\n");
  if (/\sdata-lucide=/.test(markup) && !/\blucide\b[^"']*\.js/.test(h)) {
    h = beforeLastScript(h, `<script src="${LUCIDE_SRC}"></script>\n`);
    fixed.push("pustaka ikon Lucide dimuat");
  }
  if (/\sdata-lucide=/.test(markup) && !/createIcons\s*\(/.test(code)) {
    h = beforeLastScript(h, `<script>\ndocument.addEventListener("DOMContentLoaded", function () { if (window.lucide) window.lucide.createIcons(); });\n</script>\n`);
    fixed.push("ikon Lucide digambar (lucide.createIcons)");
  }
  const classes = [...markup.matchAll(/\sclass=["']([^"']+)["']/g)].flatMap((m) => m[1].split(/\s+/));
  if (classes.filter((c) => TW_CLASS.test(c)).length >= 12 && !/cdn\.tailwindcss\.com|tailwind(?:\.min)?\.css/.test(h)) {
    const i = h.toLowerCase().indexOf("</head>");
    const tag = `<script src="${TAILWIND_SRC}"></script>\n`;
    h = i >= 0 ? h.slice(0, i) + tag + h.slice(i) : tag + h;
    fixed.push("Tailwind CSS dimuat (halaman memakai kelasnya)");
  }
  return { html: h, fixed };
}
