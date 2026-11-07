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
    about: "Hasilnya halaman jadi: brief, naskah, design system (palet warna, tipografi, komponen), halaman HTML lengkap dengan JavaScript yang berfungsi (menu, form, FAQ) yang bisa dibuka dan diunduh, penilaian QA, dan daftar periksa peluncuran.",
    primary: "build",
    steps: [
      { id: "brief", agent: "po", title: "Brief halaman", kind: "document", uses: [],
        task: "Write a one-page brief for the page: who it is for, the single action a visitor should take, the key messages and proof, the list of sections in order, the tone, and the must-have content (prices, contact details, offers) with believable specifics. Concrete, no placeholders." },
      { id: "copy", agent: "copywriter", title: "Naskah halaman", kind: "document", uses: ["brief"],
        task: "Write the final copy for every section of the page, in order: the headline and sub-headline, the call-to-action button texts, the benefits, the services or prices (a table is fine), three realistic testimonials, five FAQ entries, and the contact section. Ready to paste into the page, in the brand's voice." },
      { id: "design", agent: "designer", title: "Design system", kind: "document", uses: ["brief", "copy"], minChars: 2500,
        task: "Write the design system document for this landing page: the design direction and mood in two sentences; the color palette as a table of token name, HEX value and where it is used (primary, primary-hover, secondary, accent, background, surface, text, muted text, border, success, error), each pair checked for readable contrast; the typography (a heading and a body font from Google Fonts or system fonts, the size scale for h1 to caption with line heights and weights); the spacing scale (4px steps), border radius, shadows and breakpoints; and the components with their states (buttons, inputs, cards, navigation, badges: default, hover, focus, disabled, error). Real values only, no placeholders, so an engineer can copy the tokens straight into CSS variables." },
      { id: "page", agent: "designer", title: "Halaman landing page", kind: "mockup", uses: ["brief", "copy", "design"], minChars: 7000,
        task: "Build the COMPLETE landing page as ONE HTML file, using the copy word for word and the design system exactly (declare its colors, fonts, spacing and radius as CSS variables with the same values and build the components as it describes): a sticky header with navigation anchors, a hero with the headline and the main call to action, the benefit section, services or prices, testimonials, the FAQ (use <details>), a contact form (labels, required fields, an empty status area for messages), and a footer. You own the markup and the CSS: mobile first and responsive, CSS variables, a polished modern look, accessible (labels, focus styles, contrast). Every inline <svg> icon needs explicit width and height attributes (for example width=\"24\" height=\"24\"), or it fills the whole width. Give every interactive part a clear id or data- attribute (menu button, form, FAQ, status area) because the engineer writes the JavaScript next; do not write the behaviour yourself. If the goal asks for a library such as three.js, put a sized container for it (for example <div id=\"scene\" style=\"height:60vh\">) where it belongs and say so in the handoff note. It is the real page, not a sketch: every section filled with the real copy, at least 250 lines. In your handoff note list the sections and the ids the engineer must wire up." },
      { id: "build", agent: "engineer", title: "Halaman jadi dengan JavaScript", kind: "mockup", uses: ["page", "copy"], script: { into: "page" },
        task: "Write the JavaScript for the designer's page: ONLY the code, which is placed in a <script> before </body> of the page (never write or repeat the HTML and CSS). Use the ids, data attributes, form fields and buttons listed under the designer's page, exactly as named there; never invent an id that is not listed. Clean, commented code: the mobile menu (open and close, Escape and outside click, aria-expanded), smooth scrolling and the active section highlighted while scrolling, the contact form (validate every field with a specific message next to it, block a bad submit, on success show the confirmation and reset the form, keep a clear TODO where a real endpoint would be called), the FAQ and any other interactive part, and a back to top button. Wrap everything in one DOMContentLoaded handler and look every element up first, doing nothing when it is missing, so the code can never throw. No network calls." + " If the client's goal names a library (three.js, GSAP, Chart.js, Leaflet...), use it for real: load it from your code by creating a script element with a pinned cdnjs address (for example https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js), start that part in its onload handler, and render into the container the designer left for it. Never replace it with a lookalike made of CSS or a plain 2D canvas." + " In your handoff note list the behaviours you wired and anything left to connect." },
      { id: "qa", agent: "qa", title: "Penilaian halaman", kind: "document", uses: ["brief", "copy", "build"], gate: { of: "build" },
        task: "Review the finished page and its JavaScript against the brief and the copy: is every section there, is the copy used as written, does the menu work, does the contact form validate each field and confirm, are the anchors right, does the script guard against missing elements, does it work on a phone, is it accessible (labels, contrast, focus)? Write the checklist with what passes and what does not. Approved only if the page could go live today; otherwise list exactly which section or point must change." },
      { id: "launch", agent: "devops", title: "Daftar periksa peluncuran", kind: "document", uses: ["brief", "build"],
        task: "Write the go-live checklist for this page: where to host it (with the reason), domain and DNS steps, HTTPS, the form's real destination (an email or a form service) since the page itself sends nothing, analytics, SEO tags and a social share image, performance checks, and a simple uptime check. Numbered steps someone can follow." },
    ],
  },
  software: {
    id: "software",
    title: "Fitur software baru",
    about: "Dari ide sampai prototipe yang jalan: PRD, user story, desain, rencana teknis, kode prototipe (HTML, CSS, JavaScript) yang bisa dicoba, tes, dan ringkasan pengiriman.",
    primary: "build",
    steps: [
      { id: "prd", agent: "po", title: "PRD", kind: "document", uses: [],
        task: "Write a concise Product Requirements Document for the project goal: the problem and who has it, the goal and how success is measured, the scope (in and out), the main user flows, and the open questions. Be concrete; no placeholders." },
      { id: "stories", agent: "ba", title: "User story dan kriteria penerimaan", kind: "document", uses: ["prd"],
        task: "From the PRD, write the user stories (As a ... I want ... so that ...) in priority order, each with acceptance criteria in Given/When/Then form, plus the business rules and edge cases the PRD implies. Keep it to what the PRD asks for." },
      { id: "design", agent: "designer", title: "Mockup layar utama", kind: "mockup", uses: ["stories"],
        task: "Design the main screen of this product as one working HTML mockup, following the user stories: believable content, the key states (empty, error), mobile first. In your handoff note, describe the layout and the components the engineer must build." },
      { id: "tech", agent: "engineer", title: "Rencana teknis dan kerangka kode", kind: "document", uses: ["stories", "design"],
        task: "Write the technical plan: architecture and stack choice with reasons, the data model, the API endpoints (method, path, request, response), how the screens in the design map to components, and a code skeleton for the core piece (complete enough to read and adapt, with error handling). Name the risks." },
      { id: "build", agent: "engineer", title: "Prototipe berfungsi (kode)", kind: "mockup", uses: ["stories", "design", "tech"], script: { into: "design" },
        task: "Write the JavaScript that makes the designer's mockup a working prototype of the feature: ONLY the code, which is placed in a <script> before </body> of the mockup (never write or repeat the HTML and CSS). Use the ids, data attributes, form fields and buttons listed under the design, exactly as named there; never invent an id that is not listed. Implement the user stories following your technical plan: the data model as plain objects, the core logic as small named functions with comments, state saved in localStorage, input validation with clear messages, the empty and error states, keyboard support. Wrap everything in one DOMContentLoaded handler and look every element up first so the code can never throw. No network (a clearly named function stands in for each API call from your plan)." + " If the client's goal names a library (three.js, GSAP, Chart.js, Leaflet...), use it for real: load it from your code by creating a script element with a pinned cdnjs address (for example https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js), start that part in its onload handler, and render into the container the designer left for it. Never replace it with a lookalike made of CSS or a plain 2D canvas." + " In your handoff note list which user stories work and what is still stubbed." },
      { id: "qa", agent: "qa", title: "Rencana tes dan review", kind: "document", uses: ["stories", "tech", "build"], gate: { of: "build" },
        task: "Review the technical plan and the prototype code against the user stories. First check each must-have story: does the plan cover it, with error handling, security and the data it needs? Then write the test plan (what to test at unit, integration and end-to-end level, with concrete cases for the acceptance criteria and the edge cases). Read the code: does each must-have story work, are inputs validated, can any function throw, is state saved. Approved only if every must-have story works in the prototype; otherwise list exactly which stories or points are missing." },
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
