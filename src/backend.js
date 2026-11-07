// The heavy half of /agent, for a host without the Cloudflare free plan's 10 ms CPU limit (Vercel; see backend/). The Worker (worker/pro.js) stays the
// public front: origin check, rate limits, CORS. It forwards the question here with a shared secret in `x-pro-secret`; nobody else gets an answer.
// An IP allow-list would not do: a Worker's requests leave from Cloudflare addresses that other customers' Workers share, and Hobby has no firewall list.
import { chatBuffered as islamChat, randomDeviceId } from "./islam.js";
import { quranChat } from "./quran.js";
import { AI_PROVIDERS, aiChat } from "./workersai.js";
import { MAX_BODY, parseAgentBody, runAgent } from "./serve.js";
import { LIMITS, parseTeamBody, runTeam } from "./team.js";
import { skillsFromList } from "./skills.js";

// Same length-independent comparison for any two strings.
export function sameSecret(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// env: {PROXY_SECRET, TIMEZONE_OFFSET_MINUTES}; skills: the [{name, description, triggers, body}] list; chatFn: for tests.
export async function backendHandle(request, env, { skills = [], chatFn, personas } = {}) {
  if (!env.PROXY_SECRET) return json({ error: "not configured" }, 503);               // no secret set: refuse everything, never run open
  if (!sameSecret(request.headers.get("x-pro-secret"), env.PROXY_SECRET)) return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
  let body;
  try { body = parseAgentBody(text); } catch (e) { return json({ error: e.message }, 400); }

  const enc = new TextEncoder();
  const ac = new AbortController();
  const list = skillsFromList(skills);
  let ping;
  const stream = new ReadableStream({
    async start(controller) {
      const write = (s) => { try { controller.enqueue(enc.encode(s)); } catch { ac.abort(); } };
      ping = setInterval(() => write(": ping\n\n"), Number(env.KEEPALIVE_MS) || 15_000);
      try {
        await runAgent(body, { send: (ev) => write(`data: ${JSON.stringify(ev)}\n\n`), signal: ac.signal, env, skills: list, chatFn, personas, timeZone: Number(env.TIMEZONE_OFFSET_MINUTES ?? 0) });
      } finally {
        clearInterval(ping);
        try { controller.close(); } catch {}
      }
    },
    cancel() { clearInterval(ping); ac.abort(); },   // the Worker hung up: stop working
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

/**
 * POST /team: run (or resume) a team project and stream its events. Same protection as /agent (the shared secret), a bigger body (the finished work comes back
 * with it) and no fallback: it only runs here, because a whole run is minutes of work.
 */
export async function backendTeam(request, env, { skills = [], personas, chatFn } = {}) {
  if (!env.PROXY_SECRET) return json({ error: "not configured" }, 503);
  if (!sameSecret(request.headers.get("x-pro-secret"), env.PROXY_SECRET)) return json({ error: "unauthorized" }, 401);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const text = await request.text().catch(() => "");
  if (text.length > LIMITS.body) return json({ error: "too large" }, 413);
  let body;
  try { body = parseTeamBody(text); } catch (e) { return json({ error: e.message }, 400); }

  const deviceId = randomDeviceId(); // one anonymous id for the whole run
  const chat = chatFn ?? (body.provider === "quran" ? quranChat : AI_PROVIDERS.includes(body.provider) ? (q, o) => aiChat(body.provider)(q, { ...o, env }) : (q, o) => islamChat(q, { ...o, deviceId }));
  const enc = new TextEncoder();
  const ac = new AbortController();
  const list = skillsFromList(skills);
  let ping;
  const stream = new ReadableStream({
    async start(controller) {
      const write = (s) => { try { controller.enqueue(enc.encode(s)); } catch { ac.abort(); } };
      ping = setInterval(() => write(": ping\n\n"), Number(env.KEEPALIVE_MS) || 15_000);
      try {
        await runTeam(body, { send: (ev) => write(`data: ${JSON.stringify(ev)}\n\n`), signal: ac.signal, chatFn: chat, personas, skills: list });
      } catch (e) {
        write(`data: ${JSON.stringify({ type: "error", message: String(e.message ?? e).slice(0, 200) })}\n\n`);
      } finally {
        write(`data: ${JSON.stringify({ type: "end" })}\n\n`);
        clearInterval(ping);
        try { controller.close(); } catch {}
      }
    },
    cancel() { clearInterval(ping); ac.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
