// The team: who the professionals are, for the server (the page keeps its own list with colours and photos; a test keeps the two in step).
// Pure data and lookups, no DOM and no node: modules, so the Worker, the backend and the tests can all use it.
export const ROSTER = [
  { id: "po", name: "Raka", group: "Software House", role: "Product Owner" },
  { id: "ba", name: "Nadia", group: "Software House", role: "Business Analyst" },
  { id: "engineer", name: "Bima", group: "Software House", role: "Software Engineer" },
  { id: "qa", name: "Sinta", group: "Software House", role: "QA / QC Engineer" },
  { id: "designer", name: "Kirana", group: "Software House", role: "UI / UX Designer" },
  { id: "devops", name: "Fajar", group: "Software House", role: "DevOps / SRE" },
  { id: "delivery", name: "Citra", group: "Software House", role: "Delivery Manager" },
  { id: "brand", name: "Arya", group: "Social Media", role: "Brand Strategist" },
  { id: "planner", name: "Laras", group: "Social Media", role: "Content Planner" },
  { id: "smm", name: "Tara", group: "Social Media", role: "Social Media Manager" },
  { id: "community", name: "Bayu", group: "Social Media", role: "Community Manager" },
  { id: "copywriter", name: "Salsa", group: "Social Media", role: "Copywriter" },
  { id: "analyst", name: "Rendra", group: "Social Media", role: "Social Media Analyst" },
];
export const IDS = ROSTER.map((p) => p.id);
export const byId = (id) => ROSTER.find((p) => p.id === id) ?? null;

// words people (and models) use for a role, beyond its name: "QA", "designer", "product owner", "devops", "copy"...
const ALIASES = {
  po: ["product owner", "owner", "produk", "product"], ba: ["business analyst", "analis bisnis", "analyst bisnis", "ba"],
  engineer: ["software engineer", "developer", "programmer", "dev", "engineer", "backend", "frontend", "teknis"],
  qa: ["qa", "qc", "tester", "testing", "quality", "kualitas", "pengujian"], designer: ["designer", "design", "desain", "ui", "ux", "ui/ux"],
  devops: ["devops", "sre", "infrastruktur", "infrastructure", "deploy", "ci/cd"], delivery: ["delivery manager", "delivery", "project manager", "pm", "manajer proyek"],
  brand: ["brand", "brand strategist", "merek", "strategi merek"], planner: ["content planner", "planner", "konten", "kalender konten", "perencana"],
  smm: ["social media manager", "smm", "social media", "sosmed"], community: ["community manager", "community", "komunitas"],
  copywriter: ["copywriter", "copy", "penulis", "writer"], analyst: ["social media analyst", "analis media sosial", "analytics", "analitik", "data"],
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}/ ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Find a colleague by first name, id, or a word for their role. Never the asker. Returns the roster entry or null. */
export function findColleague(query, askerId) {
  const q = norm(query);
  if (!q) return null;
  const others = ROSTER.filter((p) => p.id !== askerId);
  return (
    others.find((p) => norm(p.name) === q || p.id === q) ??
    others.find((p) => q.split(" ").includes(norm(p.name))) ??
    others.find((p) => ALIASES[p.id].some((a) => a === q)) ??
    others.find((p) => norm(p.role) === q) ??
    others.find((p) => ALIASES[p.id].some((a) => a.length > 2 && (q.includes(a) || a.includes(q)))) ??
    null
  );
}
