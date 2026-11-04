// Web tools the agent loop (agent.js) can call: web_search, fetch_url and show_image.
// Runs on Node (bin/) and on Cloudflare Workers (worker/pro.js): only fetch and web APIs here, no node: imports at the top.
// web_search: Brave Search when BRAVE_API_KEY is set (it is paid: optional); else (or when Brave fails) DuckDuckGo's HTML page, which needs
// no key but may refuse a datacenter address; else Wikipedia's search, which needs no key and always answers. Each result says which one (via).
// A tool is run as run(args, {signal, env}): `env` carries the settings (BRAVE_API_KEY); on Node it defaults to process.env.
const processEnv = typeof process !== "undefined" ? process.env : {};

const UA = "Mozilla/5.0 (compatible; pro-agent/0.1)";
const MAX_PAGE_CHARS = 3000;

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
const strip = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Page HTML to plain text: scripts, styles and tags removed, whitespace collapsed. */
export function htmlToText(html) {
  return strip(html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " "));
}

/** DuckDuckGo result links are redirects (//duckduckgo.com/l/?uddg=<real url>); unwrap them. */
const unwrapDdg = (href) => {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") ?? u.href;
  } catch {
    return href;
  }
};

/** Parse DuckDuckGo's html.duckduckgo.com result page into [{title, url, snippet}]. */
export function parseDdg(html, limit = 5) {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && out.length < limit; ) {
    out.push({ title: strip(m[2]), url: unwrapDdg(decode(m[1])), snippet: strip(m[3]) });
  }
  return out;
}

async function braveSearch(query, limit, signal, key) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal,
  });
  if (!res.ok) throw new Error(`Brave search: HTTP ${res.status}`);
  const { web } = await res.json();
  return (web?.results ?? []).slice(0, limit).map((r) => ({ title: strip(r.title ?? ""), url: r.url, snippet: strip(r.description ?? "") }));
}

/**
 * DuckDuckGo's HTML page, asked for Indonesian results. A POST (the page's own form) first, then a GET. A reply that is not a plain 200
 * (the 202 of its bot check, a rate limit) or has no results counts as a refusal: [] so the next backend is tried.
 */
async function ddgSearch(query, limit, signal) {
  for (const method of ["POST", "GET"]) {
    try {
      const res = await fetch(method === "POST" ? "https://html.duckduckgo.com/html/" : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=id-id`, {
        method,
        headers: { "User-Agent": UA, "Accept-Language": "id,en;q=0.8", ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body: method === "POST" ? new URLSearchParams({ q: query, kl: "id-id" }) : undefined,
        signal,
      });
      if (res.status !== 200) continue;
      const found = parseDdg(await res.text(), limit);
      if (found.length) return found;
    } catch {} // a timeout or network error: try the next way
  }
  return [];
}

/** Wikipedia's own search (Indonesian first, then English): [{title, url, snippet}]. */
export async function wikiSearch(query, limit, signal) {
  for (const lang of ["id", "en"]) {
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": UA },
      signal,
    });
    if (!res.ok) throw new Error(`Wikipedia search: HTTP ${res.status}`);
    const hits = (await res.json()).query?.search ?? [];
    if (hits.length) {
      return hits.map((h) => ({ title: h.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, snippet: strip(h.snippet ?? "") }));
    }
  }
  return [];
}

/** Search the web: [{via, title, url, snippet}]; `via` names the backend that answered (brave, duckduckgo or wikipedia). */
export async function webSearch({ query }, { limit = 5, signal, env = processEnv } = {}) {
  if (!query || typeof query !== "string") throw new Error("web_search needs a query string");
  const tag = (via, list) => list.map((r) => ({ via, ...r }));
  if (env.BRAVE_API_KEY) {
    try {
      const found = await braveSearch(query, limit, signal, env.BRAVE_API_KEY);
      if (found.length) return tag("brave", found);
    } catch {} // out of quota or down: fall through to the keyless ones
  }
  const ddg = await ddgSearch(query, limit, signal);
  if (ddg.length) return tag("duckduckgo", ddg);
  return tag("wikipedia", await wikiSearch(query, limit, signal));
}

/**
 * Find one picture on Wikimedia Commons (free, no key, licensed) to show in the reply: {url, title, credit, page}.
 * This is a search for an existing photo, it does not generate anything.
 */
export async function showImage({ query }, { signal } = {}) {
  if (!query || typeof query !== "string") throw new Error("show_image needs a query string");
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=640`;
  const res = await fetch(api, { headers: { "User-Agent": UA }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikimedia Commons: HTTP ${res.status}`);
  const pages = Object.values((await res.json()).query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const i = p.imageinfo?.[0];
    if (!i || !/^image\/(jpeg|png|webp)$/.test(i.mime) || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(i.thumburl ?? "")) continue;
    const meta = i.extmetadata ?? {};
    const credit = [strip(meta.Artist?.value ?? ""), meta.LicenseShortName?.value].filter(Boolean).join(", ");
    return { url: i.thumburl, title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""), credit: credit.slice(0, 120), page: i.descriptionurl };
  }
  throw new Error(`no picture found for "${query}"`);
}

const isPrivate = (ip) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === "::1" || /^(fc|fd|fe80)/i.test(ip) || ip.startsWith("::ffff:");
const isIPLiteral = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

/** Resolve a host name to its addresses on Node. Workers have no DNS API (and refuse to fetch private addresses themselves): there it returns []. */
async function resolveHost(host) {
  const spec = "node:dns/promises"; // not a literal import: the Workers upload does not try to resolve it
  try {
    return (await (await import(spec)).lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

/** The model picks the URL, so refuse anything that is not public http(s): no localhost, LAN, or metadata endpoints. */
export async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("private host");
  const addrs = isIPLiteral(host) ? [host] : await resolveHost(host);
  if (addrs.some(isPrivate)) throw new Error("private address");
  return u;
}

/** Fetch a page and return its readable text, cut to MAX_PAGE_CHARS. */
export async function fetchUrl({ url }, { signal } = {}) {
  let u = await assertPublicUrl(url);
  let res;
  for (let hops = 0; hops < 4; hops++) {
    res = await fetch(u, { headers: { "User-Agent": UA }, redirect: "manual", signal: signal ?? AbortSignal.timeout(15_000) });
    if (res.status < 300 || res.status >= 400) break;
    u = await assertPublicUrl(new URL(res.headers.get("location") ?? "", u)); // re-check every redirect hop
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|json|xml/.test(type)) throw new Error(`not a text page (${type || "unknown type"})`);
  const body = (await res.text()).slice(0, 500_000);
  const text = /html/.test(type) ? htmlToText(body) : body;
  return { url: u.href, text: text.slice(0, MAX_PAGE_CHARS) };
}

export const TOOLS = {
  web_search: { run: webSearch, usage: '{"query": "search terms"}', does: "search the web, returns titles, URLs and snippets" },
  show_image: { run: showImage, image: true, usage: '{"query": "what the picture shows, e.g. Kaaba Mecca"}', does: "show ONE real photo to the user inside your reply (shown automatically, do not paste its URL); use it only when a picture clearly helps, e.g. a place, object or person" },
  fetch_url: { run: fetchUrl, usage: '{"url": "https://..."}', does: "read the text of one web page" },
};
