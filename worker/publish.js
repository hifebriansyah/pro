// Publishing a finished page (the project screen's "Terbitkan"): one project = one folder in the R2 bucket `pro` (binding SITES).
//   POST /publish    {id?, token, html}  -> {id, url}   first time: no id, the Worker makes one and keeps only a hash of the token with the page;
//                                                       again (a revision): the same id and token overwrite the same folder, so the link never changes
//   POST /unpublish  {id, token}         -> {ok}
//   GET  /p/<id>/    the page itself, any visitor; sent with a sandbox policy (no same-origin: the page cannot touch this Worker), noindex, 30 days after the last publish it is gone
export const MAX_HTML = 500_000;
const ID = /^[a-z0-9]{12}$/;
const TOKEN = /^[a-f0-9]{32,64}$/;

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const newId = () => { const b = crypto.getRandomValues(new Uint8Array(12)); return [...b].map((x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join(""); };
const key = (id) => `${id}/index.html`;

/** POST /publish and /unpublish. Returns [body, status]. */
export async function handlePublish(kind, text, env, base) {
  if (!env.SITES) return [{ error: "penerbitan belum tersedia" }, 503];
  let b;
  try { b = JSON.parse(text); } catch { return [{ error: "permintaan tidak valid" }, 400]; }
  if (!b || typeof b.token !== "string" || !TOKEN.test(b.token)) return [{ error: "token tidak valid" }, 400];
  const hash = await sha256(b.token);
  if (kind === "unpublish") {
    if (typeof b.id !== "string" || !ID.test(b.id)) return [{ error: "id tidak valid" }, 400];
    const o = await env.SITES.head(key(b.id));
    if (!o) return [{ ok: true }, 200];
    if (o.customMetadata?.owner !== hash) return [{ error: "bukan milikmu" }, 403];
    await env.SITES.delete(key(b.id));
    return [{ ok: true }, 200];
  }
  if (typeof b.html !== "string" || b.html.trim().length < 20) return [{ error: "halaman kosong" }, 400];
  if (b.html.length > MAX_HTML) return [{ error: "halaman terlalu besar" }, 413];
  let id = b.id;
  if (id !== undefined && id !== null && id !== "") {
    if (typeof id !== "string" || !ID.test(id)) return [{ error: "id tidak valid" }, 400];
    const o = await env.SITES.head(key(id));
    if (o && o.customMetadata?.owner !== hash) return [{ error: "bukan milikmu" }, 403]; // a revision of your own folder only
  } else id = newId();
  await env.SITES.put(key(id), b.html, { httpMetadata: { contentType: "text/html; charset=utf-8" }, customMetadata: { owner: hash, at: String(Date.now()) } });
  return [{ id, url: `${base}/p/${id}/` }, 200];
}

/** GET /p/<id>[/] -> the page, or null when the path is not one. */
export async function servePage(pathname, env) {
  const m = /^\/p\/([a-z0-9]{12})\/?$/.exec(pathname);
  if (!m) return null;
  const o = env.SITES ? await env.SITES.get(key(m[1])) : null;
  const headers = { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    // opaque origin: the page runs its scripts but cannot reach this Worker, cookies or storage of any site of ours
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock" };
  if (!o) return new Response("Halaman tidak ditemukan atau sudah kedaluwarsa.", { status: 404, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(o.body, { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
}
