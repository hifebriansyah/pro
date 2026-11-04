// Continuation. islam-gpt ends an answer at about 5,000 characters, even in the middle of a document, a page or a program. When a reply is cut off
// inside a <document>, a <mockup> or a code fence, the agent asks the model to carry on from the last character and joins the parts, so one
// request can produce a much longer result. Pure functions, no I/O: they run on Node and on Workers.

export const MAX_PARTS = 6; // the first answer plus up to five continuations: about 25,000 to 30,000 characters
export const MAX_CHARS = 60_000; // the whole joined reply
const TAIL_CHARS = 1200; // how much of the end the model is shown, so it can carry on exactly
const OVERLAP_MIN = 12; // a repeated start shorter than this is probably not a repeat
const OVERLAP_MAX = 400;

/** What a reply is still inside when it stops: "document", "mockup", "fence" (a code block), or null when it ended properly. */
export function openBlock(text) {
  if (text.lastIndexOf("<document") > text.lastIndexOf("</document>")) return "document";
  if (text.lastIndexOf("<mockup") > text.lastIndexOf("</mockup>")) return "mockup";
  const outside = text.replace(/<(document|mockup)\b[\s\S]*?<\/\1>/g, ""); // fences inside a finished document or mockup do not count
  return (outside.match(/^[ \t]*(?:```|~~~)/gm) ?? []).length % 2 ? "fence" : null;
}

const MAX_HEADINGS = 40, MAX_DECLARATIONS_CHARS = 3500;

const KEYWORD = "function\\*?|class|interface|enum|struct|trait|type|def|fn|func|const|let|var";
const TYPE_KEYWORD = "function\\*?|class|interface|enum|struct|trait|type|def|fn|func";
const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "try", "with"]);
const params = (line) => /\(([^)]*)\)/.exec(line)?.[1].replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * What a program has declared so far, with parameters: "csvEscape(value)", "class Inventory", "Order.constructor(inventory, items)". Top-level
 * functions, classes, types and constants, the methods of a class (and which class), functions and types in a wrapper; never local variables.
 */
export function declarations(text) {
  const out = new Set();
  let owner = null;
  for (const line of text.split("\n")) {
    let m;
    if ((m = new RegExp(`^(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:${KEYWORD})\\s+([A-Za-z_$][\\w$]*)`).exec(line))) {
      const isClass = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(line);
      owner = isClass ? m[1] : null;
      const p = isClass ? undefined : params(line);
      out.add(isClass ? `class ${m[1]}` : p !== undefined && /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|def|fn|func)\b/.test(line) ? `${m[1]}(${p})` : m[1]);
    } else if ((m = new RegExp(`^ {1,4}(?:export\\s+)?(?:async\\s+)?(?:${TYPE_KEYWORD})\\s+([A-Za-z_$][\\w$]*)`).exec(line))) {
      out.add(`${m[1]}(${params(line) ?? ""})`); // a function or type in a wrapper
    } else if ((m = /^ {2,4}(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>\[\],\s|]+)?\s*\{/.exec(line)) && !NOT_METHODS.has(m[1])) {
      out.add(`${owner ? owner + "." : ""}${m[1]}(${params(line)})`); // a method, with its class
    }
  }
  let list = [...out], size = 0;
  list = list.filter((d) => (size += d.length + 2) <= MAX_DECLARATIONS_CHARS);
  return list;
}

/**
 * A map of what is already written, so a continuation does not write it again or call it differently. The model only sees the last 1,200
 * characters, and without this it forgets a helper it wrote three parts ago and writes it twice, or calls a constructor with other parameters.
 * Lists the Markdown headings (outside code) and the declarations of a program (see declarations()).
 */
export function outline(text) {
  const prose = text.replace(/^[ \t]*(```|~~~)[\s\S]*?(?:^[ \t]*\1[^\n]*$|$(?![\s\S]))/gm, ""); // without the code blocks, whose "# comments" are not headings
  const headings = [...prose.matchAll(/^#{1,4}[ \t]+(.+?)[ \t]*$/gm)].map((m) => m[1]).slice(0, MAX_HEADINGS);
  return { headings, names: declarations(text) };
}

const CLOSE = { document: "</document>", mockup: "</mockup>", fence: "a closing ``` line" };
const PLACE = { document: "inside a <document> (Markdown)", mockup: "inside a <mockup> (HTML or SVG)", fence: "inside a fenced code block" };

/** The question that asks the model to carry on: the request, the end of what it wrote, and exact rules for the join. */
export function continuationPrompt({ request, text, kind, part }) {
  const { headings, names } = outline(text);
  const written = [headings.length ? `Sections: ${headings.join("; ")}` : "", names.length ? `Declarations already written (exact names and parameters; call them exactly like this): ${names.join("; ")}` : ""].filter(Boolean);
  const already = written.length ? `\n\nALREADY WRITTEN, DO NOT WRITE AGAIN (each section and each declaration below exists once: use it as written, never define it a second time and never change its parameters):\n${written.join("\n")}` : "";
  return `You were answering the request below and your reply was cut off by a length limit (part ${part - 1} stopped at the end shown). You are ${PLACE[kind]}.

REQUEST:
${request}

THE END OF WHAT YOU HAVE WRITTEN SO FAR (do not repeat it):
<<<
${text.slice(-TAIL_CHARS)}
>>>${already}

Continue from the exact next character after the last one above, even in the middle of a word, a line or a tag. Output ONLY the continuation: no introduction, no apology, no summary, no new opening tag or code fence, and do not restart or repeat anything already written. Write in the same language as the text above. Keep going until the ${kind === "fence" ? "code block" : kind} is complete, then close it with ${CLOSE[kind]}. If you are cut off again you will be asked to continue. If everything was already complete, reply with exactly DONE.`;
}

/**
 * The part of a continuation that really continues: what is left once a restart or a repeated start is removed. "" means stop (the model said
 * it is done, or it started over instead of carrying on).
 */
export function cleanContinuation(previous, piece, kind) {
  let s = piece.replace(/^(?:[ \t]*\r?\n)+/, "");
  if (/^\W*(?:DONE|SELESAI)\W*$/i.test(s.trim())) return "";
  if (kind === "fence") s = s.replace(/^[ \t]*(?:```|~~~)[\w+-]*[ \t]*\r?\n/, ""); // it reopened the fence it is already in
  if (kind === "document") s = s.replace(/^\s*<document\b[^>]*>\s*/, ""); // it reopened the tag it is already in
  if (kind === "mockup") {
    s = s.replace(/^\s*<mockup\b[^>]*>\s*/, "");
    if (/^\s*<!doctype|^\s*<html[\s>]/i.test(s) && /<html[\s>]/i.test(previous)) return ""; // started the page over: nothing here can be joined
  }
  for (let k = Math.min(OVERLAP_MAX, previous.length, s.length); k >= OVERLAP_MIN; k--) {
    if (previous.endsWith(s.slice(0, k))) { s = s.slice(k); break; } // it repeated the end of the last part before carrying on
  }
  return s;
}
