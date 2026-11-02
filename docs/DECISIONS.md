# Decision log

Short records of meaningful design choices: context, decision, why, trade-off.

## D1 — Build on career-ops instead of from scratch (2026-10-22)
**Context:** I needed a job search pipeline for roles with no standard title. career-ops (open source, MIT) already covered ATS scanning, liveness checks, evaluation, tailoring and tracking.
**Decision:** Adopt career-ops as the platform; build only the differentiated layer.
**Why:** Most of the requirements were already met by a maintained, tested platform. Time goes to what's unique: my rules, sources, and delivery.
**Trade-off:** I work within its conventions and extension points.

## D2 — Layer on top, don't fork (2026-10-29)
**Context:** Customizing a platform usually means forking it and drifting from upstream.
**Decision:** Keep career-ops unmodified and pinned; this kit plugs in through user-layer files, `plugins.local/`, and `CAREER_OPS_DATA_DIR`.
**Why:** Upstream fixes keep flowing with no merge conflicts, and reviewers see exactly what I added.
**Trade-off:** Some changes take more effort when no extension point exists; those become upstream PR candidates.

## D3 — Personal data and keys live outside the repo (2026-10-29)
**Decision:** All personal data and keys sit in a sibling `private/` folder that career-ops reads via `CAREER_OPS_DATA_DIR`.
**Why:** Makes it physically hard to leak a CV or key, and lets the repo go public later without a cleanup.
**Trade-off:** A little more setup for anyone copying the kit (handled by templates).

## D4 — The model extracts, code decides the tier (2026-10-29)
**Context:** Tier rules (caps, penalties, pay bands) are precise; LLM judgments drift.
**Decision:** The LLM returns structured facts with evidence quotes; a deterministic, unit-tested engine assigns S/A/B/C and explains why.
**Why:** Rules become testable and versioned, and when a role is mis-tiered the eval set shows whether extraction or a rule was wrong.
**Trade-off:** Two components to maintain instead of one prompt.

## D5 — Extraction runs with no tools (2026-10-29)
**Context:** career-ops' batch runner calls `claude -p` with permission checks disabled. Job descriptions are untrusted text and could carry prompt-injection instructions.
**Decision:** Extraction runs with no tools (text in, JSON out); only kit code writes files or calls APIs.
**Why:** A malicious posting can't make the agent run commands or touch files.
**Trade-off:** Extraction can't browse for extra context; enrichment is a separate, controlled step.

## D6 — Found gaps by reading the platform before building (2026-10-29)
**Context:** The initial plan assumed career-ops' weekly digest and Notion plugin would cover delivery.
**Finding:** `weekly-digest.mjs` summarizes interview sessions, not new roles, and the Notion plugin writes to a fixed "Applications" schema.
**Decision:** Build a weekly email plugin and a Notion export mapped to my own databases.
**Why:** Verifying the platform's actual behavior before building avoided designing around features that didn't exist.

## D7 — Fail loudly; no silent fallbacks (2026-10-30)
**Context:** AI coding agents tend to add fallbacks (backup data sources, hard-coded defaults, swallowed errors) that keep a pipeline "working" while hiding that it's broken.
**Decision:** Errors surface clearly with what failed and how to fix it. No backup providers, mock data, or defaults that mask missing information; unknown facts stay unknown. In unattended runs, failures are reported to me. A failed source can be skipped so the others still run, but the skip is reported and nothing is substituted.
**Why:** A job search tool that quietly returns stale or invented data is worse than one that stops. I'd rather know a source is down than trust results that look complete.
**Trade-off:** More runs end in visible errors that need a fix, and there's no automatic recovery.

## D8 — One master CV; role framing lives in the profile (2026-10-30)
**Context:** I had two AI-drafted resumes, one for deployment roles and one for operator roles, sharing most of the same facts.
**Options:** (A) one `cv.md` with every confirmed fact, plus per-archetype framing in `_profile.md`; (B) two CV files swapped in before each run.
**Decision:** A.
**Why:** career-ops reads one `cv.md` and tailors per job; one source of truth means facts can't drift between versions, and the fact checker sees everything.
**Trade-off:** The master file is longer than either resume.

