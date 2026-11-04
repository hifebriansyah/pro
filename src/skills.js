// Skills: folders under skills/<name>/SKILL.md (the Agent Skills format: frontmatter name + description, then instructions).
// The prompt lists only name and description; the model reads the full text with the load_skill tool when a task matches.
// Pure: runs on Node and on Cloudflare Workers. Reading the folder is src/skills-fs.js (Node only).

/** Split a SKILL.md into { name, description, triggers, body }; null when it has no frontmatter name. `triggers:` is an optional comma list. */
export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const field = (k) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1].trim();
  const name = field("name");
  const triggers = (field("triggers") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  return name ? { name, description: field("description") ?? "", triggers, body: m[2].trim() } : null;
}

/** Skills from a list of {name, description, triggers, body} (the Worker gets this list from the deploy, which reads skills/ for it): Map name -> skill. */
export function skillsFromList(list) {
  return new Map(list.map((k) => [k.name, { triggers: [], description: "", ...k }]));
}

/** Skills whose trigger words appear in the user's message (whole words, any case): they are preloaded instead of left to the model's choice. */
export function matchingSkills(skills, message) {
  const text = ` ${String(message).toLowerCase()} `;
  return [...skills.values()].filter((k) => (k.triggers ?? []).some((t) => new RegExp(`[^\\p{L}\\p{N}]${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}\\p{N}]`, "u").test(text)));
}

/** The load_skill tool for agent.js: names come from the loaded map, so the model can never read other files. */
export function skillTool(skills) {
  return {
    run: async ({ name }) => {
      const skill = skills.get(name);
      if (!skill) throw new Error(`unknown skill "${name}"; available: ${[...skills.keys()].join(", ")}`);
      return skill.body;
    },
    usage: '{"name": "skill-name"}',
    does: "read a skill's full instructions; do this first when a skill below matches the task",
    skill: true, // the result is instructions: keep all of it (agent.js does not cut it)
  };
}
