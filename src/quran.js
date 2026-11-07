// The second answer source: quran-gpt.netlify.app, a plain request and response (no stream, no device id).
//   POST /api/gemini  {"prompt": "..."}  ->  {"response": "...", "provider": "openai"}
// Same shape as chatBuffered in islam.js ({text, references}), so the agent, the tools and the continuation of cut-off answers work on it unchanged.
export const QURAN_URL = "https://quran-gpt.netlify.app/api/gemini";

export async function quranChat(question, { signal, baseUrl = QURAN_URL, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: question }), signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`quran-gpt: HTTP ${res.status}`);   // worth one more try
      if (!res.ok) throw Object.assign(new Error(`quran-gpt: HTTP ${res.status}`), { final: true });
      const data = await res.json().catch(() => null);
      const text = typeof data?.response === "string" ? data.response.trim() : "";
      if (!text) throw Object.assign(new Error("quran-gpt: empty answer"), { final: true });
      return { text, references: [] };
    } catch (e) {
      lastError = e;
      if (e.final || signal?.aborted) break;
    }
  }
  throw lastError;
}

export const PROVIDERS = ["islam", "quran", "deepseek", "qwen"]; // deepseek and qwen: src/workersai.js
