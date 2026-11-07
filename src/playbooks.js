// What a team project looks like: the steps in order, who does each, what they hand on, and which steps are a review that can send work back.
// Fixed on purpose: the free models are weak at inventing a plan, so the order of work is data and the models write the content of each step.
//   kind: "document" (Markdown) or "mockup" (an HTML screen); uses: the earlier steps whose result this one needs in full;
//   gate: { of: stepId } marks a review: the reviewer says approved or changes, and "changes" sends the author back once or twice;
//   parts: 2: a new page is written in two halves, each inside the model's minute (src/team.js inParts);
//   maxChars: the size the deliverable must stay under (the free model gives up after about a minute, roughly 12,000 characters written);
//   minChars: a deliverable that comes back shorter than this is asked for once more, complete and richer (small free models write briefly);
//   edits: the earlier page this step finishes (it gets that whole file and returns the whole file; its code is checked before anyone sees it);
//   primary (on the playbook): the step whose deliverable IS the result (the landing page itself), which the page opens and offers to download.
import { IDS } from "./roster.js";

export const PLAYBOOKS = {
  website: {
    id: "website",
    title: "Landing page atau website",
    about: "Hasilnya halaman jadi: brief, naskah, design system (palet warna, tipografi, komponen), halaman HTML lengkap dengan JavaScript yang berfungsi, dengan susunan bagian yang dipilih tim sesuai topiknya, penilaian QA, dan daftar periksa peluncuran.",
    primary: "build",
    steps: [
      { id: "brief", agent: "po", title: "Brief halaman", kind: "document", uses: [],
        task: "Write the brief for this page, and decide its structure yourself from the topic: there is no standard template. Think about this business and its visitors: what they need to see, in what order, before they take the one action that matters, and what is special about this topic (a garage might need its service area and how booking works; a game studio its games and trailers; a clinic its doctors and hours; a wedding its schedule and RSVP). Then write: who it is for, the single main action, the key messages and the proof, the tone, and a numbered SECTIONS list of 5 to 8 sections in order, each with a short name, its purpose, what it shows and any interactive part it needs (a form, a calculator, tabs, a gallery, a map, a schedule, a filter...). Only these are fixed: a header with the name, one clear call to action, and a way for the visitor to act or get in touch; everything else is your choice for this topic. Believable specifics (names, prices, places, times), no placeholders." },
      { id: "copy", agent: "copywriter", title: "Naskah halaman", kind: "document", uses: ["brief"],
        task: "Write the final copy for every section in the brief's SECTIONS list, in that order, under the same section names: headings, body text, button texts, and whatever each section needs (items of a list or table, the questions and answers, quotes, steps, labels of a form). Follow the brief's structure exactly; do not add sections from a template it does not have. Ready to paste into the page, in the brand's voice." },
      { id: "design", agent: "designer", title: "Design system", kind: "document", uses: ["brief", "copy"], minChars: 2500,
        task: "Write the design system document for this landing page: the design direction and mood in two sentences; the color palette as a table of token name, HEX value and where it is used (primary, primary-hover, secondary, accent, background, surface, text, muted text, border, success, error), each pair checked for readable contrast; the typography (a heading and a body font from Google Fonts or system fonts, the size scale for h1 to caption with line heights and weights); the spacing scale (4px steps), border radius, shadows and breakpoints; and the components with their states (buttons, inputs, cards, navigation, badges: default, hover, focus, disabled, error). Real values only, no placeholders, so an engineer can copy the tokens straight into CSS variables. For a landing page, end with the same tokens as a Tailwind theme extension (colors, fontFamily, borderRadius) ready to paste into tailwind.config." },
      { id: "page", agent: "designer", title: "Halaman landing page", kind: "mockup", uses: ["brief", "copy", "design"], maxChars: 8000, parts: 2,
        task: "Build the COMPLETE landing page as ONE HTML file: exactly the sections of the brief's SECTIONS list, in its order, with the copy word for word, laid out in the way that suits each section's content and purpose (do not force every section into the same block), and the design system exactly. Add a header with the name and navigation to the sections, and a footer. Build it with common libraries: Tailwind CSS from the Play CDN (<script src=\"https://cdn.tailwindcss.com/3.4.17\"></script> in the head, followed by <script>tailwind.config = { theme: { extend: { ...the design system's colors, fontFamily and borderRadius... } } }</script>), styled with Tailwind utility classes rather than long custom CSS (a short <style> only for what Tailwind cannot do), Lucide icons written as <i data-lucide=\"menu\" class=\"w-6 h-6\"></i> (the engineer loads Lucide and draws them), and fonts from Google Fonts by <link>. Mobile first and responsive (sm:, md:, lg:), a polished modern look, accessible (labels, focus styles, contrast). Pictures are CSS gradients or inline SVG, never a placeholder image service (via.placeholder.com is gone and shows broken images). Use Lucide for icons; an inline <svg> needs explicit width and height attributes, or it fills the whole width. Build the markup of every interactive part the brief asks for (a form with labels, required fields and an empty status area; tabs; a calculator; a filter; a gallery...) and give each a clear id or data- attribute, because the engineer writes the JavaScript next; do not write the behaviour yourself. If the goal asks for a library such as three.js, put a sized container for it (for example <div id=\"scene\" style=\"height:60vh\">) where it belongs and say so in the handoff note. It is the real page, not a sketch: every section filled with the real copy, in about 5,000 to 8,000 characters (Tailwind classes make that enough; no long CSS, no repeated filler). In your handoff note list the sections and the ids the engineer must wire up." },
      { id: "build", agent: "engineer", title: "Halaman jadi dengan JavaScript", kind: "mockup", uses: ["page", "brief", "copy"], edits: "page",
        task: "You are the engineer who turns the designer's page into the finished, working product. Below is her COMPLETE file. Keep her design, sections and copy; with your changes you may fix what is broken (an icon without a size, a layout bug, a missing label or id) and add the markup and CSS the behaviour needs (an error message under a field, a toast). The page uses Tailwind and Lucide: style what you add with Tailwind classes, load Lucide with <script src=\"https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js\"></script> and call lucide.createIcons() in your code (again after you add icons). Then write the real JavaScript, clean and commented, for what THIS page has: read the brief and the designer's handoff note, and make every interactive part work (the navigation and its mobile menu if there is one: open and close, Escape and outside click, aria-expanded; every form: validate each field with a specific message next to it, block a bad submit, on success show a confirmation and reset; and whatever this topic needs: tabs, a calculator, a filter, a gallery, a countdown, a booking flow...). Do not add behaviour for parts the page does not have. Your JavaScript goes in one <script> before </body>: put it inside a DOMContentLoaded handler, look every element up first and do nothing when it is missing, so it can never throw; no network calls (a clearly named function stands in for each server call, with a TODO). If the client's goal names a library (three.js, GSAP, Chart.js, Leaflet...), use it for real: load it with a <script src> line from https://cdnjs.cloudflare.com with a pinned version (for example https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js) before your own script, build that part with it in the container the designer left, and never replace it with a lookalike made of CSS or a plain 2D canvas. In your handoff note list what works and what is left to connect." },
      { id: "qa", agent: "qa", title: "Penilaian halaman", kind: "document", uses: ["brief", "copy", "build"], gate: { of: "build" },
        task: "Review the finished page and its JavaScript against the brief: does it have the brief's sections in its order (and no unrelated template sections), is the copy used as written, does every interactive part the brief asked for work (the test run tells you what was clicked and sent), are the anchors right, does the script guard against missing elements, does it work on a phone, is it accessible (labels, contrast, focus)? Write the checklist with what passes and what does not. Approved only if the page could go live today; otherwise list exactly which section or point must change." },
      { id: "launch", agent: "devops", title: "Daftar periksa peluncuran", kind: "document", uses: ["brief", "build"],
        task: "Write the go-live checklist for this page: where to host it (with the reason), domain and DNS steps, HTTPS, where each form or interactive feature must really send its data (the page itself sends nothing) if it has any, analytics, SEO tags and a social share image, performance checks, and a simple uptime check. Numbered steps someone can follow." },
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
      { id: "build", agent: "engineer", title: "Prototipe berfungsi (kode)", kind: "mockup", uses: ["stories", "design", "tech"], edits: "design",
        task: "You are the engineer who turns the designer's mockup into a working prototype of the feature. Below is her COMPLETE file. Keep her design; with your changes add or change the markup and CSS the user stories need (more screens or states, a list, a dialog, error messages), and fix what is broken. Then implement the must-have user stories in JavaScript, following your technical plan: the data model as plain objects, the core logic as small named functions with comments, state saved in localStorage so it survives a reload, validation with clear messages, the empty and error states, keyboard support. Your JavaScript goes in one <script> before </body>: put it inside a DOMContentLoaded handler, look every element up first and do nothing when it is missing, so it can never throw; no network calls (a clearly named function stands in for each server call, with a TODO). If the client's goal names a library (three.js, GSAP, Chart.js, Leaflet...), use it for real: load it with a <script src> line from https://cdnjs.cloudflare.com with a pinned version (for example https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js) before your own script, build that part with it in the container the designer left, and never replace it with a lookalike made of CSS or a plain 2D canvas. In your handoff note list which user stories work and what is still stubbed." },
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
    if (s.edits) { // finishing an earlier page: it must be an earlier mockup the step reads, and it makes a page too
      const e = pb.steps.find((x) => x.id === s.edits);
      if (!seen.has(s.edits) || e.kind !== "mockup" || !s.uses.includes(s.edits) || s.kind !== "mockup") throw new Error(`${pb.id}/${s.id}: edits ${s.edits} must be an earlier mockup it uses`);
    }
    seen.add(s.id);
  }
  return pb;
}
Object.values(PLAYBOOKS).forEach(validatePlaybook);
