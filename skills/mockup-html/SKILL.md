---
name: mockup-html
description: Design a web or app screen as a working HTML and CSS mockup, or a logo, icon or illustration as an SVG, and the page draws it in a sandboxed preview panel (phone, tablet and desktop widths, or light, dark and chequered backgrounds). Use when the user asks for a mockup, wireframe, prototype, landing page, screen layout, logo, icon or SVG.
triggers: mockup, mock-up, mock up, wireframe, prototype, prototipe, landing page, desain layar, desain halaman, rancangan tampilan, tampilan halaman, logo, svg, ikon, icon, ilustrasi, illustration, website, situs, web, aplikasi, app, dashboard, halaman, page, desain, design, tampilan, layout, antarmuka, ui, ux, form, formulir
---

# Designing a mockup as HTML, or a logo as SVG

Use this when the user wants to see a screen, a page, a logo or an icon, not read a description of it.

**The page you are chatting in draws it for the user.** HTML and SVG written inside the `<mockup>` tag appear in a preview panel next to the chat. So never answer "I cannot render or show this": write it in the tag. What you cannot do is see the result yourself, so say that, and say what to check.

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

One mockup per reply: one screen, or one whole page. Nothing but the HTML goes inside the tag. Never put the tag inside a code block. The page shows it on the right with Preview and Code tabs.

If the user also asks for something written (a PRD, notes), a `<document>` can go in the same reply next to the `<mockup>`. For a mockup request, the reply carries a `<mockup>`, not only a document.

## A logo, an icon or an illustration (SVG)

Put one `<svg>` and nothing else inside the `<mockup>` tag. The page draws it centred, with a switch for a light, dark or chequered background, and the user can copy it or download an `.svg` file.

- Start with `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">` (a square such as `0 0 200 200` for a logo or icon). Draw with flat shapes: `path`, `circle`, `rect`; gradients with `linearGradient`; cut-outs with a `mask` or by shape. Text is only for a wordmark and uses a system font stack, or is better drawn as shapes.
- No scripts, no external references (`href` to a file or address) and no web fonts: they are removed or blocked. Only inline shapes and `data:` pictures work.
- You cannot see your SVG, so check the geometry in your head and say what you checked: radii and stroke widths that overlap or leave a gap, contrast against a light and a dark background, whether it still reads at 16 and 32 pixels (thin strokes vanish), and keep one idea and two or three colours.
- If the user pastes SVG code, the page already shows them a preview of it; review the design from the code (geometry, contrast, small sizes, wasted shapes) and offer a revised version.
- Add as much detail as the design needs: no length limit.

## What the preview allows (the page runs it in a sandbox)

- **Inline JavaScript works.** Write one `<script>` at the end of the `<body>` (or inline handlers such as `onclick`) and the page runs it: a live clock (`Date`, `Intl.DateTimeFormat`, `setInterval`), a dark and light theme toggle, tabs, a form that validates, a calculator, sorting and filtering a list. Build the working controls the user asked for; do not leave them as pictures.
- **But it is sandboxed.** No network (`fetch`, XHR, WebSocket and external `<script src>`, CDNs, web fonts, stylesheets and images by address all fail), no `localStorage`, `sessionStorage` or cookies, no popups or navigation, no forms that submit. Keep it self-contained: one `<style>`, one `<script>`, a system font stack, icons and pictures as inline SVG or CSS shapes and gradients, `data:` pictures, links as `<a href="#">`. Keep state in plain variables.
- A logo or icon (an `<svg>` alone) gets no scripts at all.

## How to build it well

- **Mobile first.** Design for a 390px wide phone, then widen with one or two `@media (min-width: 768px)` rules; use a `max-width` container and `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Tokens first.** Start the `<style>` with `:root` variables (primary, surface, text, muted, border, radius, spacing) and use only those. One primary colour, neutral greys, a 4 / 8 / 12 / 16 / 24px spacing scale, a type scale like 14 / 16 / 20 / 28, `font-family: system-ui, sans-serif`.
- **Semantic and accessible.** `header`, `nav`, `main`, `section`, `button`, `label` with `input`; visible labels, touch targets of at least 44px, text contrast of at least 4.5:1, a visible focus style.
- **Believable content.** Real wording in the user's language, real-looking names, prices and dates. No lorem ipsum, no "Button", no "Title here".
- **The states that matter.** Show the most important one besides the happy path: a form with an error message, an empty list, or loading skeletons.
- **Pictures.** Use CSS gradient blocks or simple inline SVG; avatars as circles with initials.
- **No size limit. Make it complete and rich.** Aim for at least 250 lines of HTML and CSS together (well over 8,000 characters) for a website or app screen, and more when the page needs it. Build the whole page the user asked for, not a sketch: every section a real version of that page has (for a website: header with navigation, hero, the main feature working as far as CSS can show it, several content sections, footer), several realistic items in each list, and polished styling (spacing, colours, hover and focus states, responsive rules). A request that says "lengkap", "complete", "full" or names a whole website or app means a full page, never a few lines. Never shorten, summarise or leave a part as "..." to save space. If your answer is cut off you will be asked to carry on from the last character: write the `<style>` first, keep going, never start over, and finish with `</html>` and `</mockup>`.
- **Controls that really work.** Wire every button, toggle, select and tab the user asked for with a short inline script (or CSS such as a hidden checkbox with `:has()` where that is simpler). A theme toggle flips the colours, a switch button swaps the two selections, a clock shows the real time in the chosen zone. Never show a control that does nothing.
- **Language.** Write the chat reply and all text on the page in the language of the user's newest message.
- **Finish the page.** The HTML must be complete: it starts with `<!doctype html>`, every tag is closed, and it ends with `</html>`. Write the `<style>` first and keep it short, so there is room for the whole body.