## D9 — Every resume fact confirmed once, with a rounding rule for employer metrics (2026-10-30)
**Context:** The resumes were AI-drafted from conversations, which is where inflated or unsourced numbers hide. Some metrics from my current employer shouldn't appear at full precision.
**Options:** (A) keep numbers as written; (B) generalize all employer specifics; (C) tag each item keep / generalize / cut.
**Decision:** C, with a fixed rule: dollar amounts and counts are rounded to a clean figure ("+" or "nearly"), percentages are rounded up to the next 5 with "~", and small decimals become "over X". Internal program names and sensitive work are generalized.
**Why:** One explicit rule applies the same way every time and is easy to defend. The review also caught a percentage with no measurement behind it, which was cut.
**Trade-off:** Some metrics read less precisely.

## D10 — Strict fact gate on generated CVs (2026-10-30)
**Decision:** `config/cv-facts.json` blocks every cut or corrected claim (`forbidden_phrases`) and warns on inflated verbs (`warn_phrases`); career-ops' checker already blocks any number absent from `cv.md`. Tested: the real CV passes; a planted inflated CV is blocked.
**Why:** Phase 8 generates CVs without me watching each one.
**Trade-off / known gap:** career-ops' number matching ignores "~", so "~40" becoming "40" isn't caught. A kit-side check is planned for Phase 8.

## D11 — Target role defined as "is / is not", with trap signals (2026-10-30)
**Options:** (A) the requirements wording as written; (B) the same definition plus JD phrases that reveal each of the four traps.
**Decision:** B.
**Why:** Title-based precision is the core problem; spelling out trap signals helps the model now and becomes test material for Phases 2–3.

## D12 — Walk-away pay is a tier rule, not `compensation.minimum` (2026-10-30)
**Finding:** career-ops treats `profile.yml` → `compensation.minimum` as a dealbreaker that stops before scoring and writes no evaluation.
**Decision:** Keep the walk-away number out of that field. A range topping out at or below it is tiered "Walk-away" (recorded, not considered), except a borderline range with substantial equity, which is scored and capped at B. No posted pay is never a walk-away and never a miss; it's flagged for verification.
**Why:** Every role should be recorded (the Notion DB doubles as market data), and missing pay isn't bad pay.

## D13 — Exclusions follow ownership, not investment; some signals are flag-only (2026-10-30)
**Decision:** An excluded company's subsidiaries are excluded; companies it merely invested in are not (e.g. an Amazon-backed AI lab is fine). "Built to grow into a quota" and postings older than 60 days are flags, not tier changes.
**Why:** Surfaced by the first end-to-end evaluation, where the reference role hit all three edge cases.

## D14 — Add poppler for PDF text extraction (2026-10-30)
**Decision:** Install poppler (`pdftotext`) via Homebrew. Free, local, open source.
**Why:** career-ops' intake script and its ATS checks on generated CV PDFs both need it.
**Trade-off:** One more system dependency to list in `install.sh` (Phase 9).

## D15 — Extraction runs on the Claude Code CLI with the subscription, locked down by flags (2026-11-02)
**Options:** (A) `claude -p` on my subscription; (B) Anthropic API key, pay per use.
**Decision:** A. Every call runs from an empty temp dir with an explicit tool list (`--tools ""` for extraction), `--permission-mode dontAsk`, `--strict-mcp-config`, and no session persistence; never `--dangerously-skip-permissions`. Our own code re-checks every answer against the schema.
**Why:** Matches the requirements and adds no bill. The strictest `--bare` mode needs an API key, so isolation comes from the flags instead.
**Trade-off:** Daily volume counts against plan usage limits; switching to B is one setting.

## D16 — Rule numbers live in a private settings file, with a drift check (2026-11-02)
**Options:** (A) private `config/tier-rules.json` plus a public example; (B) parse the numbers out of `_custom.md`.
**Decision:** A. `engine/check-rules-drift.mjs` fails if the settings and `_custom.md` disagree on a number.
**Why:** No personal values in the repo, and no fragile prose parsing.

