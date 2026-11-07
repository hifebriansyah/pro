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
4. Chat bubbles render Markdown like the document panel: `inline code`, fenced code blocks, lists, headings, quotes and tables (plain text with only inline marks keeps its line breaks). A message becomes one bubble per paragraph, except that blank lines inside a code fence do not split it and a list stays together.

### Mockups

`mockup-html` makes the professional write a screen as one self-contained HTML file inside `<mockup title="...">`. Kirana (UI / UX) does it on her own initiative; Raka, Bima, Laras and Salsa do a rough one when asked (their personas say so and point to Kirana for a serious design job). The page shows it in the same right-hand panel with **Preview / Code** tabs and **phone / tablet / desktop** widths, copy and download `.html`, and a card in the chat to reopen it.

- **The AI's HTML runs in an isolated frame, and inside it, anything runs.** Scripts, CDN libraries (three.js, Chart.js), web fonts, pictures and `fetch` to any address, embedded frames, forms, popups, dialogs, downloads, fullscreen. What it cannot do is reach this page: the sandbox does not grant same-origin (no access to the page, the chats, their storage or cookies), top navigation, or camera, microphone and location. A real `localStorage` cannot exist in such a frame, so a stand-in keeps the mockup's data and the page saves it for that mockup (no cookies or IndexedDB). A logo or icon (SVG) gets no scripts and a strict policy. A script that loops forever freezes the preview, and a mockup can show a fake login page or send what is typed into it, but only what is typed into it. `frameHtml` and `MOCKUP_SANDBOX` in `index.html`; tests check the limits.
- **SVG: logos, icons, illustrations.** An `<svg>` alone inside the mockup tag is drawn centred with a **light / dark / chequered background** switch (and copy, download `.svg`). The page also shows a preview card under **any message that contains an `<svg>`**, yours or the AI's (in a code fence or not), and opens it when the AI writes one straight into its answer. The AI cannot see the result, and the persona says so: it reasons about gaps, contrast and small sizes (16 / 32 px) and says what to check. A page that is an SVG is framed by `frameHtml` with the background chosen by the page, never by the model.
- It is a working preview of a screen (controls respond, data is sample data), and not a small one: **a mockup has no size limit.** The skill asks for the whole page (every section, several items, polished CSS), controls that work with CSS only (a dark / light toggle with a checkbox and `:has()`, tabs with radio buttons, `<details>`), and the user's language. A cut-off answer is carried on part by part (see Long answers); the only ceiling is that loop's guard (6 parts, 60,000 characters, which also keeps a request inside the backend's 300 s). Iterating ("make the button bigger", which needs the last mockup sent along with the next question) is not done yet.


### What the islam-gpt engine can and cannot do (tested)

- It follows the personas well: a PRD, a QA flow review, a content calendar and a code function all came back in the right voice, in the user's language, with assumptions stated, and as documents when asked.
- A real mockup request (Kirana, a coffee shop home page) came back as a complete, believable page in about 30 seconds once the skill asked for a size budget; without it the HTML was cut off mid-tag.
- QA can read a public page: `fetch_url` returned the page text and Sinta reported it and said what she could not see.
- **It is slow**: about 25 to 35 seconds per answer, 45 seconds or more when a tool runs. The page shows a status line while it works.
- It is an Islamic Q&A service underneath, so it is not tuned for these jobs: expect plain, generic quality, and check numbers, code and claims yourself. The personas tell the professionals not to invent facts.
- There are no tools for running code or testing a site in a browser yet: the engineer says the code was not run, and QA reads page text only (no clicking, logging in, scripts or layout). Next steps that need more than text: a code sandbox, and a `web_audit` tool (status, headings, links, forms, missing alt text).

## Long answers (continuation)

islam-gpt ends an answer after about 5,000 to 7,000 characters, even in the middle of a document, a page or a program. When a reply is cut off inside a `<document>`, a `<mockup>` or a fenced code block, `src/continue.js` makes the agent ask the model to **carry on from the last character** and joins the parts into one result: up to 6 parts and 60,000 characters per request.

- **What the model is told:** the user's request, the last 1,200 characters, the Markdown headings already written, and the **declarations already written with their parameters** (`csvEscape(value)`, `Order.constructor(inventory, items)`, ...), with "use them as written, never define one twice". Without that map the model forgot a helper from three parts earlier and wrote it twice.
- **The join is cleaned:** a repeated start is removed, a reopened fence or tag is dropped, "DONE" or a restarted page stops it, and a document that ends inside a code fence gets the fence closed.
- **One id per request:** a request that arrives without a `deviceId` gets its own random one (all parts of one answer share it). Reusing one id for everybody made a continuation stall in a live test; with a fresh id the same request went through every part.
- **Robust:** each continuation has a timeout and one retry; if it still fails, what was written so far is kept. The status line shows "melanjutkan jawaban (bagian 3)…", and the Worker and the proxy send a comment line every 15 seconds so the connection is not closed as idle while the model works.
- **Measured** (the engineer, one request for a complete inventory program in Node): 3 to 4 parts, 85 to 110 seconds, 700 to 780 lines and 19,000 to 24,000 characters through the live Worker, no duplicate declarations, and the code passes `node --check`. It did **not** run cleanly: the example at the bottom calls `inventory.events.on(...)`, which the class does not have. The model cannot run what it writes, so consistency across a long program is not guaranteed: read and run it.
- **How far it goes:** about 30 seconds a part, so a 6-part answer takes about 3 minutes and gives roughly 25,000 to 30,000 characters, a few hundred to about a thousand lines of code. **Thousands of lines in one request are not possible** this way. For a bigger program, split the work: the engineer proposes the file list first and writes one file per message. A "project mode" that does this by itself and offers a zip is not built yet.

## CPU budget (why a request could fail with "layanan internet tidak bisa dihubungi")

A Cloudflare Worker on the free plan gets about **10 ms of CPU per request** (waiting for islam-gpt does not count, processing does). A request that goes over is killed and the page sees a 503 without CORS headers, which the browser reports as a network or CORS error. This happened to roughly a quarter of the requests (Cloudflare listed them as `exceededResources`, 18 to 46 ms of CPU). Three things were responsible, all invisible in tests because they hit only a cold isolate:

- **The date.** `toLocaleDateString` with a time zone costs 10 to 15 ms the first time it runs. "Today" now comes from a UTC offset in plain arithmetic (`TIMEZONE_OFFSET_MINUTES` in `worker/pro.jsonc`, 420 for Jakarta).
- **Skill matching.** It built one Unicode regular expression per trigger word (59 of them) on every request, and for an ordinary message with no trigger in it that was 18 ms. One regex now normalises the message and the rest is substring checks.
- **Reading the answer.** islam-gpt streams 70 to 1,800 tiny events and a 4 KB `references` block the page never shows; `chatBuffered` reads the whole stream as text and parses it in one pass (8 times cheaper), and skips the references unless asked.

Result on the same request: 22 to 26 ms before, 4 to 5 ms after in a cold-process test, and 4.4 to 9.5 ms (median 5.8) per request on Cloudflare itself. `test/worker.test.js` has a guard that runs a typical request in a fresh process and fails above 8 ms, and `test/agent.test.js` has one for the skill matching. Request logging to Axiom is off (`AXIOM_LOG` "0") until the dataset exists: each log line is a subrequest that costs CPU and would only fail. If a Worker needs more headroom, Workers Paid ($5 a month) lifts the limit to 30 s of CPU.

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
- Request log in Axiom (off for now: `AXIOM_LOG` "0" in `worker/pro.jsonc`; dataset `pro.situs.id`, secret `AXIOM_TOKEN`): one line per question with who (IP, country, browser), which professional, the user's message, the tools used, steps, size and time. The answer text is not logged. The page tells the user (the globe's tooltip) that messages are logged. The dataset has to exist in Axiom first, or the lines are dropped.
- `npm test` also runs `test/worker.test.js`: the whole Worker in Node with a fake network. `npm run test:offline` skips the tests that call islam-gpt.org.

