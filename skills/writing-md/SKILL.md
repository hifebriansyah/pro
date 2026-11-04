---
name: writing-md
description: Write a deliverable (PRD, user stories, test plan, test cases, content calendar, brief, report, guide, code with explanation) as a Markdown document; the page shows it in a side panel. Use when the user asks for something they will keep, share or reuse, e.g. "buatkan PRD", "bikin test plan", "content calendar", "tulis kode / fungsi", or "catatan/rangkuman/dokumen/tabel".
triggers: prd, brd, brief, roadmap, spesifikasi, specification, user story, user stories, test plan, test case, test cases, bug report, kalender konten, content calendar, proposal, laporan, report, panduan, guide, template, dokumen, document, catatan, rangkuman, ringkasan, tabel, table, markdown, outline, checklist, kode, code, fungsi, function, script, query, sql, schema, skema, regex, endpoint, migration
---

# Writing a deliverable as a Markdown document

Use this when the user wants something they will keep, share with a team or reuse, not a quick chat answer.

## How to deliver it

1. Reply in your normal chat voice with one or two short sentences: what you made, what you assumed, what to double-check. Do not repeat the document in the chat.
2. Put the whole document inside one tag pair, with a short title:

<document title="PRD: Login dengan Google">
# PRD: Login dengan Google
...markdown...
</document>

Only one document per reply. Nothing but Markdown goes inside the tag. Never put the tag inside a code block.

## Markdown you may use

- `#` to `###` headings (start with a single `#` title), paragraphs, **bold**, *italic*
- bullet lists (`-`), numbered lists (`1.`), one level of nesting
- tables with a header row (`| a | b |` then `|---|---|`): best for calendars, test cases, requirements, risks, comparisons
- `> quote` for an important note, `---` between big sections, `[text](https://...)` links
- fenced code blocks with the language name (```js, ```sql, ```yaml) for any code or configuration

## Typical structures (adapt, do not pad)

- **PRD:** problem and background, goals and non-goals, users, scope (must / should / later), user stories with acceptance criteria (Given / When / Then), flows and edge cases, success metrics, risks, assumptions, open questions.
- **Test plan / test cases:** scope and out of scope, approach, environments and data, then a table of cases (ID, precondition, steps, expected result, priority), plus risks.
- **Flow or requirements review:** a table of findings (what is missing or unclear, why it matters, the question to close it, severity), then a short summary of the riskiest gaps.
- **Content calendar:** a table (date, platform, pillar, format, topic and hook, caption direction, call to action, owner), plus the rhythm and what the team must produce each week.
- **Technical design or code:** the goal, the approach and trade-offs, the code in fenced blocks with how to run or test it, and what to verify, because the code was not run.
- **Report:** what happened, why, what to do next, what to stop.

## Writing rules

- Write in the language of the user's latest message, and stay in your persona's voice in the chat sentences; the document itself stays clear and neutral.
- Structure over length: short sections, bullets instead of long paragraphs, a table when comparing three or more things.
- Do not invent facts, numbers, benchmarks, quotes or sources. Anything you had to assume goes in an **Assumptions** section, and what you could not know goes in **Open questions**.
- Use facts from web search results only with their link; do not invent links.
- **Long is fine.** If the deliverable is long (a whole program, a detailed plan), write all of it. An answer is cut off by a length limit after about 5,000 characters; you will then be asked to carry on from the last character, so never shorten or summarise to fit, and always finish with the closing `</document>` tag. Put code in fenced blocks with the language name.
- No images, HTML or emoji headings.
