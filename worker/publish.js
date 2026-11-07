// Publishing a project's pages: one project = one folder in the R2 bucket `pro` (binding SITES). Each stage of the work is a file in that folder
// (the designer's page, the engineer's finished page, every revision of them), and index.html is always the newest, so the folder's address shows the
// latest state while each stage keeps an address of its own.
//   POST /publish    {id?, token, html, file?}  -> {id, url, fileUrl}   first time: no id, the Worker makes one and keeps only a hash of the token;
//                                                                      again (another stage, a revision): the same id and token write into the same folder
//   POST /unpublish  {id, token}                -> {ok}     the whole folder
//   GET  /p/<id>/            the newest page                  GET /p/<id>/<file>.html   one stage
//   Pages go to any visitor, with a sandbox policy (no same-origin: a page cannot touch this Worker), noindex; 30 days after the last publish they are gone.
export const MAX_HTML = 500_000;
const ID = /^[a-z0-9]{12}$/;
const TOKEN = /^[a-f0-9]{32,64}$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newId = () => { const b = crypto.getRandomValues(new Uint8Array(12)); return [...b].map((x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join(""); };
const key = (id, file = "index") => `${id}/${file}.html`;
const OWNER = (id) => `${id}/.owner`;

/** Whose folder is it: the hash kept in its .owner marker (or, for folders made before files existed, on its index.html). null: nobody's yet. */
async function ownerOf(env, id) {
  const marker = await env.SITES.head(OWNER(id));
  if (marker) return marker.customMetadata?.owner ?? null;
  return (await env.SITES.head(key(id)))?.customMetadata?.owner ?? null;
}

/** Every object in a folder (R2 lists at most 1000 a call; a project has a handful). */
async function folder(env, id) {
  const keys = [];
  let cursor;
  do {
    const page = await env.SITES.list({ prefix: `${id}/`, cursor });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/** POST /publish and /unpublish. Returns [body, status]. */
export async function handlePublish(kind, text, env, base) {
  if (!env.SITES) return [{ error: "penerbitan belum tersedia" }, 503];
  let b;
  try { b = JSON.parse(text); } catch { return [{ error: "permintaan tidak valid" }, 400]; }
  if (!b || typeof b.token !== "string" || !TOKEN.test(b.token)) return [{ error: "token tidak valid" }, 400];
  const hash = await sha256(b.token);
  if (kind === "unpublish") {
    if (typeof b.id !== "string" || !ID.test(b.id)) return [{ error: "id tidak valid" }, 400];
    const owner = await ownerOf(env, b.id);
    if (!owner) return [{ ok: true }, 200];
    if (owner !== hash) return [{ error: "bukan milikmu" }, 403];
    for (const k of await folder(env, b.id)) await env.SITES.delete(k);
    return [{ ok: true }, 200];
  }
  if (typeof b.html !== "string" || b.html.trim().length < 20) return [{ error: "halaman kosong" }, 400];
  if (b.html.length > MAX_HTML) return [{ error: "halaman terlalu besar" }, 413];
  const file = b.file === undefined || b.file === null || b.file === "" ? "index" : b.file;
  if (typeof file !== "string" || !FILE.test(file)) return [{ error: "nama berkas tidak valid" }, 400];
  let id = b.id;
  if (id !== undefined && id !== null && id !== "") {
    if (typeof id !== "string" || !ID.test(id)) return [{ error: "id tidak valid" }, 400];
    const owner = await ownerOf(env, id);
    if (owner && owner !== hash) return [{ error: "bukan milikmu" }, 403]; // your own folder only
  } else id = newId();
  const meta = { httpMetadata: { contentType: "text/html; charset=utf-8" }, customMetadata: { owner: hash, at: String(Date.now()) } };
  await env.SITES.put(OWNER(id), "", { customMetadata: { owner: hash } });
  if (file !== "index") await env.SITES.put(key(id, file), b.html, meta);
  await env.SITES.put(key(id), b.html, meta); // the folder's own address always shows the newest stage
  return [{ id, url: `${base}/p/${id}/`, fileUrl: file === "index" ? `${base}/p/${id}/` : `${base}/p/${id}/${file}.html` }, 200];
}

/** GET /p/<id>/ or /p/<id>/<file>.html -> the page, or null when the path is not one. */
export async function servePage(pathname, env) {
  const m = /^\/p\/([a-z0-9]{12})(?:\/(?:([a-z0-9][a-z0-9-]{0,39})\.html)?)?$/.exec(pathname);
  if (!m) return null;
  const o = env.SITES ? await env.SITES.get(key(m[1], m[2] ?? "index")) : null;
  const headers = { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    // opaque origin: the page runs its scripts but cannot reach this Worker, cookies or storage of any site of ours
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock" };
  if (!o) return new Response("Halaman tidak ditemukan atau sudah kedaluwarsa.", { status: 404, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(o.body, { headers: { ...headers, "Cache-Control": "no-cache" } }); // a stage is overwritten when it is revised: always ask again
}
