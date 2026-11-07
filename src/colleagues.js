// "Ask a colleague": a tool that lets one professional put a specific question to another while writing an answer. The colleague answers in
// their own voice from their own persona, briefly, and cannot ask somebody else in turn (one level deep, so it can never loop).
import { ROSTER, byId, findColleague } from "./roster.js";

const ANSWER_CHARS = 1500;

export function colleagueTool({ askerId, personas, chatFn, onConsult }) {
  const asker = byId(askerId);
  const others = ROSTER.filter((p) => p.id !== askerId);
  let used = 0;
  return {
    usage: '{"colleague": "name or role, e.g. Sinta or QA", "question": "one specific question"}',
    does: `ask a teammate one specific question and get a short answer from their specialty (${others.map((p) => `${p.name}: ${p.role}`).join("; ")}). Use it only when their expertise clearly improves your answer, at most twice, never for greetings or simple questions. Call it like the other tools, for example: TOOL: {"name": "ask_colleague", "args": {"colleague": "Sinta", "question": "Which edge cases matter most for a payment form?"}}`,
    async run({ colleague, question } = {}, { signal } = {}) {
      const target = findColleague(colleague, askerId);
      if (!target) throw new Error(`no teammate called "${String(colleague).slice(0, 40)}"; choose one of: ${others.map((p) => p.name).join(", ")}`);
      const q = String(question ?? "").trim().slice(0, 800);
      if (!q) throw new Error("the question is empty");
      if (++used > 2) throw new Error("you have already asked two colleagues; answer with what you have");
      const persona = personas?.get(target.id);
      if (!persona) throw new Error(`${target.name} is not available`);
      onConsult?.({ phase: "start", from: askerId, to: target.id, toName: target.name });
      try {
        const prompt = `${persona}\n\nYour colleague ${asker?.name ?? "a teammate"} (${asker?.role ?? "team"}) asks you a quick question while working. Answer from your own specialty, concretely and briefly (at most about 120 words), in the language of the question. Do not use tools and do not ask anybody else.\n\nQuestion from ${asker?.name ?? "your colleague"}: ${q}`;
        const res = await chatFn(prompt, { signal });
        return { colleague: target.name, role: target.role, answer: String(res.text ?? "").trim().slice(0, ANSWER_CHARS) };
      } finally {
        onConsult?.({ phase: "end", from: askerId, to: target.id, toName: target.name });
      }
    },
  };
}
