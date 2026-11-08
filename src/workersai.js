// The answer source on Cloudflare Workers AI: DeepSeek V4.1 Flash, paid from the account's AI Gateway credit (unified billing), never with
// Workers AI neurons: every call goes through the gateway "pro", whose Workers AI billing is set to "unified".
//   In the Worker (worker/pro.js) the AI binding calls the model. On the backend (Vercel, no binding) the call goes to the Worker's POST /llm with the
//   shared secret (x-pro-secret), so no Cloudflare token has to live on Vercel.
// Same shape as chatBuffered in islam.js ({text, references}), so the agent, the tools and the continuation of cut-off answers work on it unchanged.
// These models have no one-minute limit and a large context, so a team project runs them without the free sources' workarounds (src/team.js roomy).
export const MODELS = {
  deepseek: { model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", options: {} },
  // Qwen3.8 27B was tried and removed: a dense 27B model writes about 130 characters a second (DeepSeek: about 400), so a whole landing page ran past Workers AI's
  // two-minute request limit ("3046: Request timeout").
};
export const AI_PROVIDERS = Object.keys(MODELS);
export const GATEWAY_ID = "pro";
export const LLM_URL = "https://pro-worker.situs.id/llm";
const MAX_TOKENS = 16_000;     // about 50,000 characters: a whole landing page in one answer; a longer one is carried on by src/continue.js
const MAX_PROMPT = 120_000;    // what /llm accepts

const SVG_WORDS = /(?:^|[^\p{L}])(?:svg|logo|ikon|icon|ilustrasi|illustration|monogram|vektor|vector)(?![\p{L}])|<svg[\s>]/iu;
const MD_WORDS = /(?:^|[^\p{L}])(?:markdown|prd|brd|dokumen|document|laporan|report|panduan|guide|proposal|spesifikasi|specification|test plan|test cases?|user stor(?:y|ies)|content calendar|kalender konten|rangkuman|ringkasan)(?![\p{L}])|<document[\s>]/iu;
const WEB_WORDS = /(?:^|[^\p{L}])(?:website|situs|web|landing page|mockup|mock-up|mock up|wireframe|prototipe|prototype|dashboard|halaman|page|aplikasi|app|layout|antarmuka|ui|ux)(?![\p{L}])|<mockup[\s>]|<!doctype html/iu;

/** The user's current request inside an agent, continuation or direct prompt (ignoring the tool/skill catalogue at the top and earlier chat turns). */
function activeRequest(prompt) {
  const s = String(prompt);
  const turn = s.lastIndexOf("User's new message:");
  if (turn !== -1) return s.slice(turn + 19).split(/\n\n(?:\(Reply in the language|You called )/)[0];
  const first = s.lastIndexOf("User's first message:");
  if (first !== -1) return s.slice(first + 21).split(/\n\n(?:\(Reply in the language|You called )/)[0];
  const q = s.lastIndexOf("User question:");
  if (q !== -1) return s.slice(q + 14).split("\n\nYou called ")[0];
  return s;
}

/**
 * Reasoning effort by content type:
 * - "high" for SVG / icons / logos (short output, needs coordinate math) and Markdown documents (structure and depth)
 * - "low"  for full websites / landing pages / HTML mockups (plans layout without hitting the two-minute timeout)
 * - "none" for simple chat and follow-ups (fast and free of thinking tokens)
 */
export function reasoningEffort(prompt) {
  const s = String(prompt);
  if (s.includes("You are inside a <document> (Markdown).")) return "high";
  if (s.includes("You are inside a <mockup> (HTML or SVG).")) {
    const tail = s.slice(s.indexOf("REQUEST:"));
    return SVG_WORDS.test(tail) && !/<!doctype|<html[\s>]/i.test(tail) ? "high" : "low";
  }
  if (s.includes("You are inside a fenced code block.")) return "low";
  if (s.includes("PROJECT MODE: you are not chatting now.")) {
    return s.includes('Write the deliverable as ONE <document title="') ? "high" : "low";
  }
  const req = activeRequest(s);
  const hasMockup = s.includes('Skill "mockup-html" applies to this request') || s.includes('You called load_skill {"name":"mockup-html"}');
  const hasMd = s.includes('Skill "writing-md" applies to this request') || s.includes('You called load_skill {"name":"writing-md"}');
  if (SVG_WORDS.test(req)) return "high";
  if (hasMd && (!hasMockup || MD_WORDS.test(req))) return "high";
  if (hasMockup) return "low";
  if (MD_WORDS.test(req)) return "high";
  if (WEB_WORDS.test(req)) return "low";
  return "none";
}

/** What the gateway log should say about a call, so cost can be read per kind of work (never the prompt itself): the effort, the agent and the step. */
export function callMetadata(prompt, effort, retry = false) {
  const s = String(prompt);
  const agent = /You are (\p{Lu}\p{L}+)[,.]/u.exec(s)?.[1];
  const task = /YOUR TASK: ([^\n]{1,60})/.exec(s)?.[1]?.trim();
  return { effort, ...(agent ? { agent } : {}), ...(task ? { task } : {}), ...(retry ? { retry: true } : {}) };
}

async function call(ai, m, prompt, effort, retry = false) {
  const out = await ai.run(m.model, {
    messages: [{ role: "user", content: String(prompt).slice(0, MAX_PROMPT) }],
    max_tokens: MAX_TOKENS,
    reasoning_effort: effort,
    ...m.options,
    ...(effort === "none" ? { chat_template_kwargs: { thinking: false } } : {}),
  }, { gateway: { id: GATEWAY_ID }, extraHeaders: { "cf-aig-metadata": JSON.stringify(callMetadata(prompt, effort, retry)) } });  // the binding has no metadata option: the gateway reads this header
  const text = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
  return typeof text === "string" ? text.trim() : "";
}

/**
 * One call through the AI binding and the gateway (the Worker side of /llm, and the Worker's own fallback). which: a key of MODELS.
 * When thinking used up the whole budget and nothing was answered, it asks again one step lower (high, low, none): the last step has no thinking, so it does answer.
 */
export async function runModel(ai, which, prompt) {
  const m = MODELS[which];
  if (!m) throw new Error(`unknown model ${which}`);
  const effort = reasoningEffort(prompt);
  // one step down at a time (high -> low -> none), so an SVG or a Markdown document keeps as much thinking as still fits and always gets an answer
  const ladder = { high: "low", low: "none" };
  let text = await call(ai, m, prompt, effort);
  for (let next = ladder[effort]; !text && next; next = ladder[next]) text = await call(ai, m, prompt, next, true);
  return text;
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
