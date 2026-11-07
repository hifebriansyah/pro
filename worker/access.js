// Who may use what. The sign-in is auth.situs.id's (the "auth" project): it sets one signed cookie, situs_session, for all of situs.id, and this Worker
// (pro-worker.situs.id, a subdomain, so the browser sends the cookie here too) reads it with the same secret. A page on localhost has no such cookie: it
// sends the token it was handed as "Authorization: Bearer" instead, and only a request from a page on this machine is read that way.
//   DeepSeek is paid from the account's credit: only the emails in DEEPSEEK_EMAILS (a Worker secret, comma separated) may use it. Everybody else is refused
//   (403), whatever the page shows: hiding the option is a courtesy, this is the lock. An empty or missing list lets nobody in.
const enc = new TextEncoder();
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const cookieValue = (header, name) => (header ?? "").split(/;\s*/).map((c) => c.split(/=(.*)/s)).find(([k]) => k === name)?.[1] ?? "";
const isLocalOrigin = (origin) => origin === "http://localhost" || origin === "http://127.0.0.1";

/** The payload of a signed session value (base64url(payload) "." base64url(HMAC-SHA256)) that is genuine and not expired; null otherwise. */
export async function verifySession(value, secret, now = Date.now()) {
  try {
    const [body, sig] = String(value).split(".");
    if (!body || !sig || !secret) return null;
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, unb64url(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
    return p.exp * 1000 > now && p.sub && typeof p.email === "string" ? p : null;
  } catch { return null; }
}

/** The signed-in user of a request: from the shared cookie, or (a page on this machine only) from a Bearer token. null: nobody. */
export async function sessionUser(request, env, now = Date.now()) {
  if (!env.SESSION_SECRET) return null;
  const bearer = isLocalOrigin(request.headers.get("Origin") ?? "") ? /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] : null;
  return verifySession(bearer ?? cookieValue(request.headers.get("Cookie"), "situs_session"), env.SESSION_SECRET, now);
}

export const emailList = (env) => String(env.DEEPSEEK_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
/** May this user use DeepSeek? */
export const mayUseDeepseek = (user, env) => !!user?.email && emailList(env).includes(user.email.trim().toLowerCase());
