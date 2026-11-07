// What a team project looks like: the steps in order, who does each, what they hand on, and which steps are a review that can send work back.
// Fixed on purpose: the free models are weak at inventing a plan, so the order of work is data and the models write the content of each step.
//   kind: "document" (Markdown) or "mockup" (an HTML screen); uses: the earlier steps whose result this one needs in full;
//   gate: { of: stepId } marks a review: the reviewer says approved or changes, and "changes" sends the author back once or twice;
//   minChars: a deliverable that comes back shorter than this is asked for once more, complete and richer (small free models write briefly);
//   primary (on the playbook): the step whose deliverable IS the result (the landing page itself), which the page opens and offers to download.
import { IDS } from "./roster.js";

export const PLAYBOOKS = {
  website: {
    id: "website",
    title: "Landing page atau website",
    about: "Hasilnya halaman jadi: brief, naskah, halaman HTML lengkap yang bisa dibuka dan diunduh, penilaian QA, dan daftar periksa peluncuran.",
    primary: "page",
    steps: [
      { id: "brief", agent: "po", title: "Brief halaman", kind: "document", uses: [],
        task: "Write a one-page brief for the page: who it is for, the single action a visitor should take, the key messages and proof, the list of sections in order, the tone, and the must-have content (prices, contact details, offers) with believable specifics. Concrete, no placeholders." },
      { id: "copy", agent: "copywriter", title: "Naskah halaman", kind: "document", uses: ["brief"],
        task: "Write the final copy for every section of the page, in order: the headline and sub-headline, the call-to-action button texts, the benefits, the services or prices (a table is fine), three realistic testimonials, five FAQ entries, and the contact section. Ready to paste into the page, in the brand's voice." },
      { id: "page", agent: "designer", title: "Halaman landing page", kind: "mockup", uses: ["brief", "copy"], minChars: 7000,
        task: "Build the COMPLETE landing page as ONE HTML file, using the copy word for word: a sticky header with navigation anchors, a hero with the headline and the main call to action, the benefit section, services or prices, testimonials, the FAQ (use <details>), a contact form with client-side validation and a clear success message (no network), and a footer. Mobile first and responsive, CSS variables, a polished modern look, accessible (labels, focus styles, contrast), a little inline JavaScript for the menu and the form. It is the real page, not a sketch: every section filled with the real copy, at least 250 lines. In your handoff note list the sections and what to check." },
      { id: "qa", agent: "qa", title: "Penilaian halaman", kind: "document", uses: ["brief", "copy"], gate: { of: "page" },
        task: "Review the finished page against the brief and the copy: is every section there, is the copy used as written, does the contact form validate and confirm, are the anchors right, does it work on a phone, is it accessible (labels, contrast, focus)? Write the checklist with what passes and what does not. Approved only if the page could go live today; otherwise list exactly which section or point must change." },
      { id: "launch", agent: "devops", title: "Daftar periksa peluncuran", kind: "document", uses: ["brief", "page"],
        task: "Write the go-live checklist for this page: where to host it (with the reason), domain and DNS steps, HTTPS, the form's real destination (an email or a form service) since the page itself sends nothing, analytics, SEO tags and a social share image, performance checks, and a simple uptime check. Numbered steps someone can follow." },
    ],
  },
  software: {
    id: "software",
    title: "Fitur software baru",
    about: "Dari ide sampai rencana siap dikerjakan: PRD, user story, desain, rencana teknis, tes, dan ringkasan pengiriman.",
    steps: [
      { id: "prd", agent: "po", title: "PRD", kind: "document", uses: [],
        task: "Write a concise Product Requirements Document for the project goal: the problem and who has it, the goal and how success is measured, the scope (in and out), the main user flows, and the open questions. Be concrete; no placeholders." },
      { id: "stories", agent: "ba", title: "User story dan kriteria penerimaan", kind: "document", uses: ["prd"],
        task: "From the PRD, write the user stories (As a ... I want ... so that ...) in priority order, each with acceptance criteria in Given/When/Then form, plus the business rules and edge cases the PRD implies. Keep it to what the PRD asks for." },
      { id: "design", agent: "designer", title: "Mockup layar utama", kind: "mockup", uses: ["stories"],
        task: "Design the main screen of this product as one working HTML mockup, following the user stories: believable content, the key states (empty, error), mobile first. In your handoff note, describe the layout and the components the engineer must build." },
      { id: "tech", agent: "engineer", title: "Rencana teknis dan kerangka kode", kind: "document", uses: ["stories", "design"],
        task: "Write the technical plan: architecture and stack choice with reasons, the data model, the API endpoints (method, path, request, response), how the screens in the design map to components, and a code skeleton for the core piece (complete enough to read and adapt, with error handling). Name the risks." },
      { id: "qa", agent: "qa", title: "Rencana tes dan review", kind: "document", uses: ["stories", "tech"], gate: { of: "tech" },
        task: "Review the technical plan against the user stories. First check each must-have story: does the plan cover it, with error handling, security and the data it needs? Then write the test plan (what to test at unit, integration and end-to-end level, with concrete cases for the acceptance criteria and the edge cases). Decide whether the plan is good enough to build from: approved only if every must-have story is covered; otherwise list exactly which stories or points are missing." },
      { id: "summary", agent: "delivery", title: "Ringkasan pengiriman", kind: "document", uses: ["prd", "stories", "tech", "qa"],
        task: "Write the delivery summary for the stakeholders: what will be built, a phased timeline with milestones, the team and who does what, the main risks and how they are handled, and the next three actions. Short and decisive." },
    ],
  },
  campaign: {
    id: "campaign",
    title: "Kampanye media sosial",
    about: "Dari tujuan sampai rencana tayang: brief merek, kalender konten, naskah, jadwal dan kanal, rencana komunitas, dan pengukuran.",
    steps: [
      { id: "brief", agent: "brand", title: "Brief merek dan kampanye", kind: "document", uses: [],
        task: "Write the campaign brief for the goal: the audience and what they care about, the single key message and tone of voice, the positioning against alternatives, the campaign idea with a hook, and what success looks like. Be specific; no placeholders." },
      { id: "calendar", agent: "planner", title: "Kalender konten", kind: "document", uses: ["brief"],
        task: "Turn the brief into a content calendar for four weeks: a table of date, channel, format, topic, and the call to action, with a mix of content types and a rhythm that suits the audience." },
      { id: "copy", agent: "copywriter", title: "Naskah dan caption", kind: "document", uses: ["brief", "calendar"],
        task: "Write the copy for the first two weeks of the calendar: the caption (and any on-image text or script) for each post, in the brand's voice, each with a hook, the message and a clear call to action, plus a few hashtag sets." },
      { id: "channels", agent: "smm", title: "Jadwal dan rencana kanal", kind: "document", uses: ["calendar", "copy"],
        task: "Plan how this runs on each channel: the best posting times and frequency, the formats and specs, the paid boost plan with a sample budget split, and the checklist for publishing each post." },
      { id: "community", agent: "community", title: "Rencana komunitas", kind: "document", uses: ["brief", "copy"],
        task: "Write the community plan: how to respond to comments and messages (with tone and example replies for the common questions and for complaints), how to turn followers into participants, and when to escalate." },
      { id: "measure", agent: "analyst", title: "Rencana pengukuran", kind: "document", uses: ["brief", "channels"], gate: { of: "copy" },
        task: "Write the measurement plan: the metrics per goal and per channel with targets, how and when to report, how to run simple tests on hooks and formats. Also review the copy against the brief: does every post carry the key message, the tone and a clear call to action, and is anything off-brand or risky? Approved only if it is ready to publish; otherwise list exactly which posts need what." },
    ],
  },
};

