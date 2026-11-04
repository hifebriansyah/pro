# pro

Chat with AI professionals for a software house and for social media: https://pro.situs.id. A WhatsApp-style chat page (static, `index.html`) and a Cloudflare Worker (`worker/pro.js`). The answers come from the [islam-gpt.org](https://www.islam-gpt.org) API: each professional is a persona text (`personas/<id>.md`) sent in front of every question.

## The professionals

| Software house | | Social media | |
|---|---|---|---|
| Raka | Product Owner: PRD, user stories, roadmap, priorities | Arya | Brand Strategist: positioning, voice, naming |
| Nadia | Business Analyst: requirements, flows, BRD | Laras | Content Planner: pillars, calendars, briefs |
| Bima | Software Engineer: tech consulting, design, code | Tara | Social Media Manager: strategy, campaigns, workflow, crisis |
| Sinta | QA / QC: flow and PRD review for gaps, test cases, reads a public web page | Bayu | Community Manager: engagement, moderation, replies |
| Kirana | UI / UX Designer: flows, screens in words, reviews | Salsa | Copywriter: captions, scripts, ad copy variants |
| Fajar | DevOps / SRE: CI/CD, infra, runbooks, post-incidents | Rendra | Social Media Analyst: KPIs, reports, A/B tests |
| Citra | Delivery Manager: sprint plans, risks, status reports | | |

The list is `AGENTS` in `index.html` (software house first, then social media). To add a professional: add a persona file, add a line to `AGENTS`. Every persona has the same working rules (answer in the user's language, short chat replies, deliverables go in a document, never invent facts or numbers) and its own expertise and deliverables.

## How a reply is made

1. The page sends the question, the persona and the user's latest message to the Worker (`POST /agent`, streamed as events).
2. `src/agent.js` runs a text loop, because islam-gpt.org has no tool calling: the model may answer `TOOL: {"name":"web_search","args":{...}}`, we run the tool (`src/tools.js`: `web_search`, `fetch_url`, `show_image`) and ask again with the result inside (max 3 rounds). The persona is repeated after every tool result so it does not drift.
3. A **skill** (`skills/<name>/SKILL.md`, the Agent Skills format) can be preloaded when the user's message contains one of its trigger words, or loaded by the model with `load_skill`. `writing-md` makes the professional write a deliverable (PRD, test plan, content calendar, code) as a Markdown document inside `<document title="...">`; the page shows it in the panel on the right (copy, download .md, close) with a card in the chat to reopen it.

### What the islam-gpt engine can and cannot do (tested)

- It follows the personas well: a PRD, a QA flow review, a content calendar and a code function all came back in the right voice, in the user's language, with assumptions stated, and as documents when asked.
- QA can read a public page: `fetch_url` returned the page text and Sinta reported it and said what she could not see.
- **It is slow**: about 25 to 35 seconds per answer, 45 seconds or more when a tool runs. The page shows a status line while it works.
- It is an Islamic Q&A service underneath, so it is not tuned for these jobs: expect plain, generic quality, and check numbers, code and claims yourself. The personas tell the professionals not to invent facts.
- There are no tools for running code or testing a site in a browser yet: the engineer says the code was not run, and QA reads page text only (no clicking, logging in, scripts or layout). Next steps that need more than text: a code sandbox, and a `web_audit` tool (status, headings, links, forms, missing alt text).

## Internet access (web tools)

The loop runs in a **Cloudflare Worker**, `worker/pro.js` at https://pro-worker.situs.id (the page's `WORKER` constant), so it also works on GitHub Pages and from `http://localhost`. It is deployed like `../guru` and `../faith`:

```bash
python3 tools/deploy_worker.py             # upload it (CLOUDFLARE_API_TOKEN/ACCOUNT_ID and AXIOM_TOKEN come from ../.env)
python3 tools/deploy_worker.py --dry-run   # build the upload and list it, sends nothing
node bin/chat.js --web "question"          # the same loop in the terminal (or /web inside the chat; no persona there)
node bin/proxy.js                          # the same /agent on 127.0.0.1:8787, only to develop the Worker code; open the page once with ?proxy=http://127.0.0.1:8787 to use it (?proxy= goes back to the Worker)
```

- One copy of the logic: the Worker, `bin/proxy.js` and the CLI all run `src/`; the deploy follows the Worker's imports and uploads those files. Nothing in `src/` may do I/O, timers or random values while loading (Workers refuse that; a test checks it).
- **Search needs no key**: DuckDuckGo's HTML page (POST, then GET), then Wikipedia's search. `BRAVE_API_KEY` (paid) is optional: if it is set as a secret it goes first. Each result says which backend answered (`via`), and the log records it.
- Limits (`worker/pro.jsonc`): 6 questions a minute per IP address, 60 a minute for everybody; only `pro.situs.id` and localhost origins may call it.
- Request log in Axiom (dataset `pro.situs.id`, secret `AXIOM_TOKEN`): one line per question with who (IP, country, browser), which professional, the user's message, the tools used, steps, size and time. The answer text is not logged. The page tells the user (the globe's tooltip) that messages are logged. The dataset has to exist in Axiom first, or the lines are dropped.
- `npm test` also runs `test/worker.test.js`: the whole Worker in Node with a fake network. `npm run test:offline` skips the tests that call islam-gpt.org.

