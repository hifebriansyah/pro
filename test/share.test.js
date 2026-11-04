import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(root + f, "utf8");
const html = read("index.html");
const manifest = JSON.parse(read("manifest.webmanifest"));
const host = read("CNAME").trim();
const meta = (attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`).exec(html)?.[1];

test("share image: og-image.png exists, 1200x630, a PNG, light enough to be fetched", () => {
  const png = readFileSync(root + "og-image.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]); // the width and height in the IHDR chunk
  assert.ok(png.length < 600 * 1024, `og-image.png is ${png.length} bytes`);
});

test("share tags: Open Graph and Twitter tags are complete and the image address is absolute, on this site, versioned", () => {
  for (const [attr, name] of [["property", "og:type"], ["property", "og:site_name"], ["property", "og:title"], ["property", "og:description"], ["property", "og:url"], ["property", "og:image"], ["property", "og:image:alt"], ["name", "twitter:card"], ["name", "twitter:title"], ["name", "twitter:description"], ["name", "twitter:image"]]) {
    assert.ok(meta(attr, name), `missing ${name}`);
  }
  assert.equal(meta("property", "og:image:width"), "1200");
  assert.equal(meta("property", "og:image:height"), "630");
  assert.equal(meta("name", "twitter:card"), "summary_large_image");
  assert.match(meta("property", "og:image"), new RegExp(`^https://${host.replace(/\./g, "\\.")}/og-image\\.png\\?v=[0-9a-f]{8}$`));
  assert.equal(meta("name", "twitter:image"), meta("property", "og:image"));
  assert.equal(meta("property", "og:url"), `https://${host}/`);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://${host.replace(/\./g, "\\.")}/">`));
});

test("one tagline everywhere: description, share tags, manifest, the picture and the page title name", () => {
  const tagline = meta("name", "description");
  assert.ok(tagline);
  for (const [attr, name] of [["property", "og:description"], ["name", "twitter:description"]]) assert.equal(meta(attr, name), tagline, name);
  assert.equal(manifest.description, tagline);
  assert.match(meta("property", "og:image:alt"), new RegExp(tagline));
  const lines = /TAGLINE = \[(.*?)\]/.exec(read("tools/make_icons.py"))[1].match(/"([^"]*)"/g).map((x) => x.slice(1, -1)); // the words drawn in the picture
  assert.equal(lines.join(" "), tagline);
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], manifest.name);
  assert.equal(meta("property", "og:title"), manifest.name);
});
