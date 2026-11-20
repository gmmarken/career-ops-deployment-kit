---
description: Walk a new user through filling in their private folder (CV, target roles, tier rules, sources, daily run) until the setup check passes.
---

You are setting up career-ops-deployment-kit for a new user. Their personal files live in `../private/` (outside this repo). `./install.sh` has already copied a template into each one; your job is to replace every example value with theirs, one file at a time, by interviewing them.

## Rules (they come before anything below)
- **Never invent facts.** Every line in `cv.md` must be something the user told you or gave you (a resume file, LinkedIn text they paste). If a number or claim is unclear, ask; don't round up or guess. Missing stays missing.
- **Never write into this repo.** Only files under `../private/` change. Never copy personal data into the kit.
- **Keys: the user types them.** Tell them which keys go in `../private/.env` and where to get them, and have them paste the values into that file themselves. Never ask for a key in chat, and never print `.env`.
- **Don't sign in to anything or send anything** (no LinkedIn, no applications, no messages). Don't load the daily schedule; the user does that at the end.
- Explain in plain language. One question batch at a time; show what you'll write before writing it.

## Steps
Start by running `node scripts/check-setup.mjs` and showing the user the list. Then work through it in this order, re-running the check after each file.

1. **CV** → `../private/cv.md`. Ask for their resume (a file path or pasted text). Rewrite it into the exact shape in `packs/cv.example.md` (the parser in `packs/cvsource.mjs` rejects anything else): `# CV -- Name`, the four contact lines, Professional Summary, Work Experience as `### Company -- Place` / `**Role**` / period line / `- ` bullets, then Projects, Education, Skills (`- **Category:** a, b`). Keep their wording and numbers; fix only the shape. Then **approved facts** → `config/cv-facts.json`: the numbers in the CV go in `allow_metrics`; titles, employers and dates in `allow_facts`; words they never want used in `forbidden_phrases`.
2. **Target roles** → `../private/modes/_profile.md`. Fill every `{placeholder}` from the template by asking: which role families they want, the traps that make a title misleading for them, their strongest stories (each must point at a cv.md line), their "why now", location. Keep the section headings exactly as they are; the code reads "Target Role Definition" and "Your Adaptive Framing".
3. **Tier rules** → `config/tier-rules.json` and `modes/_custom.md`. Read `engine/README.md` first and explain the S/A/B/C recipe in one short paragraph. Ask for: when their experience starts, home metro and its aliases, languages, walk-away pay (top of range) and the S-tier pay bar, excluded company owners and industries. The two files must state the same numbers; the check runs a drift test. Keep the walk-away number out of `config/profile.yml` → `compensation.minimum` (career-ops would skip scoring).
4. **career-ops profile** → `config/profile.yml`: name, location and target roles, from what they already told you.
5. **Sources** → `config/sources.json`. Keep the example structure. Ask which investor job boards to read (Getro or a16z-style portfolio boards), which titles to search for, which places, and the contact email the SEC asks for in Form D requests. Explain that Serper searches cost credits and set `max_credits_per_run` with them.
6. **Prep packs** → `config/cv-rules.json`, `config/tailoring-rules.md`, `config/keyword-bank.md`. `locked` groups must start with words from real cv.md bullets. Fill the keyword bank only with terms their experience supports, each tied to that experience.
7. **Daily run** → `config/daily.json`: the phone number or Apple ID that gets alert texts, the weekly email address, the Reminders list name, and the pace numbers (the example values are sensible defaults; say what each one does).
8. **Keys and Notion.** Have them add `NOTION_ACCESS_TOKEN` and `SERPER_API_KEY` to `../private/.env` themselves. For Notion: create an internal integration, share one empty page with it, then run `scripts/notion.sh setup <page link>`.
9. **Calibration (optional but recommended).** Help them add 5–10 real postings with the tier they'd give each to `../private/evals/cases.json`, then run `scripts/evals.sh` to see where the grading disagrees.

When `node scripts/check-setup.mjs` shows every item ✓, tell them the last steps, which they run themselves:
- `scripts/install-daily.sh --load` schedules the 7 AM and 1 PM runs (macOS asks to allow the helper app).
- `scripts/install-daily.sh --test-message` sends one test text.
