// The answer source on Cloudflare Workers AI: DeepSeek V4.1 Flash, paid from the account's AI Gateway credit (unified billing), never with
// Workers AI neurons: every call goes through the gateway "pro", whose Workers AI billing is set to "unified".
//   In the Worker (worker/pro.js) the AI binding calls the model. On the backend (Vercel, no binding) the call goes to the Worker's POST /llm with the
//   shared secret (x-pro-secret), so no Cloudflare token has to live on Vercel.
// Same shape as chatBuffered in islam.js ({text, references}), so the agent, the tools and the continuation of cut-off answers work on it unchanged.
// These models have no one-minute limit and a large context, so a team project runs them without the free sources' workarounds (src/team.js roomy).
export const MODELS = {
  // no thinking: even at reasoning_effort "low" DeepSeek sometimes thought through the whole budget (28,000 characters) and answered nothing
  deepseek: { model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", options: { chat_template_kwargs: { thinking: false } } },
  // Qwen3.8 27B was tried and removed: a dense 27B model writes about 130 characters a second (DeepSeek: about 400), so a whole landing page ran past Workers AI's
  // two-minute request limit ("3046: Request timeout").
};
export const AI_PROVIDERS = Object.keys(MODELS);
export const GATEWAY_ID = "pro";
export const LLM_URL = "https://pro-worker.situs.id/llm";
const MAX_TOKENS = 16_000;     // about 50,000 characters: a whole landing page in one answer; a longer one is carried on by src/continue.js
const MAX_PROMPT = 120_000;    // what /llm accepts

/** One call through the AI binding and the gateway (the Worker side of /llm, and the Worker's own fallback). which: a key of MODELS. */
export async function runModel(ai, which, prompt) {
  const m = MODELS[which];
  if (!m) throw new Error(`unknown model ${which}`);
  const out = await ai.run(m.model, {
    messages: [{ role: "user", content: String(prompt).slice(0, MAX_PROMPT) }],
    max_tokens: MAX_TOKENS,
    ...m.options,
  }, { gateway: { id: GATEWAY_ID } });
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
  return typeof text === "string" ? text.trim() : "";
}

/**
 * The chat(question, opts) function for one of MODELS: env.AI when it runs in the Worker, else POST /llm on the Worker with env.PROXY_SECRET (the
 * backend's name for the shared secret). Options as quranChat: signal, retries; plus env.
 */
export function aiChat(which) {
  return async function chat(question, { signal, env = {}, retries = 1 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        let text;
        if (env.AI) {
          text = await runModel(env.AI, which, question);
        } else {
          const secret = env.PROXY_SECRET || env.BACKEND_SECRET;
          if (!secret) throw Object.assign(new Error(`${which}: not configured`), { final: true });
          const res = await fetch(env.LLM_URL || LLM_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-pro-secret": secret }, body: JSON.stringify({ prompt: question, model: which }), signal });
          if (res.status === 429 || res.status >= 500) throw new Error(`${which}: HTTP ${res.status}`);   // worth one more try
          if (!res.ok) throw Object.assign(new Error(`${which}: HTTP ${res.status}`), { final: true });
          text = (await res.json().catch(() => null))?.text;
        }
        if (!text) throw Object.assign(new Error(`${which}: empty answer`), { final: true });
        return { text, references: [] };
      } catch (e) {
        lastError = e;
        if (e.final || signal?.aborted) break;
      }
    }
    throw lastError;
  };
}
