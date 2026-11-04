import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const decls = (block) => block.split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean).sort();

test("theme CSS: the dark set used by the system setting and by a chosen dark theme is identical", () => {
  const bySystem = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(html)?.[1];
  const byChoice = /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(html)?.[1];
  assert.ok(bySystem && byChoice, "both dark blocks exist");
  assert.deepEqual(decls(bySystem), decls(byChoice));
  assert.ok(decls(byChoice).some((d) => d.startsWith("color-scheme: dark")));
  const light = /:root \{\s*color-scheme: light;([^}]*)\}/.exec(html)?.[1];
  assert.ok(light, "the light set declares color-scheme: light");
  // every variable the light set defines, the dark set defines too
  const names = (list) => list.map((d) => d.split(":")[0]).filter((n) => n.startsWith("--")).sort();
  assert.deepEqual(names(decls(byChoice)), names(decls(light)));
});

test("theme: the script in <head> restores a saved choice before the styles, with the same key as the page script", () => {
  const head = /<script>try \{ var t = localStorage\.getItem\("([^"]+)"\)/.exec(html);
  assert.ok(head, "an early script reads the saved theme");
  assert.ok(html.indexOf(head[0]) < html.indexOf("<style>"), "it runs before the styles");
  assert.match(html, new RegExp(`const THEME_KEY = "${head[1]}"`));
  assert.match(html, /t === "light" \|\| t === "dark"/); // only the two known values are accepted
});

test("theme: the sun / moon button is in the sidebar header and the address-bar colours match the meta tags", () => {
  assert.match(html, /<aside class="side">\s*<header>\s*<h1>[^<]*<\/h1>\s*<button class="icon-btn" id="theme"/);
  const light = /<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: light\)">/.exec(html)?.[1];
  const dark = /<meta name="theme-color" content="(#[0-9a-f]{6})" media="\(prefers-color-scheme: dark\)">/.exec(html)?.[1];
  assert.match(html, new RegExp(`const THEME_COLOR = \\{ light: "${light}", dark: "${dark}" \\}`));
  assert.ok(new RegExp(`--panel-2: ${dark};`, "i").test(/:root\[data-theme="dark"\] \{([^}]*)\}/.exec(html)[1]), "the dark address-bar colour is the dark header colour");
  assert.ok(new RegExp(`--panel-2: ${light};`, "i").test(/:root \{\s*color-scheme: light;([^}]*)\}/.exec(html)[1]), "the light one is the light header colour");
});
