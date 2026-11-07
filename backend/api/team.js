// Vercel Function: POST /team behind the Worker (a team project run, streamed). Deployed by tools/deploy_backend.py, like api/agent.js.
import { backendTeam } from "../src/backend.js";
import { loadPersonas } from "../src/personas-fs.js";
import { loadSkills } from "../src/skills-fs.js";

const skills = [...loadSkills(new URL("../skills/", import.meta.url).pathname).values()];
const personas = loadPersonas(new URL("../personas/", import.meta.url).pathname);
const handle = (request) => backendTeam(request, process.env, { skills, personas });
export { handle as POST, handle as GET };