export const stepById = (playbook, id) => playbook.steps.find((s) => s.id === id) ?? null;

/** Pick a playbook from the goal's words (the page pre-selects it; the user can change it). */
export function suggestPlaybook(goal) {
  const page = /\b(landing ?page|one ?page|website|web ?site|situs web|halaman web|company profile|profil perusahaan|halaman (promo|produk|penjualan|depan)|laman)\b/i;
  if (page.test(String(goal ?? ""))) return "website";
  const social = /\b(kampanye|campaign|konten|content|instagram|tiktok|youtube|facebook|twitter|sosmed|media sosial|social media|caption|hashtag|followers?|brand|merek|promosi|iklan|ads?)\b/i;
  return social.test(String(goal ?? "")) ? "campaign" : "software";
}

// a playbook must be consistent: real people, unique ids, inputs that come earlier, a gate that points at an earlier step
export function validatePlaybook(pb) {
  const seen = new Set();
  if (pb.primary && !pb.steps.some((s) => s.id === pb.primary)) throw new Error(`${pb.id}: primary ${pb.primary} is not a step`);
  for (const s of pb.steps) {
    if (!IDS.includes(s.agent)) throw new Error(`${pb.id}/${s.id}: unknown agent ${s.agent}`);
    if (seen.has(s.id)) throw new Error(`${pb.id}: duplicate step ${s.id}`);
    for (const u of s.uses) if (!seen.has(u)) throw new Error(`${pb.id}/${s.id}: uses ${u}, which does not come earlier`);
    if (s.gate && !seen.has(s.gate.of)) throw new Error(`${pb.id}/${s.id}: gate of ${s.gate.of}, which does not come earlier`);
    if (!["document", "mockup"].includes(s.kind)) throw new Error(`${pb.id}/${s.id}: kind ${s.kind}`);
    seen.add(s.id);
  }
  return pb;
}
Object.values(PLAYBOOKS).forEach(validatePlaybook);
