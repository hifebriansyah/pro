// The account button: who is signed in, on every situs.id site. The sign-in itself lives at auth.situs.id (the "auth" project): it sets one cookie for all of
// situs.id, so a visitor who signed in on one site is signed in on the others. This module only asks who that is (GET /me), sends the visitor to
// /login, and signs them out. The same file is in the pro and faith projects.
//   On localhost (development) the cookie of situs.id does not exist, so the sign-in hands the session back in the address (#situs_token=...); it is kept in
//   localStorage and sent to /me as a Bearer token. The button is there on localhost too.
//   createAccount({doc, loc, fetchFn}) -> { mount(beforeElement), refresh(), user, requestInit(init), onChange }   mount puts a button before an element (a header's
//   theme button, say); requestInit(init) adds what a request to one of our Workers needs to be recognised (the shared cookie, or on localhost the Bearer token);
//   onChange(user) is called whenever who is signed in changes;
//   every button shows the same state, and the state is asked again whenever the tab comes back into view (another tab may have signed in or out).
export const AUTH = "https://auth.situs.id";

export const onSitus = (host) => host === "situs.id" || host.endsWith(".situs.id");
export const isLocalHost = (host) => host === "localhost" || host === "127.0.0.1";
const TOKEN_KEY = "situs:session-token";
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
/** Development: the sign-in came back with #situs_token=...: keep it and take it out of the address (it is the session: it must not stay in the history). */
export function adoptToken(loc, storage, hist) {
  const m = /^#situs_token=([\w.-]+)$/.exec(loc.hash ?? "");
  if (!m) return false;
  try { storage.setItem(TOKEN_KEY, m[1]); } catch { /* the sign-in only lasts this page */ }
  try { hist?.replaceState(null, "", loc.pathname + loc.search); } catch {}
  return true;
}
export const loginUrl = (here) => `${AUTH}/login?return=${encodeURIComponent(here)}`;
/** A photo address is only used when it is one of Google's. */
export const avatarUrl = (u) => (/^https:\/\/[\w.-]+\.googleusercontent\.com\//.test(u ?? "") ? u : null);

export async function fetchUser(fetchFn = fetch, token = null) {
  try {
    const res = await fetchFn(`${AUTH}/me`, token ? { headers: { Authorization: `Bearer ${token}` } } : { credentials: "include" });
    if (!res.ok) return null;
    const { user } = await res.json();
    return user && typeof user.email === "string" ? { name: String(user.name ?? user.email), email: user.email, picture: avatarUrl(user.picture) } : null;
  } catch { return null; }
}
export async function signOut(fetchFn = fetch, token = null) {
  try { return (await fetchFn(`${AUTH}/logout`, token ? { method: "POST" } : { method: "POST", credentials: "include" })).ok; } catch { return false; }
}

const USER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'; // constant markup

export function createAccount({ doc = document, loc = location, fetchFn = fetch, storage, hist = typeof history === "undefined" ? null : history } = {}) {
  const local = isLocalHost(loc.hostname);
  if (storage === undefined) { try { storage = localStorage; } catch { storage = memory(); } }
  if (local) adoptToken(loc, storage, hist);
  const token = () => (local ? storage.getItem(TOKEN_KEY) : null); // only a local page has one: a page of situs.id is read from the shared cookie
  const buttons = [];
  let user; // undefined: not known yet; null: nobody; object: signed in
  let menu = null, menuFor = null;

  const closeMenu = () => { menu?.remove(); menu = null; menuFor = null; };
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  function paint() {
    for (const b of buttons) {
      b.replaceChildren();
      if (user?.picture) { const img = el("img"); img.src = user.picture; img.alt = ""; img.referrerPolicy = "no-referrer"; b.append(img); }
      else if (user) b.append(el("span", "acct-initial", (user.name || user.email).trim().charAt(0).toUpperCase()));
      else b.insertAdjacentHTML("beforeend", USER_ICON);
      const label = user ? `Akun: ${user.name}` : "Masuk dengan Google";
      b.title = label; b.setAttribute("aria-label", label); b.setAttribute("aria-haspopup", user ? "menu" : "false");
      b.classList.toggle("acct-in", !!user);
    }
    if (menu && !user) closeMenu();
  }

  function openMenu(b) {
    if (menuFor === b) { closeMenu(); return; }
    closeMenu();
    menu = el("div", "acct-menu"); menu.setAttribute("role", "menu"); menuFor = b;
    menu.append(el("b", null, user.name), el("span", null, user.email));
    const out = el("button", "acct-out", "Keluar"); out.type = "button"; out.setAttribute("role", "menuitem");
    out.onclick = async () => { out.disabled = true; await signOut(fetchFn, token()); if (local) storage.removeItem(TOKEN_KEY); user = null; paint(); closeMenu(); api.onChange?.(user); };
    menu.append(out);
    doc.body.append(menu);
    const r = b.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 6)}px`;
    menu.style.right = `${Math.max(8, Math.round(doc.documentElement.clientWidth - r.right))}px`;
    out.focus();
  }

  const api = {
    get user() { return user; },
    onChange: null,
    /** fetch options for a request to one of our Workers (pro-worker.situs.id, faith-worker.situs.id), so that it knows who is asking. */
    requestInit(init = {}) {
      const t = token();
      if (local) return t ? { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } } : init;
      return { ...init, credentials: "include" };
    },
    mount(before) {
      if (!(onSitus(loc.hostname) || local) || !before?.parentNode) return null;
      const b = el("button", "icon-btn acct"); b.type = "button";
      b.onclick = (e) => { e.stopPropagation(); if (user) openMenu(b); else if (user === null) loc.href = loginUrl(loc.href); };
      before.parentNode.insertBefore(b, before);
      buttons.push(b);
      paint();
      return b;
    },
    // a page on localhost with no token has nobody signed in, and no cookie to send: nothing to ask
    async refresh() { const t = token(); const was = user?.email; user = local && !t ? null : await fetchUser(fetchFn, t); paint(); if (user?.email !== was) api.onChange?.(user); return user; },
  };
  doc.addEventListener("click", (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
  doc.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible" && buttons.length) api.refresh(); });
  return api;
}
