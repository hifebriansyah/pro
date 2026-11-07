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
const LIBS = [[/three(\.min)?\.js/i, /\bTHREE\./, "THREE"], [/gsap/i, /\bgsap\./, "gsap"], [/chart(\.umd)?(\.min)?\.js/i, /new Chart\(/, "new Chart(...)"], [/leaflet/i, /\bL\.(map|tileLayer)\(/, "L.map(...)"]];

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
