#!/usr/bin/env node
// Local web-tools proxy for developing the page: the same /agent as the Cloudflare Worker (worker/pro.js), on this machine.
//   BRAVE_API_KEY=... node bin/proxy.js        listens on 127.0.0.1:8787 (PORT to change)
// POST /agent {question, deviceId?, persona?, message?} streams SSE (see src/serve.js).
// Only localhost origins may call it (ALLOWED_ORIGINS="https://a.com,https://b.com" to add more).
// The page uses the deployed Worker by default; to use this proxy open it once with ?proxy=http://127.0.0.1:8787 (?proxy= alone resets).
import { createServer } from "node:http";
import { MAX_BODY, parseAgentBody, runAgent } from "../src/serve.js";
import { loadSkills } from "../src/skills-fs.js";

const PORT = Number(process.env.PORT ?? 8787);
const EXTRA = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
const allowed = (o) => !!o && (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) || EXTRA.includes(o));

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowed(origin)) return res.writeHead(403).end("origin not allowed");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST" || req.url !== "/agent") return res.writeHead(404).end();

  let text = "";
  for await (const c of req) if ((text += c).length > MAX_BODY) return res.writeHead(413).end("too large");
  let body;
  try {
    body = parseAgentBody(text);
  } catch (e) {
    return res.writeHead(400).end(e.message);
  }

  const ac = new AbortController();
  res.on("close", () => ac.abort());
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  await runAgent(body, { send: (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`), signal: ac.signal, skills: loadSkills() }); // skills are read per request: edits apply at once
  res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`pro proxy on http://127.0.0.1:${PORT} (search: ${process.env.BRAVE_API_KEY ? "Brave, then " : ""}DuckDuckGo, then Wikipedia)`));
