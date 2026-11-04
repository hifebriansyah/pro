// The pro Worker: the internet tools and skills for the chat page (index.html), on Cloudflare. The same code as bin/proxy.js (src/serve.js).
//
//   POST /agent  {"question": "...", "deviceId": "...", "persona": "...", "message": "..."}
//        ->  Server-Sent Events, one JSON per `data:` line (see src/serve.js):
//            {type:"tool",phase,name,args}  {type:"image",...}  {type:"document",title,markdown}  {type:"chunk",text}  {type:"references"}  {type:"done"}
//
// Settings (worker/pro.jsonc): ALLOWED_ORIGINS, TIMEZONE_OFFSET_MINUTES, AXIOM_LOG, AXIOM_DATASET, AXIOM_URL, the rate limits LIMITER (each IP address) and LIMITER_ALL (everybody).
// Secrets: BRAVE_API_KEY (optional: better search; entered in the Cloudflare dashboard, deploys keep it); AXIOM_TOKEN, copied from .env by the deploy.
//
// Request log (Axiom, when AXIOM_TOKEN is set), like guru's: one line per question (who asked: IP address, country and browser; which
// professional; the user's message; the tools used with their search words or address; steps, documents, photos, size of the answer, time, error) and
// one line for each refused request. The answer text itself is not logged. That is personal data: the page says questions are logged.

import { MAX_BODY, parseAgentBody, runAgent } from "../src/serve.js";
import { skillsFromList } from "../src/skills.js";

// Filled in by tools/deploy_worker.py from skills/*/SKILL.md: [{name, description, triggers, body}]
const SKILLS = __SKILLS__;

function logLine(env, ctx, event) {
  if (!env.AXIOM_TOKEN || env.AXIOM_LOG === "0") return; // AXIOM_LOG "0": off (no dataset yet): each line is a subrequest, which costs CPU and fails anyway
  const url = `${env.AXIOM_URL || "https://us-east-1.aws.edge.axiom.co"}/v1/ingest/${encodeURIComponent(env.AXIOM_DATASET || "pro.situs.id")}`;
  ctx.waitUntil(fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AXIOM_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ _time: new Date().toISOString(), worker: "pro", ...event }]),
  }).catch(() => {}));  // a lost log line never breaks an answer
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const originOk = allowed.some((a) => origin === a || origin.startsWith(`${a}:`));  // http://localhost also allows its ports
    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const u = new URL(request.url);
    const who = {
      method: request.method, url: (u.host + u.pathname + u.search).slice(0, 200), origin: origin || undefined,
      ip: request.headers.get("CF-Connecting-IP") || undefined, country: request.cf?.country, ua: (request.headers.get("User-Agent") || "").slice(0, 120) || undefined,
    };
    const reply = (obj, status = 200) => {
      logLine(env, ctx, { ...who, kind: "request", status, error: obj.error, ms: Date.now() - started });
      return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
    };

    if (request.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (!originOk) return reply({ error: "forbidden" }, 403);
    if (u.pathname !== "/agent" || request.method !== "POST") return reply({ error: "not found" }, 404);

    // Each question costs islam-gpt.org calls and a search: a few a minute from one IP address, and a ceiling for everybody together.
    if (env.LIMITER && !(await env.LIMITER.limit({ key: who.ip || "unknown" })).success) return reply({ error: "too many questions, wait a minute" }, 429);
    if (env.LIMITER_ALL && !(await env.LIMITER_ALL.limit({ key: "all" })).success) return reply({ error: "busy, try again in a minute" }, 429);

    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return reply({ error: "too large" }, 413);
    const text = await request.text().catch(() => "");
    if (text.length > MAX_BODY) return reply({ error: "too large" }, 413);
    let body;
    try {
      body = parseAgentBody(text);
    } catch (e) {
      return reply({ error: e.message }, 400);
    }

    // Gateway mode (BACKEND_URL and the secret BACKEND_SECRET are set): the heavy work runs on the backend (src/backend.js, Vercel), where there is no 10 ms CPU limit;
    // this Worker has done the checks above and only passes the stream through. If the backend is down, fall back to doing the work here.
    if (env.BACKEND_URL && env.BACKEND_SECRET) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), Number(env.BACKEND_CONNECT_MS) || 10_000);  // waiting for the first byte of the response, not for the whole answer
      try {
        const res = await fetch(env.BACKEND_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-pro-secret": env.BACKEND_SECRET }, body: text, signal: ac.signal });
        clearTimeout(t);
        if (res.ok && res.body) {
          logLine(env, ctx, { ...who, kind: "agent", via: "backend", message: body.message.slice(0, 500) || undefined, ms: Date.now() - started });
          return new Response(res.body, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
        }
        logLine(env, ctx, { ...who, kind: "backend-failed", status: res.status });
      } catch (e) {
        clearTimeout(t);
        logLine(env, ctx, { ...who, kind: "backend-failed", error: String(e?.message || e).slice(0, 200) });
      }
    }

    // Stream the events as they happen; the work goes on after this function returns (waitUntil).
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const ac = new AbortController();
    const send = (ev) => writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => ac.abort());  // nobody is reading any more: stop working
    ctx.waitUntil((async () => {
      // A long answer is quiet for tens of seconds between its parts: a comment line now and then (the page ignores it) keeps the connection from being closed as idle.
      const ping = setInterval(() => writer.write(enc.encode(": ping\n\n")).catch(() => ac.abort()), Number(env.KEEPALIVE_MS) || 15_000);
      try {
        const summary = await runAgent(body, { send, signal: ac.signal, env, skills: skillsFromList(SKILLS), timeZone: Number(env.TIMEZONE_OFFSET_MINUTES ?? 0) });
        logLine(env, ctx, {
          ...who, kind: "agent", agent: /You are (\w+)/.exec(body.persona)?.[1], message: body.message.slice(0, 500) || undefined,
          ...summary, ms: Date.now() - started,
        });
      } finally {
        clearInterval(ping);
      }
      await writer.close().catch(() => {});
    })());
    return new Response(readable, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  },
};