`show_image` finds one existing photo on Wikimedia Commons (free, no key, licensed) and shows it under the reply. It searches for a photo, it never generates one.

## The team working together

Two layers, both on the backend (the Worker only checks and rate-limits), built on the current free sources (islam-gpt, quran-gpt) behind the existing provider switch, so another model is one more provider later.

**Ask a colleague.** While answering, a professional can put one specific question to another (`ask_colleague`, `src/colleagues.js`): Bima asks Sinta which cases matter most. The colleague answers briefly from their own persona and cannot ask anybody else (one level deep), and at most two questions per answer. The page gets `consult` events; in the office the asker walks to the colleague's desk and talks while the colleague works on the answer. The backend ships `personas/*.md` for this (`src/personas-fs.js`, `src/roster.js`); the Worker's own fallback has no colleagues. A small model sometimes writes only the arguments, which the parser accepts.

**Team projects** (`POST /team`, `src/team.js`, `src/playbooks.js`). A goal goes through a *playbook*: a fixed list of steps, each a professional writing one deliverable.
- **Software feature:** Raka (PRD), Nadia (user stories), Kirana (mockup), Bima (technical plan and code skeleton), Sinta (test plan and review), Citra (delivery summary). **Campaign:** Arya, Laras, Salsa, Tara, Bayu, Rendra (the analyst reviews the copy). The order is data, not something the model invents: free models are poor at planning, good enough at writing one document with a clear contract.
- **A step** gets the persona, the goal, its task, the handoff notes of the steps before, the full text of the few it `uses` (shortened; a mockup is summarised by its note) and an output contract: `<document>` or `<mockup>`, then `<handoff>` (at most 80 words), and for a review `<verdict>approved|changes</verdict>`. Cut-off documents are carried on like in a chat; a missing handoff note is made from the text; a plain-text answer is kept as the document; a bad answer is retried once.
- **A review** that asks for changes sends the author back once with its list and the earlier version, then looks again; a second "changes" is final and the project goes on.
- **Events** (SSE): `plan`, `step` (start, part, end), `artifact`, `handoff`, `review`, `paused`, `done`, then `end`. The client keeps every result and sends the finished ones back: a run **resumes** from there, and `only` + `feedback` redo one step with the client's comment.
- **Limits:** at most 18 model calls and about 270 s per request (the Vercel function allows 300), then `paused` ("time" or "calls") and the page continues; a step that fails twice stops the run with everything before it kept. The Worker gives `/team` its own limit (3 starts a minute per IP, `LIMITER_TEAM`) and a 150 KB body, and has no fallback: no backend, no project.
- **Live check** (quran-gpt, the real personas and skills): a six-step software project in about a minute, a campaign likewise. Honest limits of the small free model: the documents are short (about 2 to 3 thousand characters), the handoff notes are fairly generic, and the reviewer tends to approve; the revision loop is covered by tests with a fake model. A stronger model is a one-line provider change later.
- **Not built yet:** the project screen in the page (plan approval, the live timeline, the artifact board). Until then `/team` is an API.

