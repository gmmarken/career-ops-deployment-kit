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

## D37 — A separate enrich step researches every company (2026-11-02)
**Options:** (A) a separate command that researches companies with no researched info; (B) research every company at tiering time.
**Decision:** A (`scripts/market.sh enrich`). It fills empty fields only and never touches the candidate's company calls. Tiering keeps researching only companies whose role could reach S or A.
**Why:** The Radar doubles as the newsletter's company list, so every company needs real info, but tiering should stay lean.

## D38 — History is append-only (2026-11-02)
**Options:** (A) change tables (`posting_changes`, `company_snapshots`, `funding_rounds`, `company_calls`); (B) daily copies of the whole database.
**Decision:** A. Nothing is overwritten without the old value being kept. Every company save says where the change came from (research, Notion, import) and who made it (kit or the candidate).
**Why:** Precise questions ("funding rounds in October", "when did I change my call on X") stay easy, and storage stays small.

## D39 — Monthly numbers freeze, but only inside real tracking (2026-11-02)
**Decision:** Monthly stats per company, family and scope (home metro / all) are provisional while a month is open and freeze 7 days after it ends. Frozen numbers never change; a correction is a separate row with a reason. Only months from the first completed scan onward can freeze.
**Why:** Published charts must not drift. The tracking rule came from a mistake caught on the first run: backfilled one-off postings dated back to 2022 caused 47 months with zero scans to freeze. Those minutes-old, unpublished numbers were cleared and the rule added, with a test.

## D40 — Company records live in the market database (2026-11-02)
**Options:** (A) the database is the source of truth, and `companies.json` and Notion are views; (B) keep JSON as the source and only log history.
**Decision:** A. `companies.json` was imported once (history marked "import") and is now a generated copy; hand edits stop the run with a pointer to Notion.
**Why:** One source of truth, moved while the data is small.
**Consequence:** `market.db` is now valuable. Phase 7's daily runner needs a daily backup plus an offsite copy (a decision card then).

## D41 — Whole-board scans of known companies (2026-11-02)
**Context:** Company Radar's role counts only counted tiered roles (one or two per company), which made the numbers wrong rather than just incomplete. The candidate flagged this in review.
**Decision:** `scripts/market.sh scan` reads every open posting on each known Ashby, Greenhouse and Lever board (no AI), records it with its title family and home-metro flag, logs the scan, and closes postings missing from 2 complete scans. If one board fails, the others still run; the failure is reported, the run exits non-zero, and nothing on that board is closed. Boards without a reader are listed as not scanned.
**Result of the first scan:** 11 boards, 966 open postings (526 in NYC; 68 deployment-family, 30 in NYC). Market tracking officially began in November 2026.
**Next:** run it daily (Phase 5 scheduling / Phase 7 runner), add readers for Built In, Rippling and other boards, and decide how to tier new NYC target-family roles.

## D42 — Notion's Job Postings view holds tiered roles only (2026-11-02)
**Decision:** Every scanned posting lives in the market database and counts toward Company Radar's numbers, but only tiered roles appear in the Job Postings view.
**Why:** A single scan adds hundreds of engineering and sales roles that would bury the working view.

## D43 — First holdout test: 4/7, and the calibration runner fixed (2026-11-02)
**Context:** D24 warned that 12/12 overstated accuracy. Seven roles from the first fresh batch, never seen when the rules were written, were labeled and added as `holdout` cases.
**Result:** 4/7 matched. The three misses were two AI misreads and one rule question (D44–D46). Review also found the runner had never classified a miss (it read confirmed facts from the wrong place); fixed with a test, and the report now scores holdout cases on their own.
**Why it matters:** The honest accuracy number comes from roles the rules never saw; it's tracked separately from now on.
**After D44–D46:** 18/19 overall, holdout 6/7, every case re-extracted under the final prompt (34 AI calls, about $1.10 API-equivalent, on the subscription). Reading the same posting twice showed run-to-run noise: one travel flag and one strategic/mixed call flipped between runs. That noise, not the definitions, is now the main source of error; how to handle it (e.g. extract twice and flag disagreement) is a candidate decision, not built.