## D17 — Code reads exact facts; the model reads judgment, with quotes (2026-11-02)
**Decision:** Pay, posting date, locations and title come from the ATS's structured API (Ashby, Greenhouse, Lever). The model returns only judgment fields, each with a verbatim JD quote. If JD-text pay disagrees with the ATS, both are shown and flagged.
**Why:** The Phase 1 run showed a text fetch can miss a posted salary.

## D18 — Company bar: watchlist, then a separate web-research step (2026-11-02)
**Context:** The extraction model has no web access by design (D5), but recently funded companies are where model memory is weakest.
**Decision:** A private watchlist is checked first. Otherwise a separate `claude -p` call that receives only the company name, may only search and read the web, and must cite sources. It runs only when the role could otherwise reach S or A. Results are saved to the watchlist as unverified.
**Why:** Keeps untrusted posting text away from the step that can browse, and spends research only where it can change the decision.

## D19 — Unclear judgment blocks S but isn't a miss (2026-11-02)
**Decision:** If family, shape, fit or company is unclear, the tier is capped at A and flagged "Verify before S". Missing pay keeps its own rule (not a miss, flagged).
**Why:** S triggers alerts and prep packs, so it should rest on evidence.

## D20 — Sonnet for extraction, measured (2026-11-02)
**Decision:** Sonnet by default (`KIT_EXTRACT_MODEL` overrides).
**Measured on the first runs:** a new company takes 2 calls (extraction + research, about 30 s); a known company takes 1 call, about $0.01–0.05 API-equivalent. Everything else (pay, dates, rules, tiering) is plain code.
**Why:** Traps are the core precision problem, so the model shouldn't be the cheapest; Phase 3 calibration will show whether a bigger model is ever needed.

## D21 — Rule interpretations encoded in Phase 2 (2026-11-02)
- "Mixed shape → S only at exceptional companies": Mixed shape counts as met only at an `exceptional` company; elsewhere it's a miss.
- Roles outside the home metro and not remote: tiered by the `location.outside_home_metro` setting; I chose **Excluded** (recorded with the reason, not considered). Multi-office postings that include the home metro are eligible.
- Years of experience roll forward automatically from a start date.

## D22 — Calibration set is private, with frozen facts (2026-11-02)
**Decision:** Labeled roles, frozen extraction snapshots and reports live in the private data dir; the repo holds the runner and comparison logic. Re-tiering from snapshots costs zero AI calls; `--refresh` re-extracts only when the instructions change. Each miss is classified as an AI misread (a confirmed key fact differs) or a rule miss.
**Why:** Labels reflect personal judgment and thresholds; frozen facts make rule changes testable in under a second. Whether labels go public is a Phase 9 decision.

## D23 — Rule clarifications from calibration (2026-11-02)
- Hands-on building in service of a customer outcome the role owns stays **Strategic**; Mixed means splitting time between strategy and executing plans or configuration others define.
- Travel: a flat 50%, or a range whose top is above 50%, is a red flag; a range topping out at 50% is fine.
- A required **book of business** (measured on retention, renewals or expansion) is a red flag; an optional path into account ownership isn't.
- Post-sale AI deployment / adoption roles count as the deployment family.
- Top non-AI companies can be strong; an AI-native marker breaks ties within a tier and never changes it.
- **Below level:** a role asking 3+ years less than the candidate has is capped at A (a cap, not a drop).
**Why:** Each came from a disagreement between old labels and the new pipeline on real postings.

## D24 — Calibration result, and its limit (2026-11-02)
**Result:** 12 live roles (13 labeled; one posting was removed). First run 9/12; after fixing an engine bug (a red flag quoted twice dropped two tiers) and recording the candidate's company call for one company, 10/12; after two label decisions (one relabel, one new rule), 12/12.
**Limit:** These 12 roles shaped the rules, so 12/12 overstates accuracy on new roles. New postings should be added to the set as they're labeled, and the match rate tracked on roles the rules never saw.
**Also found:** two boards (Built In, Rippling) carry pay only in page data that text extraction drops; aggregator boards (a16z, Scale, Thrive) link to Ashby postings the reader supports. Both are Phase 5 inputs.

## D25 — Notion via a page-scoped integration key (2026-11-02)
**Options:** (A) internal integration key, shared with one parent page; (B) the Notion connector in Claude chats.
**Decision:** A. The key lives in `private/.env`.
**Why:** Only A works for the unattended daily run, and page scoping limits what a leaked key could see.