## The virtual office (Kantor)

The **Kantor** button in the chat list opens a 3D office (three.js) where the 13 professionals are low-poly people, drawn after their photos (hair, skin, glasses, jacket; `LOOKS` in `office/core.js`). It is a way to see the team and to chat: click a person, or their name in the team bar, and the chat docks beside the office (full screen on a phone, with the arrow back to the office).

- **Working:** whoever has an answer being written walks to their desk, sits and types, their screen glows, and a bubble over them says what they are doing ("mencari ‘…’ di internet…", "membaca halaman web…", the same status the chat shows). When the answer is done they stay a moment with a green "Selesai ✓", then get up.
- **Idle:** everybody else wanders: coffee, the cooler, the sofa and armchairs, the meeting table, the whiteboard, the shelf, the printer, or just looking around. They avoid the furniture (A* on a grid) and never share a seat.
- **Chatting with someone:** they stop where they are, turn to face you and wave, and the camera follows them; let go and they carry on.
- **Controls:** drag to turn (a mouse), or drag the floor (a finger); wheel or pinch to zoom; the buttons zoom, reset the view, pause everything and switch day and night with the page theme. Every person is a real button (Tab, Enter), the canvas is described for screen readers, and with *reduce motion* set nobody wanders (people still go to their desk to work).
- **Code:** `office/core.js` is the floor plan, pathfinding and what each person does (no 3D, no DOM: unit-tested in `test/office-core.test.js`); `office/scene.js` builds the building, the furniture and the people; `office/office.js` is the camera, picking, name tags and the loop. `index.html` only has the button, the view and a few lines that tell the office who is busy.
- **three.js** (a pinned release, with its integrity hash) is fetched from cdnjs only when the office is first opened, so the chat stays as light as before. The page publishes `office/` with the rest (see the workflow). Opening `#kantor` goes straight to the office.
- **Limits:** the office is a picture of the state, not a second chat: it does not send anything by itself. Bubbles show the status of the answer in flight; there is no history of past work.