## D44 — "A book of deployments" is not a book of business (2026-11-02)
**Options:** (A) add a "does not count" example to the prompt; (B) require a second quote showing how the book is measured, checked in code.
**Decision:** A. Escalate to B the first time a new role repeats the misread.
**Why:** The definition was already right; the model needed the counter-example. Two EliseAI roles each lost a tier to "Hold a full book of concurrent deployments."
**Follow-up:** On re-extraction one role picked up `ticket_config_work` from "drive product configuration" instead; that flag now requires the role itself to do the configuration, not coordinate it.

## D45 — Back office includes ops for a customer-facing team (2026-11-02)
**Options:** (A) widen the definition: the role's main customers are internal teams, even teams that face customers; (B) keep it and record the disagreement.
**Decision:** A, worded by who the role's output serves (one internal team's management vs. pipeline, deals, pricing, product or customers). The first wording also caught a growth BizOps role rated A, so it was tightened; each strategy-and-operations case was then extracted twice and came out right both times.
**Why:** A CS Strategy & Operations role building capacity models, comp plans and dashboards for the CS org reached S; the candidate rates it A ("internal consultant" work is what they're moving away from). Roles owning company-level growth or pricing calls stay out.

## D46 — Reach cap graded by the gap (2026-11-02)
**Options:** (A) 1 year short → max A, 2 years → max B; (B) keep max B; (C) cap only hard asks, not "you likely have."
**Decision:** A (`caps.reach_1_year` in the settings).
**Why:** The candidate rated a strong role asking one more year than they have as A. Evidence is thin (one labeled case), so the holdout score is watched for over-promotion.

## D47 — Daily runs start in Phase 5, as the first piece of the Phase 7 runner (2026-11-02)
**Decision:** launchd on the Mac runs the scan and batch tiering daily; any failure, including a single skipped board, reaches the candidate by iMessage plus the run log. New-S alerts and the weekly email stay in Phase 7.
**Why:** Missed days are gaps in market data that can't be recovered. **Trade-off:** runs only while the Mac is awake (a missed run fires on wake).

## D48 — Daily database backup with an iCloud copy (2026-11-02)
**Options:** (A) 30 dated local copies + iCloud Drive copy; (B) local only; (C) encrypted copy to a new cloud service.
**Decision:** A, starting with the daily run. A failed backup is reported like any failure.
**Why:** `market.db` holds history nothing else has (D40); iCloud is already private to the candidate and costs nothing new.

## D49 — Title classifier v2: patterns plus a no-AI text check (2026-11-02)
**Options:** (A) more title patterns; (B) patterns plus a keyword scan of borderline postings' text, with only hits going to AI; (C) AI triage of every home-metro "other" title.
**Decision:** B, as `title-v2`. Postings keep the classifier version that labelled them (D33).
**Why:** The candidate's definition is "not just titles with deployment strategy in them"; B widens the net while spending AI only on promising roles. Revisit C if the monthly recall check shows misses.

## D50 — Board reader order (2026-11-02)
**Decision:** Investor job boards (a16z, Scale, Thrive Getro boards → resolved to their Ashby postings) first, then Rippling, then Built In NYC only after the candidate reviews Built In's terms of use.
**Why:** Least risk and least work first; Built In is a third-party site, not an employer's own board.

## D51 — Companies to Watch = the Radar's Watch checkbox; startup boards via Getro (2026-11-02)
**Decision:** Companies ticked *Watch* in Company Radar have their boards added to the scan automatically. career-ops v1.38.0 has no startup-boards plugin, so the kit reads public Getro boards itself; boards that need a sign-in (e.g. YC) are skipped.
**Why:** One place for company calls (D26); Getro overlaps the investor-board reader.

## D52 — Search-engine discovery via Serper (2026-11-02)
**Options:** (A) Serper (Google results by API, small pay-as-you-go cost); (B) Brave Search API; (C) no key.
**Decision:** A. Price is confirmed at sign-up before the key is created; the key lives in `private/.env`. A failed search is reported, never replaced by another provider.
**Why:** The cheapest way to find NYC companies we don't know about yet, which is the main coverage gap.

## D53 — Daily unattended run now, in minimal form (2026-11-02)
**Context:** Market tracking began 2026-11 and the monthly numbers depend on a scan every day; a missed day leaves a gap (D33, D41). The roadmap put the daily runner in Phase 7.
**Implements D47** (Gabriel's call, card 4A); this entry records how it was built.
**Decision:** A launchd job (the Mac's built-in scheduler) runs `scripts/daily.sh` once a day. Every step runs even if an earlier one failed. Everything goes to `private/logs/daily-YYYY-MM-DD.log`, and any failure, including one board failing, sends one iMessage listing every problem. A failed board is skipped with no substitute data (D41's isolation, not a fallback). A step that hangs past 2 hours is stopped and reported. The iMessage handle and iCloud folder live in `private/config/daily.json`; the plist in the repo is a template with placeholders, and loading it waits for Gabriel's OK.
**Why:** Closes the data-gap risk now at small cost; the S-tier alert and weekly email stay in Phase 7.
**Trade-off / limits:** If the Mac is off at run time that day is missed (launchd runs a missed job on wake from sleep, not after power-off). If the iMessage itself can't be sent, the error lands in the run log and `launchd.err.log` only; there is no second notice channel (that would be a fallback needing its own decision). Runs from whichever branch the main kit checkout has checked out.

## D54 — market.db backups: daily dated copy + one offsite (2026-11-02)
**Superseded in part by D59:** the separate iCloud copy and `icloud_dir` are gone; the dated copies reach iCloud through the synced workspace folder (D58).
**Context:** Since D40 the market database is the source of truth for postings, companies and history.
**Implements D48** (Gabriel's call, card 5A); this entry records how it was built.
**Decision:** The daily run's last step writes `private/backups/market-YYYY-MM-DD.db` with SQLite's `VACUUM INTO` (a consistent copy even while the database is open; a raw file copy could catch it mid-write), checks the copy's integrity, keeps the newest 30, and overwrites `market-latest.db` in the iCloud Drive folder named in `private/config/daily.json`. A backup failure is reported like any other failure.
**Why:** 30 days covers noticing a bad run; the iCloud copy survives losing the Mac.
**Trade-off:** About 1 MB per copy today. The offsite copy is only the latest, so a bad database synced offsite overwrites the good one; the 30 local copies cover that.

## D55 — Travel given as trips is converted to a percentage (2026-11-02)
**Context:** One run flagged EliseAI Lead Deployment Strategist as 50%+ travel for "~2x per month for ~2-3 days", which is 4–6 of about 21 working days (20–30%). The candidate does not count that as 50%.
**Options:** (A) tell the model to convert trip counts against ~21 working days a month and flag only at 50%+; (B) flag only explicit percentages; (C) leave it and rely on the noise check.
**Decision:** A, with the twice-a-month line as the worked example of what does not count.
**Why:** B would miss postings that describe heavy travel as weekly on-site days. The engine still decides the tier; only the flag definition changed.
**Result:** all 19 re-extracted (19 AI calls). EliseAI Lead no longer gets the flag; the two roles with real 50%+ travel (Distyl "50%", Palantir "25–75%") still do. 18/19, holdout 7/7. The one miss moved to Decagon BizOps Growth (read as "other", not BizOps), a role that came out right in the two runs before: more run-to-run noise, not the travel change.

## D56 — Title-v2 as built: new patterns, a "borderline" label, and a three-part text check (2026-11-03)
**Context:** D49 chose patterns plus a no-AI text check. This records the definitions.
**Decision:**
- New titles counted directly: Solutions Strategist, Deployment Lead, non-engineer forward-deployed titles (lead, manager, strategist…), Strategy & Planning (BizOps). Engineer titles that mention forward-deployed count as FDE.
- A `borderline` label for titles that may be target roles (Solutions Consultant/Consulting, Product Operations, Agent Product Manager, Engagement Manager, Strategic Growth/Projects, "… Strategy", Strategist, Implementation Lead/Manager, Transformation, Founder's Associate…), unless the title is plainly engineering, research, sales development, recruiting, marketing, design or legal.
- Text check (`text-v1`): a borderline NYC posting passes only if its text mentions **AI**, **putting it into use** (deploy, implement, roll out, forward-deployed) **and customers**. Only passes are tiered; the words found are stored.
- `market.sh relabel` moves **open** postings to title-v2, logging each change; closed postings keep title-v1 (D33). November 2026 is still provisional, so no published number changes.
**Measured on the live database (open NYC postings):** 2 roles move into the deployment family (EliseAI Deployment Lead, Thread AI Federal Deployment Lead); 20 become borderline, of which 11 pass the text check (e.g. Decagon Agent PMs and Agent Strategy Manager, EliseAI AI Engagement Managers); 4 engineer titles move to FDE.
**Trade-off:** EliseAI's Growth Strategy Analyst (labelled B) fails the text check (no deployment wording), so a role like it would not be tiered. Revisit with the monthly recall check.

## D57 — Investor boards read from their public sitemap and job pages (2026-11-03)
**Context:** D50–D51 chose investor job boards on Getro first.
**Decision:** For each board in `private/config/sources.json` (Thrive Capital, Scale Venture Partners), read the public sitemap (every job link, title in the link). For each company with a target or borderline title not yet traced, open one job page to learn where the company posts jobs; Ashby, Greenhouse and Lever boards join the daily scan, and postings are read from the company's own board. Requests name the kit in their user agent and are spaced 1.5 s apart.
**Not done:** Getro's search API (it is meant for the board's own pages; calling it from outside meant pretending to be the site, which we won't do). a16z's job board is not on Getro and needs its own reader.
**Also fixed:** Greenhouse boards that link to the company's own site name the job only in `?gh_jid=`; posting identity now keeps it (otherwise a whole board collapsed into one posting).
**Watch (D51):** a company ticked Watch with no readable board is reported as a problem in the scan, with the fix: `market.sh add-board <job link>`. Watch ticks reach the database when roles are tiered (Notion pull), so a new tick takes effect on the next day's scan.

## D58 — The workspace stays in iCloud Drive (2026-11-03)
**Context:** The candidate's Mac syncs Desktop & Documents to iCloud, so the whole workspace, including `private/` (keys, CV, profile, the live `market.db` and its backups), is already in iCloud Drive.
**Options:** (A) move the workspace to a folder that doesn't sync and keep a separate daily iCloud copy of the database (D54); (B) keep it where it is and drop the separate offsite copy, since `private/backups/` already syncs.
**Decision:** B, the candidate's call.
**Why:** No move or re-pointing of sessions and schedules; the dated backups reach iCloud anyway.
**Trade-off accepted:** iCloud may sync `market.db` while a scan writes to it (risk of a conflict copy or a damaged file; the 30 dated backups are the recovery path), and keys and personal files are stored in iCloud.

## D59 — Backups reach iCloud through the synced workspace, checked each run (2026-11-03)
**Context:** Gabriel keeps the workspace in `~/Documents`, which iCloud "Desktop & Documents Folders" syncs (D58), so `private/backups/` is already offsite. D54's extra `market-latest.db` copy into a chosen iCloud folder doubled that.
**Decision:** Gabriel dropped the separate offsite copy. `private/config/daily.json` now needs only `imessage_to` (a leftover `icloud_dir` stops the run with a pointer to this entry). Each run, after writing and pruning the dated copies, the backup step checks that `private/backups/` sits in an iCloud-synced folder: iCloud Drive itself, or `~/Documents` / `~/Desktop` carrying macOS's `com.apple.icloud.desktop` sync marker. The run log names that folder. If the check fails (workspace moved, sync turned off), the backup step is reported as a failure by iMessage, so "backed up to iCloud" is never claimed falsely.
**Why:** One place for backups, no second folder to configure; the check keeps D54's offsite guarantee honest.
**Trade-off:** The check confirms the folder is set to sync, not that iCloud has finished uploading today's copy. A corrupted database also syncs, but only into a new dated file; the 30 older copies stay, locally and in iCloud.

## D60 — Rippling board reader (2026-11-03)
**Context:** The coverage review after D57 found companies posting on Rippling's job boards, including an NYC Deployment Strategist at Pace (a Thrive company) the scan was missing. The candidate approved building the reader.
**Options:** (A) read Rippling's public board and job pages; (B) keep listing Rippling companies as unreadable and check them by hand.
**Decision:** A. Rippling has no public JSON API, so the reader uses the data its public pages carry: the board page lists every job with its locations (paged with `?page=N`), and the job page has the description. Requests name the kit in their user agent. Rippling's robots.txt allows the job boards; no automated-access clause was found in the terms pages we could read.
**Fail loudly:** Rippling pay has not been seen on any posting yet, so pay in any format is reported as an error instead of guessed; the first real example will teach the reader. A changed page layout is an error, never "no jobs".
**Also:** companies traced earlier (D57) to a board that was unreadable then are re-checked, so Pace and ProcessUnity join the scan.

## D61 — a16z portfolio board reader: relevant companies only, each page checked weekly (2026-11-03)
**Context:** a16z's job board (jobs.a16z.com) is not on Getro. Its sitemap lists about 690 company pages; each page carries the company's job titles (schema.org data) and links to its own job board.
**Options:** (A) open each company page, and add the company's board only if a title is a target or borderline title; (B) add every company's board; (C) wait.
**Decision:** A, the candidate's call. Each company page is rechecked about once a week (at most 150 pages per run, 1.5 s apart), so the first full pass takes about five daily runs and later postings are still caught.
**Trade-off:** big companies list only their first 25 titles on the page, so a company whose relevant roles sit past the first 25 is missed until they surface. Companies whose jobs link to their own website (not a readable board) are listed as unreadable.

## D62 — A missing pay range sets a ceiling: A, or B at a company that isn't AI-native (2026-11-03)
**Context:** The 11:05 PM batch produced 14 S roles. The candidate labelled the five BizOps S roles: Forus S, Garner Health S, Fora A, Nourish (Sr) Lead S&O B, Nourish Retention S&O B, naming as reasons "not AI-native", "industry", "pay not posted" and "role content". Across all 24 labelled roles, every S had a posted pay range; the two B's were the only roles with no pay at a non-AI-native company. Not being AI-native alone never lowered a label (Garner, Rippling: S with posted pay).
**Options:** (A) no posted pay → at most A, and at most B if the company is also not AI-native; (B) only the "at most A" part; (C) no change, collect more labels.
**Decision:** A, the candidate's call.
**How it applies:** a ceiling applied after drops (step 6b), not an extra drop. Applying it before drops broke two of the candidate's A labels (Cursor roles with no pay and one drop came out B). Unknown AI-native status counts as unknown, not "no".
**Result:** calibration 22/24 (holdout 11/12). The one rule miss left is Fora (A for industry and role content, a judgment call). Re-deciding the 98 open tiered roles from their saved facts (no AI) changed 5: Nourish ×2 S→B, SpaceX/Cursor CS Strategy & Ops S→A, and two EliseAI roles that had never been re-decided after D46's graded Reach cap (C→B, B→A).
**Trade-off:** the "not AI-native" part rests on one company's two roles. What would change it: a no-pay role at a non-AI-native company the candidate rates A or S.
**Also fixed:** the rules fingerprint stored with each decision only covered top-level setting names, so it never changed when a value inside (like a cap) changed. It now covers every value. New command `market.sh retier [--dry-run]` re-decides open roles after a rules change, recording only tier changes and syncing them to Notion.

## D63 — A text every morning: a calm summary when the run worked, a loud notice when it didn't (2026-11-03)
**Context:** D53 sent an iMessage only on failure. The candidate asked for a text on success too, as a daily reminder to check in and apply, with failures impossible to mistake for the normal text.
**Decision:** Every daily run sends exactly one text.
- **Worked:** "✅ Job search: morning run done (Tue, Nov 3)", boards checked and new postings, new NYC roles graded by tier, up to six S/A roles by name (⭐ for S), and "Time to review in Notion and apply." (or "Check Notion when you have a minute." on a day with no S/A).
- **Failed:** "🚨🚨 JOB SEARCH RUN FAILED 🚨🚨", the date, "N problems. Action needed.", each problem marked ❌, and the log path. Any failed step, even one, sends this instead of the summary.
**Fail loudly:** counts are read from the steps' own output; if a line can't be read, the text says "couldn't read the count (see log)", never a made-up zero. `scripts/daily.sh --sample-messages` sends one example of each, marked SAMPLE.
**Trade-off:** one more text a day. The summary only covers what the run did; it does not track which roles were already applied to.


## D64 — Drop the Built In NYC reader (2026-11-03)
**Context:** Built In NYC lists other companies' jobs. Reading it was planned "after a terms-of-use review" (Phase 5), and its terms don't make clear that automated reading is allowed.
**Options:** (A) the candidate reviews the terms and the kit reads it if allowed; (B) drop it.
**Decision:** B, the candidate's call: "it's not clear it's allowed."
**Trade-off:** companies that post only on Built In are missed. Search-engine discovery (Serper, D52) is meant to find NYC postings on companies' own boards and should cover most of that ground.

## D65 — The daily run starts through a small helper app that macOS can allow into Documents (2026-11-03)
**Context:** The first scheduled run (2026-11-03, 7:00 AM) started on time, but macOS refused to let `/bin/bash` open `scripts/daily.sh`: the workspace is in the Documents folder (kept in iCloud, D58), which macOS protects from background programs. It failed before the text code ran, so no text was sent at all: a silent failure, against the "unattended runs report their errors" rule.
**Options:** (A) give `/bin/bash` Full Disk Access: 2 minutes, but every background script on the Mac gets every file; (B) move the workspace out of Documents: undoes D58 and loses the iCloud copy; (C) a small helper app that only runs the daily job, allowed once into Documents.
**Decision:** C, the candidate's call. `scripts/install-daily.sh` builds `~/Applications/CareerOps Daily.app` (an AppleScript app, built on the Mac from `scripts/launchd/CareerOpsDaily.applescript.template`; personal values go only into the built app and `private/launchd/`). launchd starts the app; the app runs `scripts/daily.sh`. On the first run macOS asks to allow the app into Documents and to control Messages; the candidate clicks Allow.
**Second notice (changes D53's "no second channel"):** `daily.mjs` exits 0 (fine) or 1 (a step failed) only after it has sent the morning text. Any other exit means the run couldn't start or couldn't send its text, so the app sends the "🚨🚨 JOB SEARCH RUN FAILED 🚨🚨" text itself, with the error. Every exit is logged in `~/Library/Logs/career-ops-daily.log` (outside Documents, so it can be written even when Documents is blocked).
**Also:** `install-daily.sh --run-now` starts the run through launchd now, exactly as at 7 AM; `--test-message` sends one test text through the app (checks the Messages permission). `--kit-dir` picks which checkout the run uses.
**Trade-off:** macOS ties the Allow to the exact app build, so the app is rebuilt only when its content changes (handle, paths, template); a rebuild means clicking Allow again. If Messages itself is broken, neither text can be sent; the error is only in the logs.
