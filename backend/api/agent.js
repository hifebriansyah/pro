// Vercel Function (Node, Web-standard handlers): /agent behind the Worker. Deployed by tools/deploy_backend.py, which copies src/ and skills/ next to it.
import { backendHandle } from "../src/backend.js";
import { loadSkills } from "../src/skills-fs.js";

const skills = [...loadSkills(new URL("../skills/", import.meta.url).pathname).values()];
const handle = (request) => backendHandle(request, process.env, { skills });
export { handle as POST, handle as GET };