## Avatars

Each professional has a photo, `personas/<name>.jpg` (256x256), shown round in the chat list and header; it is set by `avatar:` on the professional's line in `AGENTS`, and if a file is missing the first letter of the name on the professional's colour is shown instead. `python3 tools/make_image.py personas/*.jpg` makes new pictures small and square, keeping your originals in `personas/originals/` (git-ignored, so keep your own backup); needs `pip install pillow`. Options: `--size`, `--quality`, `--focus`, `--format jpg|webp`, `--out DIR`, `--no-backup`.

## Logo, icons and share image

`logo.svg` is the logo (a gradient P with a white ring forming an O, on a dark background). `python3 tools/make_icons.py` renders **that file itself**, it does not redraw it, so after you edit `logo.svg` you only run the script and every picture follows: `logo.png` (1024, as designed), the icons in `icons/` (192 and 512, a maskable one inside the safe zone, the iOS apple-touch-icon, the 48 px favicon), `favicon.ico` and `og-image.png` (1200x630, the picture shown when the address is shared: the logo and the tagline). `manifest.webmanifest` and the `<head>` of `index.html` use them, so the page can be installed as an app, and the Open Graph and Twitter tags point at the image with an absolute address.

- The first `<rect>` before `<defs>` in `logo.svg` must be the background; its colour is the background of every picture (the icons are the logo on that colour, framed by changing the `viewBox`, and the script finds the drawing's size from the render).
- Needs Pillow and an SVG renderer that supports masks and filters: macOS Quick Look (built in, used first), else `rsvg-convert` or `cairosvg`. ImageMagick's built-in renderer draws nothing for this logo.
- The tagline is the same everywhere (description, share tags, manifest, the picture, `TAGLINE` in `make_icons.py`) and a test fails if one of them drifts.
- **Cache busting:** every icon address carries `?v=<hash of the file>`. `tools/stamp_icons.py` (standard library only) sets it: `make_icons.py` runs it on the repo files, and the Pages workflow runs it on the published copy on every deploy. A test fails when the repo's pages hold a stale hash.
- The share image uses macOS's Helvetica Neue Thin for the tagline: regenerate it on a Mac.

## Palette

The page colours are still amber on warm stone greys (they came from faith's logo, not from this one), as CSS variables at the top of `index.html`, a light set and a dark set (it follows the system setting). Contrast was checked (text 4.5:1 or more on every surface and bubble). Use the variables, not hex values, in new CSS.

**Light / dark:** the page follows the system setting. The sun / moon button in the header (next to "Chat") switches it by hand, and the choice is remembered in `localStorage` (`islam-chat:theme`). A small script in `<head>` applies a saved choice before the first paint, so there is no flash of the other theme; `data-theme="light"|"dark"` on `<html>` is what the CSS reads, and the browser's address-bar colour follows. The dark colours are written twice in the CSS (once for the system setting, once for a chosen dark theme): `test/theme.test.js` fails if the two copies differ.

## Develop

```bash
npm test                  # unit tests, the Worker with a fake network, plus live tests against islam-gpt.org
npm run test:offline      # without the live tests (what CI runs)
```

Needs Node 20 or newer. Pushing to `main` publishes the site to GitHub Pages (`.github/workflows/static.yml`, domain in `CNAME`). The Worker is deployed separately with `tools/deploy_worker.py`.