`show_image` finds one existing photo on Wikimedia Commons (free, no key, licensed) and shows it under the reply. It searches for a photo, it never generates one.

## Avatars

The round picture is the first letter of the name on the professional's colour. To use a photo, add `avatar: "personas/<name>.jpg"` to the professional's line in `AGENTS`. `python3 tools/make_image.py personas/*.jpg` makes pictures small and square (256x256), keeping your originals in `personas/originals/` (git-ignored); needs `pip install pillow`. Options: `--size`, `--quality`, `--focus`, `--format jpg|webp`, `--out DIR`, `--no-backup`.

## Logo, icons and share image

`logo.svg` is the logo (a circuit line that forms a letter, with two amber dots; it is still faith's logo, a new one can replace it). `python3 tools/make_icons.py` (needs Pillow) draws `logo.png` (1024, transparent), the icons in `icons/` (192 and 512, a maskable one, the iOS apple-touch-icon, the 48 px favicon), `favicon.ico` and `og-image.png` (1200x630, the picture shown when the address is shared: the logo and the tagline on the dark page colour). `manifest.webmanifest` and the `<head>` of `index.html` use them, so the page can be installed as an app, and the Open Graph and Twitter tags point at the image with an absolute address.

- The tagline is the same everywhere (description, share tags, manifest, the picture, `TAGLINE` in `make_icons.py`) and a test fails if one of them drifts.
- **Cache busting:** every icon address carries `?v=<hash of the file>`. `tools/stamp_icons.py` (standard library only) sets it: `make_icons.py` runs it on the repo files, and the Pages workflow runs it on the published copy on every deploy. A test fails when the repo's pages hold a stale hash.
- The drawing of the share image uses macOS's Helvetica Neue Thin: regenerate it on a Mac.

## Palette

The colours come from the logo: its three ambers (`#f59e0b`, `#fbbf24`, `#d97706`) on warm stone greys, as CSS variables at the top of `index.html`, a light set and a dark set (it follows the system setting). Contrast was checked (text 4.5:1 or more on every surface and bubble). Use the variables, not hex values, in new CSS.

## Develop

```bash
npm test                  # unit tests, the Worker with a fake network, plus live tests against islam-gpt.org
npm run test:offline      # without the live tests (what CI runs)
```

Needs Node 20 or newer. Pushing to `main` publishes the site to GitHub Pages (`.github/workflows/static.yml`, domain in `CNAME`). The Worker is deployed separately with `tools/deploy_worker.py`.