## D26 — Job postings sync one way; companies are edited in Notion (2026-11-02)
**Decision:** Postings flow from the kit to Notion and are never read back; columns the candidate owns (Status, Notes) are never overwritten. Company calls (status, verified, watch) are edited in Notion and read back before tiering; if Notion can't be read, the run stops with a clear error.
**Why:** Tiers come from rules, not cells; verifying companies is the one recurring edit and belongs where the candidate works.

## D27 — Job Postings fields, with Company as a link to the Radar (2026-11-02)
**Decision:** Pipeline-owned fields (role, company link, tier, why, flags, family, shape, pay, locations, work model, years asked, posted, date added, last seen, live, board, URL) plus candidate-owned Status and Notes.

## D28 — Archive the old Job Postings database without migrating (2026-11-02)
**Why:** Its tiers used old rules and many links are dead; the useful roles are already in the calibration set.

## D29 — Phase 4 split into 4a (market database) and 4b (Notion) (2026-11-02)
**Why:** The market data model had to be settled first and needs no key; smaller PRs.

## D30 — A local database is the source of truth for market data (2026-11-02)
**Context:** The candidate wants month-by-month hiring data (e.g. NYC deployment-strategy roles per company) for a newsletter.
**Options:** (A) SQLite file in the private data dir, Notion as the working view; (B) Notion only.
**Decision:** A, using Node's built-in `node:sqlite` (no dependency).
**Why:** Time series, rankings and CSV exports are easy in a database and awkward in Notion; history isn't locked to one vendor.
**Trade-off:** One more file to back up.

## D31 — Record every posting; spend AI only on target roles (2026-11-02)
**Decision:** Every posting from every scanned source is stored and classified by code (title family, home metro). AI extraction and tiering run only on home-metro target-family roles.
**Why:** Full market counts and context at no AI cost.

## D32 — Coverage: broad sources plus a hand-collected recall check (2026-11-02)
**Decision:** Breadth comes from Phase 5 sources, including search-engine discovery of ATS postings. A monthly recall check compares a list the candidate collects by hand (e.g. a LinkedIn search; no scraping or automation) against the database and reports the share already captured.
**Why:** Makes coverage measurable and honest in the newsletter.

## D33 — Market definitions are frozen and versioned (2026-11-02)
**Decision:** Each posting stores the classifier version that labelled it; changing a definition is a recorded decision; scans are logged so gaps aren't read as zero hiring; a posting closes only after two complete scans miss it.
**Why:** Month 1 and month 12 must be measured the same way, or the charts mislead.

## D34 — Notion client: paced, no retries (2026-11-02)
**Decision:** Requests are spaced under Notion's ~3/second limit; any error (including rate limiting) stops the run with Notion's message. Database ids live in `<data dir>/config/notion.json`; only the integration secret is in `.env`.
**Why:** The fail-loudly rule (D7) requires a decision before adding retries; pacing should make rate limits rare. If unattended runs hit them in practice, a bounded retry is a candidate decision for Phase 7.

## D35 — Single-role sync from tier.sh; company calls pulled first (2026-11-02)
**Decision:** `tier.sh` pulls company calls from Notion before tiering (stopping if Notion can't be read) and syncs only the role it tiered (about 4 Notion calls). `--no-notion` skips both with a printed warning. The old Job Postings database was renamed "(archived 2026-11)", with nothing deleted. Its Status options, Favorite, Fit and GM/Product path ideas carried into the new layout.

## D36 — Your Notion company columns: last-written tracking (2026-11-02)
**Context:** Review found two bugs: company calls made in Notion for companies not yet on the watchlist were skipped, and research arriving after a Radar page existed was overwritten by the page's default "unknown".
**Decision:** The kit records the value it last wrote to each candidate-owned company column. Notion differing from it means the candidate edited it (their value wins); Notion matching it lets newer kit information through. Pull and sync each record only what they actually did. Company Radar shows kit-written "Open postings" and "Open deployment postings" instead of rollups of tiered roles.
**Why:** The candidate's company calls must never be lost or silently reverted, and the Radar needs counts of the whole job board, not just tiered roles.
