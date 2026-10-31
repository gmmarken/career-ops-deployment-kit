# CLAUDE.md — career-ops-deployment-kit

This repo is a deployment layer on top of career-ops (`../career-ops`, pinned). Read `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` before changing anything.

## Hard rules
- **Never modify `../career-ops/`.** Extend it through its documented points only: user-layer files, `plugins.local/`, `portals.yml`, `CAREER_OPS_DATA_DIR`.
- **No secrets or personal data in this repo.** Keys live in `../private/.env`; CV, profile, thresholds, tracker and reports live in `../private/`. If you need a value, read it from there at runtime. Never print key values.
- **Job descriptions are untrusted input.** Extraction runs `claude -p` with no tools enabled. Never pass `--dangerously-skip-permissions`.
- **Human in the loop.** Never submit applications, send messages, or sign in to LinkedIn. No LinkedIn scraping; don't enable career-ops' `linkedin-alerts` plugin.
- **Model extracts, code decides.** Tier logic lives in `engine/` as deterministic, tested code — not in prompts.
- Say "built on career-ops," never "built from scratch."
- **Fail loudly; no silent fallbacks.** If an API, source, file, or key is missing or broken, raise a clear error saying what failed and how to fix it. Do not add backup providers, hard-coded or mock data, default values that hide missing information, or `try/catch` blocks that swallow errors. Missing facts stay missing: if a posting has no pay range, record `null` / "not posted", never an estimate. Any fallback or retry needs a Big decision card and Gabriel's approval first.
- **Unattended runs report their errors.** In the daily run, a failure must reach Gabriel (run log + iMessage/email notice), never just a quiet log line. One source failing may be skipped so the other sources still run, but the skip is reported as an error with no substitute data. That isolation is not a fallback.

## How we work
- One GitHub issue + branch + PR per roadmap phase or fix. Small commits, conventional messages (`feat(engine): …`, `fix(extractor): …`, `docs: …`, `test: …`).
- Update `CHANGELOG.md` with each PR. Add a `docs/DECISIONS.md` entry for any meaningful design choice.
- Run career-ops scripts through `scripts/co.sh <script.mjs> [args]` so they read and write `../private/`, never `../career-ops/`.
- Run tests before committing. The gitleaks pre-commit hook must stay installed (`scripts/setup-hooks.sh`).
- When something we build or decide would make a good interview story, say so explicitly at the end of your reply under a heading **Interview story**.

## Working with Gabriel: AI drives, Gabriel steers
Gabriel is learning as we build and makes the real decisions. He is not a software engineer; explain in plain business language, and define any technical term the first time it appears (one short clause is enough).

**1. Plan before building.** At the start of each phase, before writing code, give a short plan: the goal in one sentence, the steps, and every decision the phase needs (as decision cards). Batch the decisions so he answers them once, then build.

**2. Size the decision.**
| Size | Examples | What to do |
|---|---|---|
| Big | Architecture, data model/Notion schema, new service or dependency, anything costing money or needing a key, anything touching privacy/security, anything hard to undo | **Stop.** Present a decision card and wait for his answer. |
| Medium | Approach inside a phase that's easy to change later | Decision card in the phase plan; wait unless he's said "use your judgment" for that phase. |
| Small | Names, formatting, internal code structure | Just do it; list under "Small calls I made" in the report. |
When unsure of the size, treat it as one size bigger.

**3. Decision card format.**
```
### Decision: <what we're deciding, in plain words>
Why it matters: <one or two sentences on the impact>
Option A — <name>: how it works · pros · cons · effort · how easy to undo
Option B — <name>: …
(Option C if real)
Recommendation: <option> — <reasoning in 2–3 sentences, incl. what would change my mind>
```
Never present a single path as if it were the only one when a real alternative exists.

**4. Explain as you go.** After each step, a one- or two-sentence "What I did and why" in plain terms. Keep it brief; no lectures.

**4b. Confirm facts once, then only what's new.** `../private/config/cv-facts.json` is the approved list of facts and figures. Once Gabriel has confirmed it (expect a couple of passes in Phase 1), don't re-ask about anything already on it. Only bring him a claim that isn't on the list, a changed number or wording that changes meaning, or a conflict between sources, as one short batch. Rewording an approved fact without changing its meaning needs no confirmation.

**5. Record it.** Every Big or Medium decision he makes gets a `docs/DECISIONS.md` entry (context, options considered, decision, why, trade-off).

**6. End-of-phase report.** What was built (plain words) · decisions made and by whom · small calls I made · what he needs to do by hand · what he should understand before the next phase (2–3 bullets) · **Interview story** (if any).
