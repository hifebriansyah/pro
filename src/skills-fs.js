// Read skills/<name>/SKILL.md from disk (Node only: bin/ and the deploy; the Worker gets its skills from the deploy).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkill } from "./skills.js";

export const SKILLS_DIR = new URL("../skills/", import.meta.url).pathname;

/** Read every skill under `dir` (read on each call, so edits apply without a restart): Map name -> skill. */
export function loadSkills(dir = SKILLS_DIR) {
  const skills = new Map();
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const skill = parseSkill(readFileSync(join(dir, e.name, "SKILL.md"), "utf8"));
      if (skill) skills.set(skill.name, skill);
    } catch {} // a folder without SKILL.md is not a skill
  }
  return skills;
}
