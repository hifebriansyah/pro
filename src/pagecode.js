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
  return lines.join("\n").slice(0, maxChars);
}
