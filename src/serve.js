// One /agent request, shared by bin/proxy.js (Node) and worker/pro.js (Cloudflare Worker): check the body, run the agent loop and
// report every step as an event, in the islam-gpt SSE shape the page already reads:
//   {type:"tool",phase:"start"|"end",name,args,error?}  {type:"image",...}  {type:"document",title,markdown}  {type:"mockup",title,html}  {type:"chunk",text}
//   {type:"references",data}  {type:"error",message}  {type:"done"}
import { agentChat } from "./agent.js";
import { randomDeviceId } from "./islam.js";
import { PROVIDERS, quranChat } from "./quran.js";

export const MAX_BODY = 20_000;

/** The JSON body of POST /agent, cleaned; throws "need JSON {question}" when it is not usable. */
export function parseAgentBody(text) {
  let b = null;
  try {
    b = JSON.parse(text);
  } catch {}
  if (!b || typeof b.question !== "string" || !b.question.trim()) throw new Error("need JSON {question}");
  return {
    question: b.question.slice(0, 12_000),
    deviceId: typeof b.deviceId === "string" ? b.deviceId.slice(0, 64) : undefined,
    persona: typeof b.persona === "string" ? b.persona.slice(0, 6000) : "",
    provider: PROVIDERS.includes(b.provider) ? b.provider : "islam", // which answer source: islam-gpt.org (default) or quran-gpt.netlify.app
    message: typeof b.message === "string" ? b.message.slice(0, 2000) : "", // the user's latest text: the skills' trigger words are matched on it
  };
}

const brief = (args) => String(args?.query ?? args?.url ?? args?.name ?? (args?.part ? `part ${args.part}` : "")).slice(0, 120);

/**
 * Run the agent for one request, calling send(event) as it goes. Always ends with {type:"done"}.
 * Options: send, signal, env (settings for the tools), skills, timeZone, chatFn (tests).
 * Resolves to a summary for the log: { tools: [{name, arg, error?}], steps, documents, mockups, images, chars, error?, aborted? }.
 */
export async function runAgent(body, { send, signal, env, skills, timeZone, chatFn } = {}) {
  const summary = { provider: body.provider, tools: [], steps: 0, documents: 0, mockups: 0, images: 0, chars: 0 };
  const deviceId = body.deviceId ?? randomDeviceId(); // no id sent: this request gets its own, never one shared by everybody (the parts of one answer use the same id)
  try {
    const res = await agentChat(body.question, {
      deviceId, message: body.message, persona: body.persona, env, skills, timeZone, signal, chatFn: chatFn ?? (body.provider === "quran" ? quranChat : undefined),
      onDocument: (d) => { summary.documents++; send({ type: "document", ...d }); },
      onFormats: () => { summary.formats = (summary.formats ?? 0) + 1; send({ type: "formats" }); },
      onMockup: (m) => { summary.mockups++; send({ type: "mockup", ...m }); },
      onToolStart: ({ name, args }) => send({ type: "tool", phase: "start", name, args }),
      onChunk: (text) => { summary.chars += text.length; send({ type: "chunk", text }); },
      onTool: ({ name, args, result, error, image }) => {
        const via = /"via":"(\w+)"/.exec(result ?? "")?.[1]; // the search backend that answered (src/tools.js)
        summary.tools.push({ name, arg: brief(args), ...(via ? { via } : {}), ...(error ? { error: String(error).slice(0, 120) } : {}) });
        send({ type: "tool", phase: "end", name, args, error, ...(name === "continue" ? { result } : {}) }); // how much a continuation added is shown; other tools' results stay private
        if (image) { summary.images++; send({ type: "image", ...image }); }
      },
    });
    summary.steps = res.steps;
    send({ type: "references", data: res.references });
  } catch (e) {
    if (signal?.aborted) summary.aborted = true; // the visitor left: nothing to tell them
    else {
      summary.error = String(e.message).slice(0, 200);
      send({ type: "error", message: e.message });
    }
  }
  send({ type: "done" });
  return summary;
}
