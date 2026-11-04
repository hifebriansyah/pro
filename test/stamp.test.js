import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../tools/stamp_icons.py", import.meta.url).pathname;
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const sha8 = (text) => createHash("sha1").update(text).digest("hex").slice(0, 8);

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), "stamp-"));
  mkdirSync(join(dir, "icons"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const stamp = (dir) => execFileSync("python3", [script, dir], { stdio: "pipe" });

test("stamp_icons: adds ?v=<sha1 of the file>, replaces an old one, is repeatable, leaves other addresses alone", { skip: !hasPython && "no python3" }, () => {
  const dir = site({
    "logo.svg": "<svg>one</svg>",
    "icons/favicon.png": "png-bytes",
    "index.html": '<link href="logo.svg"><link href="icons/favicon.png?v=deadbeef"><a href="https://x.org/other/logo.svg">x</a><img src="personas/fira.jpg">',
    "manifest.webmanifest": '{"icons":[{"src":"icons/favicon.png"}]}',
  });
  stamp(dir);
  const svg = sha8("<svg>one</svg>"), png = sha8("png-bytes");
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.equal(html, `<link href="logo.svg?v=${svg}"><link href="icons/favicon.png?v=${png}"><a href="https://x.org/other/logo.svg">x</a><img src="personas/fira.jpg">`);
  assert.equal(readFileSync(join(dir, "manifest.webmanifest"), "utf8"), `{"icons":[{"src":"icons/favicon.png?v=${png}"}]}`);
  stamp(dir); // running it again changes nothing
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), html);
  writeFileSync(join(dir, "logo.svg"), "<svg>two</svg>"); // a new picture gets a new address, the others keep theirs
  stamp(dir);
  const again = readFileSync(join(dir, "index.html"), "utf8");
  assert.match(again, new RegExp(`logo\\.svg\\?v=${sha8("<svg>two</svg>")}`));
  assert.match(again, new RegExp(`favicon\\.png\\?v=${png}`));
});

test("stamp_icons: the share image's absolute address on this site (host from CNAME) is stamped; other hosts are not", { skip: !hasPython && "no python3" }, () => {
  const dir = site({
    CNAME: "faith.example.org\n",
    "og-image.png": "og-bytes",
    "index.html": '<meta property="og:image" content="https://faith.example.org/og-image.png"><meta content="https://elsewhere.org/og-image.png"><meta content="https://faith.example.org/og-image.png?v=00000000">',
    "manifest.webmanifest": "{}",
  });
  stamp(dir);
  const v = sha8("og-bytes");
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), `<meta property="og:image" content="https://faith.example.org/og-image.png?v=${v}"><meta content="https://elsewhere.org/og-image.png"><meta content="https://faith.example.org/og-image.png?v=${v}">`);
});

test("stamp_icons: fails loudly when an icon the page names is missing", { skip: !hasPython && "no python3" }, () => {
  const dir = site({ "index.html": '<link href="logo.svg">', "manifest.webmanifest": "{}" });
  assert.throws(() => stamp(dir), /logo\.svg/);
});

test("the repo's own pages carry the current hashes (run tools/make_icons.py or tools/stamp_icons.py when an icon changes)", () => {
  const root = new URL("..", import.meta.url).pathname;
  for (const page of ["index.html", "manifest.webmanifest"]) {
    const text = readFileSync(join(root, page), "utf8");
    for (const [, file, v] of text.matchAll(/(?<=["']|pro\.situs\.id\/)((?:logo\.svg|og-image\.png|icons\/[a-z0-9-]+\.png))\?v=([0-9a-f]+)(?=["'])/g)) {
      assert.equal(v, createHash("sha1").update(readFileSync(join(root, file))).digest("hex").slice(0, 8), `${page}: ${file} has a stale ?v=`);
    }
  }
});
