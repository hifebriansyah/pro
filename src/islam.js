// Client for https://www.islam-gpt.org: POST /api/questions gives a shareId, GET /api/stream/<shareId> streams the answer as SSE.
// Stream events are JSON in `data:` lines: {type:"references",data:[...]}, {type:"chunk",text}, {type:"done"}.

const ENV = typeof process !== "undefined" ? process.env : {}; // Workers have no process
export const BASE_URL = ENV.ISLAM_BASE_URL ?? "https://www.islam-gpt.org";
// an anonymous id, random for each run unless ISLAM_DEVICE_ID is set
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[n % 62]).join("");
// made on first use, not when the file loads: Workers do not allow random values in the global scope
let defaultId;
export const defaultDeviceId = () => (defaultId ??= ENV.ISLAM_DEVICE_ID ?? randomId());

/** POST a question; resolves to the shareId of its answer stream. */
export async function ask(question, { deviceId = defaultDeviceId(), baseUrl = BASE_URL, signal } = {}) {
  const res = await fetch(`${baseUrl}/api/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, question }),
    signal,
  });
  if (!res.ok) throw new Error(`POST /api/questions: HTTP ${res.status}`);
  const { shareId } = await res.json();
  if (!shareId) throw new Error("POST /api/questions: no shareId in the response");
  return shareId;
}

/** Turn a stream of text chunks into SSE events: the JSON of each `data:` line group (raw string if it is not JSON). */
export async function* parseSSE(chunks) {
  let buf = "";
  const emit = (block) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return undefined;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  };
  for await (const chunk of chunks) {
    buf += chunk;
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop();
    for (const b of blocks) {
      const ev = emit(b.replace(/\r/g, ""));
      if (ev !== undefined) yield ev;
    }
  }
  const last = emit(buf.replace(/\r/g, ""));
  if (last !== undefined) yield last;
}

/** GET the answer stream of a shareId; yields its events until the server closes it (or `done`). */
export async function* stream(shareId, { baseUrl = BASE_URL, signal } = {}) {
  const res = await fetch(`${baseUrl}/api/stream/${shareId}`, { headers: { Accept: "text/event-stream" }, signal });
  if (!res.ok) throw new Error(`GET /api/stream/${shareId}: HTTP ${res.status}`);
  for await (const ev of parseSSE(res.body.pipeThrough(new TextDecoderStream()))) {
    yield ev;
    if (ev?.type === "done") return;
  }
}

/** Ask and read the whole answer: { shareId, text, references }. `onChunk(text)` is called as the answer arrives. */
export async function chat(question, { onChunk, ...opts } = {}) {
  const shareId = await ask(question, opts);
  let text = "";
  let references = [];
  for await (const ev of stream(shareId, opts)) {
    if (ev.type === "chunk") {
      text += ev.text;
      onChunk?.(ev.text);
    } else if (ev.type === "references") {
      references = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
    }
  }
  return { shareId, text, references };
}
