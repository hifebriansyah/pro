import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../tools/stamp_modules.py", import.meta.url).pathname;
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const sha8 = (text) => createHash("sha1").update(text).digest("hex").slice(0, 8);
const skip = !hasPython && "no python3";

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), "stamp-mod-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const run = (dir) => execFileSync("python3", [script, dir], { stdio: "pipe" });
const read = (dir, f) => readFileSync(join(dir, f), "utf8");

test("stamp_modules: every relative import gets the hash of the stamped file it points at, up the whole chain", { skip }, () => {
  const dir = site({
    "index.html": '<script>const { a } = await import("./office/office.js"); import("jsdom"); fetch("./data.json")</script>',
    "office/office.js": 'import { x } from "./core.js";\nimport { y } from "../src/roster.js";\nexport const a = x + y;',
    "office/core.js": "export const x = 1;",
    "src/roster.js": "export const y = 2;",
  });
  run(dir);
  const core = sha8("export const x = 1;");
  const roster = sha8("export const y = 2;");
  const office = `import { x } from "./core.js?v=${core}";\nimport { y } from "../src/roster.js?v=${roster}";\nexport const a = x + y;`;
  assert.equal(read(dir, "office/office.js"), office);
  assert.equal(read(dir, "office/core.js"), "export const x = 1;");  // no imports: left as it is
  assert.match(read(dir, "index.html"), new RegExp(`import\\("\\./office/office\\.js\\?v=${sha8(office)}"\\)`));
  assert.match(read(dir, "index.html"), /import\("jsdom"\)/);  // a package name is not a file of the site
  assert.match(read(dir, "index.html"), /fetch\("\.\/data\.json"\)/);
});

test("stamp_modules: a change deep in the tree changes the address of every module above it, and a second run changes nothing", { skip }, () => {
  const files = (core) => ({ "index.html": 'import("./a.js")', "a.js": 'import "./b.js";', "b.js": 'import { c } from "./c.js";', "c.js": core });
  const one = site(files("export const c = 1;")), two = site(files("export const c = 2;"));
  run(one); run(two);
  for (const f of ["index.html", "a.js", "b.js"]) assert.notEqual(read(one, f), read(two, f), f);
  const before = read(one, "index.html"), b = read(one, "b.js");
  run(one);
  assert.equal(read(one, "index.html"), before);
  assert.equal(read(one, "b.js"), b);
});

test("stamp_modules: stops on an import cycle, a missing file, or no directory", { skip }, () => {
  const cycle = spawnSync("python3", [script, site({ "index.html": "", "a.js": 'import "./b.js";', "b.js": 'import "./a.js";' })]);
  assert.notEqual(cycle.status, 0);
  assert.match(cycle.stderr.toString(), /import cycle/);
  const missing = spawnSync("python3", [script, site({ "index.html": 'import("./nope.js")' })]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr.toString(), /not in the site/);
  assert.notEqual(spawnSync("python3", [script]).status, 0);
});
