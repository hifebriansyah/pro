// Vercel Function (Node, Web-standard handlers): /agent behind the Worker. Deployed by tools/deploy_backend.py, which copies src/, skills/ and personas/ next to it.
import { backendHandle } from "../src/backend.js";
import { loadPersonas } from "../src/personas-fs.js";
import { loadSkills } from "../src/skills-fs.js";

const skills = [...loadSkills(new URL("../skills/", import.meta.url).pathname).values()];
const personas = loadPersonas(new URL("../personas/", import.meta.url).pathname);
const handle = (request) => backendHandle(request, process.env, { skills, personas });
export { handle as POST, handle as GET };
