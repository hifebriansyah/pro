// Read personas/<file>.md for the roster from disk (Node only: the backend deploy ships the folder next to the code, like the skills).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROSTER } from "./roster.js";

export const PERSONAS_DIR = new URL("../personas/", import.meta.url).pathname;

/** id -> the persona text ("You are Bima, ..."); a missing file is left out. */
export function loadPersonas(dir = PERSONAS_DIR) {
  const map = new Map();
  for (const p of ROSTER) {
    try { map.set(p.id, readFileSync(join(dir, `${FILES[p.id]}.md`), "utf8").trim()); } catch {}
  }
  return map;
}
// the page's AGENTS name each persona file by the role, not by the id
const FILES = { po: "po", ba: "ba", engineer: "engineer", qa: "qa", designer: "designer", devops: "devops", delivery: "delivery", brand: "brand", planner: "planner", smm: "smm", community: "community", copywriter: "copywriter", analyst: "analyst" };
