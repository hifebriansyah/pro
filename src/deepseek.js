// The third answer source: DeepSeek V4.1 Flash on Cloudflare Workers AI, paid from the account's AI Gateway credit (unified billing), never with
// Workers AI neurons: every call goes through the gateway "pro", whose Workers AI billing is set to "unified". Without the gateway the model is refused
// (it is not on the Workers Free plan), so a call can never fall back to neurons by accident.
//   In the Worker (worker/pro.js) the AI binding calls it. On the backend (Vercel, no binding) the call goes to the Worker's POST /llm with the
//   shared secret (x-pro-secret), so no Cloudflare token has to live on Vercel.
// Same shape as chatBuffered in islam.js ({text, references}), so the agent, the tools and the continuation of cut-off answers work on it unchanged.
export const DEEPSEEK_MODEL = "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
export const GATEWAY_ID = "pro";
export const LLM_URL = "https://pro-worker.situs.id/llm";
const MAX_TOKENS = 8000;       // about 25,000 characters: a long answer is carried on by src/continue.js like islam-gpt's
const MAX_PROMPT = 120_000;    // what /llm accepts

/** One call through the AI binding and the gateway (the Worker side of /llm, and the Worker's own fallback). */
export async function runDeepseek(ai, prompt) {
  const out = await ai.run(DEEPSEEK_MODEL, {
    messages: [{ role: "user", content: String(prompt).slice(0, MAX_PROMPT) }],
    max_tokens: MAX_TOKENS,
    reasoning_effort: "low",   // a short think first: answers in seconds instead of a minute, and fewer paid tokens
  }, { gateway: { id: GATEWAY_ID } });
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
  return typeof text === "string" ? text.trim() : "";
}

/**
 * chat(question, opts) for the agent: env.AI when it runs in the Worker, else POST /llm on the Worker with env.PROXY_SECRET (the backend's name for the
 * shared secret). Options as quranChat: signal, retries; plus env.
 */
export async function deepseekChat(question, { signal, env = {}, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let text;
      if (env.AI) {
        text = await runDeepseek(env.AI, question);
      } else {
        const secret = env.PROXY_SECRET || env.BACKEND_SECRET;
        if (!secret) throw Object.assign(new Error("deepseek: not configured"), { final: true });
        const res = await fetch(env.LLM_URL || LLM_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-pro-secret": secret }, body: JSON.stringify({ prompt: question }), signal });
        if (res.status === 429 || res.status >= 500) throw new Error(`deepseek: HTTP ${res.status}`);   // worth one more try
        if (!res.ok) throw Object.assign(new Error(`deepseek: HTTP ${res.status}`), { final: true });
        text = (await res.json().catch(() => null))?.text;
      }
      if (!text) throw Object.assign(new Error("deepseek: empty answer"), { final: true });
      return { text, references: [] };
    } catch (e) {
      lastError = e;
      if (e.final || signal?.aborted) break;
    }
  }
  throw lastError;
}
