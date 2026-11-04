---
name: mockup-html
description: Design a web or app screen as a working HTML and CSS mockup that the page shows in a sandboxed preview panel (phone, tablet and desktop widths). Use when the user asks for a mockup, wireframe, prototype, landing page or screen layout.
triggers: mockup, mock-up, mock up, wireframe, prototype, prototipe, landing page, desain layar, desain halaman, rancangan tampilan, tampilan halaman
---

# Designing a mockup as HTML

Use this when the user wants to see a screen or page, not read a description of it.

## How to deliver it

1. Reply in your normal chat voice with one to three short sentences: what the mockup shows, the two or three design decisions that matter most, and what to check. Do not paste the code in the chat.
2. Put the whole mockup inside one tag pair, with a short title:

<mockup title="Halaman Login">
<!doctype html>
<html lang="id">
<head>...</head>
<body>...</body>
</html>
</mockup>

One mockup per reply: one screen, or one landing page. Nothing but the HTML goes inside the tag. Never put the tag inside a code block. The page shows it on the right with Preview and Code tabs.

If the user also asks for something written (a PRD, notes), a `<document>` can go in the same reply next to the `<mockup>`. For a mockup request, the reply carries a `<mockup>`, not only a document.

## What the preview allows (the page runs it in a sandbox)

- **No JavaScript** (no `<script>`, no `onclick`), **no external files** (no CDN, web fonts, stylesheets, images or icons by address) and no forms that submit. Anything like that is removed or blocked.
- So everything is inline: one `<style>` in the `<head>`, a system font stack, icons and pictures as inline SVG or CSS shapes and gradients. Links are `<a href="#">`.
- It is a static picture of a screen, not a working app. Do not say it works; say what it shows.

## How to build it well

- **Mobile first.** Design for a 390px wide phone, then widen with one or two `@media (min-width: 768px)` rules; use a `max-width` container and `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Tokens first.** Start the `<style>` with `:root` variables (primary, surface, text, muted, border, radius, spacing) and use only those. One primary colour, neutral greys, a 4 / 8 / 12 / 16 / 24px spacing scale, a type scale like 14 / 16 / 20 / 28, `font-family: system-ui, sans-serif`.
- **Semantic and accessible.** `header`, `nav`, `main`, `section`, `button`, `label` with `input`; visible labels, touch targets of at least 44px, text contrast of at least 4.5:1, a visible focus style.
- **Believable content.** Real wording in the user's language, real-looking names, prices and dates. No lorem ipsum, no "Button", no "Title here".
- **The states that matter.** Show the most important one besides the happy path: a form with an error message, an empty list, or loading skeletons.
- **Pictures.** Use CSS gradient blocks or simple inline SVG; avatars as circles with initials.
- **Keep it small: under about 3,500 characters in total, CSS included.** Long answers are cut off, and a cut-off mockup is broken, so budget for it: compact CSS (short class names, shared rules, no comments, only what is used), 3 to 5 items in any list, one or two sections. Simple and clean beats elaborate.
- **Finish the page.** The HTML must be complete: it starts with `<!doctype html>`, every tag is closed, and it ends with `</html>`. Write the `<style>` first and keep it short, so there is room for the whole body.
