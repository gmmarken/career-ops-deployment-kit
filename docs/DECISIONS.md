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

## D66 — Search-engine discovery: weekly, target titles × job-board sites, boards added automatically (2026-11-04)
**Context:** D52 chose Serper (Google results by API) to find NYC companies none of our sources know. The candidate signed up: 2,500 free credits, then $50 per 50,000 (one search page = one credit). He prefers buying small amounts.
**Options and decisions (all the candidate's calls):**
- *How often:* (A) weekly, or (B) daily. **A.** A search finds new companies, and the daily board scan already catches new postings at known ones. About 140–200 credits a month, so the free credits last over a year; daily would use about 1,000 a month.
- *What to search:* (A) the 8 target titles (deployment strategist, forward deployed, AI strategist, solutions strategist, AI transformation, strategy & operations, business operations, chief of staff) on the 4 readable job-board sites (32 searches), or (B) also the borderline titles (about twice the credits). **A.** Each extra title adds 4 searches. Place is `("New York" OR NYC OR Brooklyn)`, one search; plain "NY" is left out because it also matches Albany or Buffalo.
- *What happens to a board found:* (A) added to the scan automatically, like a16z (D61), or (B) queued for approval. **A.**
**How it runs:** inside `market.sh scan`, after the investor boards, when the last successful discovery run is 7+ days old. A full first page (10 results) that turned up a new board earns page 2 (`max_pages` 2). Hard cap of 50 credits per run. A bad key or no credits (HTTP 400/401/403) stops the run at once and is reported in the morning text; one failed search is reported and the rest still run. No other search provider (D52). A run with errors doesn't count as done, so it tries again the next day.
**Only readable boards are added:** a board not yet known is read once (free) before it is added; one that fails is listed in the scan output and tried again on the next discovery run, so a dead board can't fail every daily scan. First live run (2026-11-04): 28 searches hit the 50-credit cap and found 226 new boards. 5 were Rippling language codes (bug fixed), and 5 couldn't be read; both groups were removed.
**Kept separate:** "NYC tech funding sites" (finding newly funded startups before they post jobs) is a different approach and moves to Phase 6, next to SEC Form D.
**Trade-off:** Google only shows postings it has indexed, so very new postings may take days to appear. A board found this way is named by its board slug (e.g. "hippocratic ai") until a posting or Notion gives the company name.

## D67 — The daily run grades at most 30 roles a day, best role families first, 5 per company (2026-11-04)
**Context:** The first search-engine discovery run (D66) added 216 boards, so the next daily run would have graded 231 new NYC roles in one go (82 deployment / AI strategist, 136 BizOps, 47 of those at DoorDash), against about 7 on a normal day. Each grading is one AI call on the candidate's Claude plan, so 231 in one morning would likely hit the usage limit partway, fail the rest and use up the day's Claude.
**Options:** (A) a daily cap of 30, best role families first, at most 5 per company; (B) no cap.
**Decision:** A, the candidate's call.
**How it works:** `tier-new.sh --limit N --per-company N` picks deployment / AI strategist roles first, then forward-deployed PM, chief of staff, BizOps, then borderline titles that passed the text check, oldest first within each. The daily run reads both numbers from `private/config/daily.json` (`tier_per_day`, `tier_per_company`; required, with a clear error if missing). Roles over the cap aren't failures: they wait, and the morning text says "⏳ N more NYC roles waiting".
**Trade-off:** the backlog takes about 8 days to clear. BizOps roles wait behind deployment roles, so a strong BizOps role could be graded days after it appears. What would change it: raising `tier_per_day` once the backlog is gone, if usage allows.

## D68 — Hitting the Claude usage limit pauses grading, with a loud "paused" text (2026-11-04)
**Context:** Grading uses the candidate's Claude plan, which has a 5-hour usage limit. Without special handling, hitting it partway through the daily run fails every remaining role one by one and sends the full failure text, though nothing is broken.
**Decision (the candidate's call):** When a grading call fails on the usage limit (5-hour, session or weekly wording), `tier-new` stops at once. It keeps the roles already graded and prints "Paused: Claude usage limit reached after N of M graded". The morning text then starts "🚨 ⏳ Job search: grading PAUSED". The alarm emoji is the candidate's ask, so the text still stands out. It says nothing is broken, and the waiting count includes the ungraded roles. Unpaused roles stay ungraded, so the next run grades them first (they are the highest-priority ones).
**Not a retry:** grading does not resume when the limit resets. The next 7 AM run, or `install-daily.sh --run-now`, picks the roles up. Any other grading failure still sends the full 🚨 failure text.
**Trade-off:** the limit is spotted by the wording of Claude's error. If that wording changes, the run falls back to the old behaviour (every remaining role fails loudly), so a change can't hide anything.

## D69 — Search-engine discovery: core titles every run, the rest take turns (2026-11-04)
**Context:** D66 searches 8 titles × 4 job-board sites with a 50-credit cap. The first run used the cap after 28 searches, and every run went in the same order, so the last titles (business operations, chief of staff) could be cut off every week.
**Options:** (A) core titles first every run, the rest rotate through what's left of the cap; (B) all titles rotate; (C) raise the cap to cover every title each week (about 64 credits a week).
**Decision (the candidate's call):** A, with three core titles: deployment strategist, forward deployed and AI strategist (12 searches, up to 24 credits). The other seven (solutions strategist, AI transformation, strategy & operations, business operations, chief of staff, S&O, GTM strategy; 28 searches) share the rest of the 50 credits. Each run continues where the last one stopped, and the position is saved in `market.db` (`meta` table). Config: `serper.core_titles` and `serper.rotating_titles`; the old single `titles` list is refused with a clear message.
**Two titles added (the candidate's call):** "S&O", the short form of a target title the spelled-out search can miss, and "GTM strategy", a borderline title the tool already grades after a text check. Plain "GTM" and "operations" were left out: they mostly find roles the tool doesn't grade (sales, GTM engineering, warehouse or IT ops). Searching a title only finds companies; which roles are graded is still decided by the title classifier (D49, D56).
**Note:** the daily board scan already reads every known board each day, so deployment roles at known companies are found daily whatever the search order. This only decides how quickly *new* companies are found for each title.
**Trade-off:** a rotating title is searched about every 2 weeks instead of every week; raising the cap to 60 would keep a weekly pace for about 40 more credits a month. The rotation's first turn starts at chief of staff, then S&O and GTM strategy, the three titles never searched yet.

## D70 — SEC Form D as a funding source, with a contact email the SEC sees (2026-11-04)
**Context:** Phase 6 finds NYC companies right after they raise money, often before they post jobs. A Form D is the notice a company files with the SEC after a private funding round. EDGAR is free and its fair access policy allows automated reading (up to 10 requests a second), but every request must name a contact email; without one the filings are refused (HTTP 403, checked).
**Options:** (A) the candidate's Gmail with a "+sec" tag; (B) a new address used only for this; (C) skip Form D.
**Decision:** A, the candidate's call. The email lives only in `private/config/sources.json` (`form_d.contact_email`) and is never printed. Requests run about 4 a second.
**How it reads:** EDGAR's full-text search lists the state's Form D filings since the last good run (first run: `lookback_days`, 30; 3 days of overlap, since filings reach search a little late). The listing alone drops amendments (D/A), investment funds (3(c) exemptions) and other cities. Only the rest are opened, and the filing's own form gives the industry, amount sold, date of first sale and the officers and directors. Every filing looked at is recorded once (`formd_filings`); one that fails to open is reported and tried again on the next run.
**Trade-off:** Form D can come up to 15 days after the first sale, and some companies never file. The news readers (D72) cover that.

## D71 — Which Form D filings count (2026-11-04)
**Options:** (A) NYC addresses, operating companies in tech and health tech, $1M+ sold, first filings only; (B) A in every industry; (C) all of New York State.
**Decision:** A, the candidate's call. Settings in `form_d`: cities (the five boroughs' postal city names), industry groups (Computers, Telecommunications, Other Technology, Business Services, Other Health Care), `min_amount_usd` 1,000,000.
**Added while building (small call):** the first live check let through holding and fund vehicles filed under tech industries ("… TopCo LP", "… Holdings, LP", "… Labs I LLC"). Partnerships and trusts, and names that read as vehicles (LP, fund, SPV, co-invest, TopCo, a trailing roman numeral), are now screened out as "investment vehicle".
**Measured on the last 30 days:** about 1,000 NY filings listed; 372 funds, 395 amendments, 98 other industries and 14 small raises dropped; 25 companies counted (e.g. a $15M Brooklyn analytics startup, Modal's $602M round), about 6 a week.
**Known limit:** a legal name can differ from the name we know a company by ("Ramp Business Corp" isn't matched to Ramp). It stays a separate Radar entry, not merged on a guess.

## D72 — Funding news: TechCrunch's feeds and a weekly news search; AlleyWatch is not read (2026-11-04)
**Options:** (A) TechCrunch funding RSS feeds, NYC items; (B) Serper news search weekly; (C) both; (D) AlleyWatch.
**Decision:** C, the candidate's call.
- *TechCrunch* (every run, free): its RSS terms allow news-reader use, showing the feed's content with credit and a link. The kit keeps the headline, the link and "TechCrunch", and never opens article pages. TechCrunch's robots.txt blocks AI crawlers such as anthropic-ai by name. The kit doesn't crawl, sends no headline to an AI model, and reads only the feed, which robots.txt allows for everyone else.
- *News search* (every 7 days, 4 searches, 1 Serper credit each, about 16 a month): Google News results through the API we already pay for (D52). Only Google's headline, snippet and link are used, so a result from a site like AlleyWatch is never fetched from that site.
- *AlleyWatch*: its terms say its content may not be used "to construct any kind of database". Same reasoning as Built In (D64). The candidate can still read its daily report himself.
**How a headline is read:** by code, no AI: "<company> raises $X <round>". Headlines the code can't read (roundups, VC funds raising funds, "a startup raises…") are logged as such, not guessed. A headline is recorded when it places the company in NYC (New York, NYC, Brooklyn, Manhattan) **or** names a company we already track. In that case the new round is news to us wherever the story is set (e.g. Serval's $47M).
**Not used:** career-ops' own `company-funded.mjs` reads several feeds with a user agent that imitates a browser, which the kit doesn't do (D57).

## D73 — A newly funded company joins Company Radar automatically, NYC only for now (2026-11-04)
**Options (found company):** (A) added to Company Radar automatically, marked by how it was found, researched first, its job board added to the scan; (B) held for approval. **(Geography):** (A) NYC only; (B) NYC plus SF Series A–C AI companies.
**Decision:** A and A, the candidate's calls.
**How it works:** a round is matched to a known company by name, ignoring legal suffixes (Inc, LLC, Corp, PBC…). If there's no match, a record is created: status unknown, unverified, "Found via" Form D or News. A company we only knew from a job board keeps "Job board". Every round is kept in `funding_rounds` with where it came from (`found_via`); "Last raise" shows the newest. A company created this way gets its company call (status, AI-native) from its first research, unless the candidate has already set one in Notion. Grading also researches it if one of its roles could reach S or A. Research that names a careers page on Ashby, Greenhouse, Lever or Rippling adds that board to the daily scan, after one free read. Other careers pages are listed as "posts jobs somewhere we can't read yet". Watch stays the candidate's tick.
**Trade-off:** SF companies opening NYC offices are missed until SF is added (a settings change plus one decision).

## D74 — New Company Radar columns; leaders are names and titles from public sources only (2026-11-04)
**Options (columns):** (A) add them to Company Radar plus a saved view; (B) a separate "Newly funded" database. **(Leaders):** (A) names and titles from the company site, press and the Form D officer list, each with a source link, never contact details; (B) Form D names only; (C) no leaders.
**Decision:** A and A, the candidate's calls.
**Columns (all kit-written):** Deployment fit, Fit reason, Funding amount, Funding date, Funding source, Found via, Leaders, NYC presence (Yes / No / Unknown, never a guessed No), NYC evidence, Careers page. They're added to the existing Radar by `ensureRadarColumns` and are fine for older code to ignore. A saved Notion view, "🆕 Newly funded (last 30 days)", filters on Funding date and sorts newest first.
**Privacy in code:** the Form D reader reads only officers' names and roles. Their home addresses are in the filing but are never parsed. The research prompt forbids emails, phone numbers, addresses, social profiles and linkedin.com. Code then drops any leader entry sourced to LinkedIn, carrying contact details, or without a source link, and prints that it did.

## D75 — "Could they use a deployment strategist?": the model reports facts, code makes the call (2026-11-04)
**Options:** (A) research returns facts with evidence and a tested rule sets the label; (B) the model's own label.
**Decision:** A, the candidate's call (same principle as D4). Facts: sells to businesses, enterprise customers, real setup per customer (integration, configuration, change management), plus the existing AI-native. Rule (`engine/fit.mjs`): **Strong** if the company has open deployment-family roles now, or all four facts hold; **Possible** if it sells to businesses and is AI-first or hands-on to roll out; **Unlikely** if it sells to consumers, or is neither AI-first nor hands-on; **Unclear** otherwise. The reason shows each fact as ✓ / ✗ / ? with a quote. The fit is recomputed every run with no AI, since open roles change daily. It never changes a role's tier.

## D76 — Research pace and order, and the morning text line (2026-11-04)
**Options (pace):** (A) 10 companies a day in the daily run; (B) 25; (C) by hand. **(Text):** (A) one line in the morning text now; (B) wait for Phase 7's weekly email.
**Decision:** A and A, the candidate's calls. A new daily step, `market.sh radar --research N`, runs after grading so grading keeps first claim on the Claude plan (D67): Form D → TechCrunch → news search (if due) → research N → fit → Notion sync of the companies it touched. `research_per_day` (10) is required in `private/config/daily.json`. Order: companies found through Form D or news (newest round first), then companies with open NYC target-family roles, then the rest. "Needs research" now means never asked the Phase 6 questions. Older research is kept, and only empty fields are filled, so all ~350 companies take about five weeks. The usage limit pauses research like grading (D68). The morning text gets "🆕 N newly funded NYC companies: A, B, C (Company Radar)", plus a quiet line if research paused. One source failing is reported as a failure while the others still run.
**Measured:** 2 research calls ≈ $0.13 API-equivalent, on the plan. The first live run will list about 30 companies, from the 30-day look-back, and after that about 1–2 a day.

## D77 — Funding news: only recent stories count, and one raise is one round (2026-11-04)
**Found in:** the first live Phase 6 run. TechCrunch's funding feed also carries stories from 2025, so Substack's July 2025 raise was listed as newly funded. Several articles about the same raise were each saved as a round (Serval's $150M three times, Traversal's $120M twice, Clark's $11M twice).
**Fix (bug fixes inside D72–D73, no new source or cost):**
- *Age window:* a headline older than `funding_news.max_age_days` (30, required in `sources.json`) is logged with that reason and not counted. A headline with no publish date is logged and not counted. Its age can't be known, and missing facts aren't guessed.
- *Same round:* a round is another report of one on file when it's the same company, the amounts are within 10% (or neither has an amount and the round names match), and the dates are within 45 days. It then adds a source but no new round, doesn't move the raise date, and only fills in a missing round name. This applies to every way a round is saved (Form D, news, research), so a Form D and a news story about one raise are also one round.
**Options considered:** exact amount match only (misses "$13.2M" in a Form D vs "$13M" in the news); asking the model whether two articles are one raise (an AI call for a rule that code can decide, against D4).
**Trade-off:** two genuinely different raises of about the same size within 45 days would merge. That's rare at seed–Series C, and the second article still appears as a source.

## D78 — Each new S-tier role gets its own text, and a failed run still lists the roles it graded (2026-11-04)
**Context:** S roles reached the candidate only inside the morning summary, and a run with any failure sent only the 🚨 failure text, which named no roles. The 2026-11-04 test run graded 2 S roles that the failure text didn't mention.
**Options (alert):** (A) its own ⭐ text per S role right after grading; (B) A plus a midday run (D79); (C) keep S roles inside the summary. **(Failed runs):** (A) the failure text also lists S/A roles graded; (B) leave it as is.
**Decision:** 1B and 2A, the candidate's calls. Grading prints "⭐ alert: <pay> · <link>" under each S role. The run sends that role's text before company research starts: "⭐ New S-tier role: Company — Title", pay (or "pay not posted"), link. The failure text keeps its 🚨 heading and problem list first, then "Graded this run anyway (in Notion):" with up to six S/A roles. An S text that can't be sent is itself a reported problem.
**Trade-off:** an S role is mentioned twice on a good morning, in its own text and in the summary.

## D79 — A 1 PM run for roles posted during the day (2026-11-04)
**Decision (card 1B):** a second launchd job (`com.career-ops.midday`, `install-daily.sh --midday-at`, default 13:00) starts the same helper app in midday mode. It scans every board, then grades only roles first seen today (`tier-new --seen-since`), within the same 30-a-run and 5-per-company caps. It sends a text only for a new S role or a failure; a quiet midday sends nothing. No research, email or backup. A lock file (`private/logs/daily.lock`) keeps runs from overlapping: a midday run that finds the morning run still going skips and logs it, and a morning run that finds a run still going fails loudly. A lock left behind by a crashed run is cleared.
**Cost:** scanning is free. Grading uses the Claude plan only when roles appeared since the morning.
**Trade-off:** the morning backlog is never graded at midday, so a role first seen yesterday but still waiting is graded only by a morning run.

## D80 — The weekly email goes out through Apple Mail on the Mac (2026-11-04)
**Options:** (A) Resend: a new account and key, a third party sees the content; (B) Apple Mail through AppleScript, like the iMessage; (C) Gmail with an app password in `.env`.
**Decision:** B, the candidate's call. No new service or key; the email goes from the account Mail sends with by default, to `weekly_email.to` in `private/config/daily.json`. The subject, body and address are passed as arguments, never pasted into the script. A missing Mail account, a refused send, or no answer within 2 minutes is an error, reported like any failed step. `install-daily.sh --test-email` sends the SAMPLE email through the helper app, so the one-time "allow control of Mail" prompt is answered while the candidate is there.
**Trade-off:** Mail reports "sent" once the message leaves Mail, so a later delivery problem would show only in Mail. To revisit for the public release (Resend then works for anyone).

## D81 — Sunday 7 AM, plain text: the funded-company outreach list, then the week's roles (2026-11-04)
**Decision:** A, the candidate's call. A `weekly-email` step runs in the morning run on `weekly_email.day` ("Sunday"), after research and before the backup. Built from market.db by code, no AI (`delivery/weekly.mjs`):
1. **Newly funded NYC companies**: a round first recorded in the last 7 days from Form D or the news, NYC presence Yes. Best deployment fit first, then by amount. Each shows funding (amount, round, date, source), fit and its reason, what they do, leaders (public sources only), NYC evidence, open roles and the best one, the careers page and the source link. Facts not found say so ("not researched yet").
2. **New roles graded this week**: counts by tier, every S role and up to 15 A roles with pay and link, marked if closed since.
3. **Market**: postings opened and closed, open now, NYC target-family roles graded.
Plain text (Mail's support for formatted email from scripts is unreliable). `daily.sh --sample-email` sends it now, subject marked (SAMPLE).
**Trade-off:** no formatting or clickable buttons; links are plain URLs.

## D82 — Job boards that no longer exist are retired after 3 "not found" runs in a row (2026-11-04)
**Context:** Pryzm's and Pomelo Care's boards started answering "not found" (HTTP 404), which made every run a failure.
**Options:** (A) retire after 3 runs in a row; (B) by hand only; (C) on the first "not found".
**Decision:** A, the candidate's call. Each board scan is already logged. When a board answers 404 and its previous two finished scans did too, it's added to `retired_boards` (schema v6), its open postings close on the day they were last seen, and the scan reports it as retired, not as a failure. The morning text says "🗑 Retired N job board(s) that no longer exist". Until then, each 404 is reported with the count ("not found 2 runs in a row; retired after 3"). Any other error breaks the streak. `market.sh unretire <board>` scans it again. If research later finds the company's new careers page, that new board is added as usual.
**Also fixed in this phase:** Rippling pay ranges (`[{location, currency, frequency, rangeStart, rangeEnd}]`, first seen 2026-11-04) are now read. If ranges differ by place, the New York one is used; if there isn't exactly one New York range, it's reported, not guessed.

## D83 — Prep packs: new S roles automatically, older ones only when ticked (2026-11-04)
**Context:** When Phase 8 started, 39 open roles were already graded S, at 23 companies. At 5 packs a week that backlog alone would take about 8 weeks, and many roles would close first.
**Options:** (A) queue all 39 at the normal pace; (B) a one-time burst of 3 a day for about 2 weeks; (C) new S roles queue automatically, and older roles only when the candidate ticks a new **Make pack** box in Notion (which works on any role, A tier included).
**Decision:** C, the candidate's call. The database upgrade to v7 records `packs_auto_since` (the upgrade time). A role first graded S on or after it is queued automatically; a ticked role is queued as "you" and goes first.
**Trade-off:** S roles graded before Phase 8 get no pack unless ticked. What would change it: if the candidate would really apply to most of them, run the burst (B) once.

## D84 — The tailored CV may reword bullets, checked line by line; the candidate reviews it before applying (2026-11-04)
**Options:** (A) pick and reorder cv.md bullets word for word, with only the summary written; (B) reword bullets toward the posting, each naming the cv.md line(s) it came from, with code checks.
**Decision:** B, the candidate's call, on the condition that he reads every CV before applying.
**How it works:** The model gets cv.md as numbered lines (`packs/cvsource.mjs`) and returns a headline, a summary, bullets with `source_ids`, and skills. Code then checks each line (`packs/check.mjs`): every job kept, in order; each bullet names lines from its own job; every number in a bullet is in its source line; a number the source hedges ("~N", "nearly N", "under N") stays hedged, which closes D10's "~" gap; a "+" may be dropped, never added; skills only from cv.md's own list; a headline of 6 words or fewer, with no numbers. Then career-ops' fact gate (`verify-cv-facts.mjs`) checks the whole document, and career-ops renders it (`build-cv-html.mjs`, `generate-pdf.mjs`, which runs the gate a second time). Job headers, projects, education and interests are copied from cv.md by code.
**Trade-off:** a reworded bullet can still shift meaning in ways no check catches. That's why the candidate's own read, with the project map (D90), is the last check.

## D85 — Pack queue order and pace (2026-11-04)
**Options:** (A) a fixed rank in code; (B) newest first; (C) add a numeric score to the grading engine.
**Decision:** A, the candidate's call. Order: ticked roles first, then role family (the D67 order), then highest posted yearly pay (pay not posted last), then newest. Pace: 1 a day, rising to 3 on a day when 2 or more wanted a pack (built today plus waiting), and never more than 5 in any 7 days. These are `packs.per_day / max_per_day / max_per_week` in `private/config/daily.json` (required, checked at start). A blocked pack used a slot and counts; a failed one doesn't. A queued role that closes is dropped and reported.
**Trade-off:** posted pay stands in for a score.

## D86 — Packs are built in the 7 AM run and the 1 PM run (2026-11-04)
**Options:** (A) in the 7 AM run, after company research; (B) a separate evening job; (C) on demand only.
**Decision:** A, plus the 1 PM run builds packs too (the candidate's call), from the same daily allowance. The step is `scripts/packs.sh build`. The morning text lists packs built ("📦 N prep pack(s) ready", "🗂 N more queued"). The midday run sends each pack built its own "📦 Prep pack ready" text. Hitting the Claude usage limit pauses packs like grading (D68); the rest stay queued. A blocked or failed pack fails the step, so the 🚨 text names it.
**Cost, measured 2026-11-04:** 2 model calls per pack (Sonnet), about 1.5-2 minutes, about $0.21 API-equivalent.

## D87 — Where packs live: a folder on the Mac, and the text in the role's Notion page (2026-11-04)
**Options:** (A) a folder in `private/output/packs/` plus the text in the role's Notion page; (B) A plus the CV PDF uploaded to Notion; (C) the folder only.
**Decision:** A, the candidate's call. The folder (iCloud-synced, D58) holds `cv.pdf`, `cv.md`, `cv-map.md`, `cv-changes.md`, `cover-letter.md`, `interview-prep.md`, `outreach.md`, `research-next.md`, plus `posting.md` and `company.md` (what it was built from) and a README. Two new Job Postings columns: **Make pack** (checkbox, yours, never overwritten) and **Prep pack** (Queued / Ready / Blocked / Failed / Dropped, written only by the pack step). A built pack appends its text to the role's page. The CV PDF and the project map stay on the Mac.

## D88 — A failed fact check blocks the pack, with no retry (2026-11-04)
**Options:** (A) block and report; (B) one automatic retry with the reasons fed back.
**Decision:** A, the candidate's call. A blocked pack keeps its files and a README saying why; `scripts/packs.sh requeue <link>` builds it again once the cause is fixed. What would change it: more than 1 pack in 5 blocked → consider B.
**Found in the first live builds:** the banned-phrase list matches inside words (career-ops checks substrings), so a short banned figure blocked a longer true figure that contains it (narrowed with a leading space in `cv-facts.json`), and a banned word matched inside a software name quoted from a posting. The interview prep is gated only on what the candidate would say (answer outlines and how he'd address each gap), not on posting quotes or his questions for them. The banned phrases are given to the model up front.

## D89 — Drafts use only what the kit already has, plus a "research next" page (2026-11-04)
**Options:** (A) the posting, cv.md and the Company Radar research; (B) A plus fresh web research per pack (search credits, more untrusted text); (C) also look up email addresses (a paid service).
**Decision:** A, with the candidate's addition: each pack's `research-next.md` lists what the research doesn't say yet, and gives a ready-to-paste prompt for a separate Claude (Cowork) research session with web search. Outreach notes go to a leader named in Company Radar (checked by code) and to the hiring manager; at most 120 words, with no number in the ask; the candidate sends them himself.

## D90 — A project map with every tailored CV (2026-11-04)
**Context:** The candidate wants to be sure he can speak to every line, including ones carried over from an older resume that he no longer remembers in detail.
**Decision:** The candidate asked for it. `private/cv-projects.md` (private, never in the repo or Notion) has one section per cv.md line: the project, what he did, who he worked with, what he'd say, and which old resume it was on. `scripts/packs.sh notes` adds empty sections for new cv.md lines and lists the ones still empty. Each pack's `cv-map.md` shows every tailored bullet → its cv.md line(s) → the notes. Empty notes are flagged in the map and in the pack README, but don't block the pack.
**Also changed at the candidate's request:** cv.md now says "context engineering" (not "prompt and context engineering") and "AI agent" (not "AI tool"), with the old wording added to the banned phrases. GabesGridTalk moved under Projects, and "Additional" became "Interests".

## D91 — The CV look: navy (2026-11-04)
**Options:** (A) career-ops' default (teal and purple, with a gradient rule); (B) navy, one color; (C) black and gray; (D) the plainer "Jake" template (no Interests section).
**Decision:** B, the candidate's call, from the four looks rendered side by side with his own CV. It's set as `style.accent_color` / `secondary_color` (#1F3A5F) in `private/config/profile.yml`, which career-ops' PDF step reads; no code change.

## D92 — Follower count locked as a fact instead of banned numbers; "an estimated" is a hedge (2026-11-04)
**Context:** `cv-facts.json` banned other follower counts ("50K", "45K", "42K"…) so the side project's audience could only read "40,000+". Banned phrases match inside longer text, and one of them blocked a true figure. career-ops' own fact gate doesn't check counts of things like followers, which is why the bans had been added.
**Decision:** The candidate's call. "40,000+" is the locked figure (recorded in `allow_facts`) unless he says otherwise. The number bans are gone: the kit's line checks (D84, D88) block any number that isn't in cv.md, so another follower count can't get through. The migration kit's time savings now read "an estimated", which the line checks treat as a hedge like "~", so a tailored CV can't drop it.

## D93 — A job board that's "not found" but not yet retired is a summary line, not a failure (2026-11-05)
**Context:** On 2026-11-05 the morning text was a 🚨 partly because three boards answered "not found" (1 or 2 runs of the 3 that retire a board, D82). There was nothing to do; the retirement rule handles it.
**Options:** (A) a line in the ✅ summary; (B) keep the 🚨.
**Decision:** A, the candidate's call. The scan prints "Not found (retired after 3 runs in a row): <board> n/3 · …" and doesn't count those boards as failures; the morning text says "⚠️ N job boards not found (retired after 3 runs in a row): …". Any other board error (a server error, a reader that broke) is still a failure and a 🚨.
**Trade-off:** a board that's really gone stays quiet for up to 3 runs, which was already true for its postings.

## D94 — Requirements the candidate can't meet, vague travel, and other edge cases (2026-11-05)
**Context:** Three open roles requiring Portuguese or Spanish were graded S, because the grading never asked about languages. A role saying "will likely require significant travel" got no flag, because the travel rule only knew stated percentages. The candidate then answered a short interview about other edge cases.
**Decisions (all the candidate's calls):**
- **Excluded:** a required language he doesn't speak (`candidate.languages` in the tier settings; also caught from the title, e.g. "Portuguese Speaking", with no AI); an *active* security clearance (also from the title, e.g. "TS/SCI"); anything that isn't permanent full-time (contract, contract-to-hire, part-time, temporary, internship; also from the title, cautiously); an excluded industry (`excluded_industries`: crypto/web3 and tobacco/vape/cannabis for him; defense and gambling are allowed).
- **One tier down:** must manage people from day one; regular nights or weekends, or another region's working hours.
- **Flag only:** heavy travel with no number ("significant travel"); must be able to obtain a clearance; 5 days in the office; a required degree he doesn't have; a staffing-agency posting.
- **Nothing:** citizenship or sponsorship lines (he's a US citizen).
**How:** eight new questions in the extraction prompt and schema (the model reports, with quotes); `engine/tier-engine.mjs` step 1a decides. "Preferred" or "a plus" never counts as required.
**Re-grade:** open S and A roles are graded again once with `tier-new.sh --regrade S,A` (about 84 AI calls), after the calibration set passes.
**Small call:** "able to obtain a clearance" is a flag, not an exclusion, because many government-facing roles say it and the candidate may be eligible.

## D95 — Alerts also arrive as reminders, because texts to yourself never notify (2026-11-05)
**Context:** The daily texts go from the Mac to the candidate's own number, so the iPhone treats them as messages he sent: they arrive, but with no notification. He found the three "📦 Prep pack ready" texts in Messages but was never alerted.
**Options:** (A) also create a reminder, due now, in a "Job Search Alerts" list that iCloud syncs to the phone; (B) a push-notification app such as ntfy (a new outside service); (C) a second Apple ID for the Mac's Messages; (D) email.
**Decision:** A, the candidate's call. A new S role, a pack ready, a failed run, or a paused run each also create a reminder; the calm ✅ summary stays a text only. The list is `reminders_list` in `private/config/daily.json` (required). A reminder that can't be created is a reported problem. `install-daily.sh --test-message` now also creates a test reminder, which is how the one-time Reminders permission is granted; the helper app isn't rebuilt, so no new Documents permission is needed.
**Trade-off:** alerts collect in the list until ticked off.

## D96 — "Years in a field" isn't a hard gate, and an "or" list is met by any one item (2026-11-05)
**Context:** Re-grading after D94 dropped Context's Forward Deployed Strategist from S to C. The model read "2+ years of hands-on experience in investment banking, private equity, hardware engineering, management consulting, or a similar knowledge-intensive field" as an unmet hard gate, though the candidate has years of consulting.
**Decision:** The candidate's call. The extraction prompt now says years of experience in a field go in `years_required.min` and are not a hard gate, and a requirement listing options joined by "or" is met if the CV shows any one. Checked on the calibration set before merging.

## D97 — Accept the AI's run-to-run noise; no second reads (2026-11-05)
**Context:** Re-grading 85 open S/A roles moved about 1 in 11 for reasons unrelated to any rule (the model read a borderline posting slightly differently).
**Options:** (A) a second read for S/A roles, keeping the higher grade with a flag; (B) read every role twice; (C) accept the noise; (D) sharpen the questions that flip most.
**Decision:** C, the candidate's call. He reviews S and A roles himself, so a role one tier off is judged anyway; he'll skim B roles now and then. No routine re-grades.
**Trade-off:** a good role the noise drops to B isn't texted or packed.

## D98 — Prep-pack CVs follow the candidate's recruiter review (2026-11-05)
**Context:** The candidate ran the first three packs past an "expert recruiter" review (scores 63–74) and turned its suggestions into a rules file, kept privately as `private/config/tailoring-rules.md`. cv.md stays the only source of facts.
**Decision (the candidate's calls):**
- **Locked lines** (`private/config/cv-rules.json`): every CV includes the client-hire line, at least one Amazon Leo line, the partnerships line and the Copilot agent. They may still be reworded under the same checks; code blocks a pack that leaves one out.
- **Headline = the posting's title**, set by code, with location and work-model tags removed.
- **Role types and allowed rewordings** (sections 5–6 of the rules file) go into the tailoring instructions; the model names the role type, which sets bullet order and summary emphasis. Code can't check meaning, so the CV map review stays the backstop.
- **Fit report** (`fit-report.md`, also in Notion): verdict; requirement-by-requirement evidence; rejection risks; questions. Scores: ATS structure measured by career-ops' `verify-ats.mjs`; keyword coverage counted by career-ops' `keyword-match.mjs` (the model picks the posting's 15–25 core terms, code counts them on the CV; career-ops' own skill extractor finds no terms in non-technical postings); recruiter impact labeled as the AI's estimate.
- **ATS cleanup:** the template's empty, CSS-hidden consent box is removed (it read as hidden text: 94 → 99).
- **One page preferred,** two allowed, with a warning.
- **Skipped:** Word (.docx) output, re-ranking roles by type, a 95-point pass mark.
**Fixed while testing:** education lines shared ids with jobs (e1, e2), so the model's "e1" (a job) was read as a degree; education, projects and interests now have their own prefixes. "Fortune 500" was read by the fact gate as a count; names containing numbers are spelled out in the gate's copy only.
**Measured on Lio:** ATS 99/100; keyword coverage 14%. The coverage number is crude (exact phrases: "went live" doesn't count as "go-live"), so it's a list of terms to echo truthfully, not a grade.

## D99 — Line-specific banned words, starting with Lightning Supply (2026-11-05)
**Context:** The rule "never claim Lightning Supply made sales" was a global banned word ("sales"), which also blocked "Salesforce" and "your sales team". The 11 raw H&R Block figures on the banned list were redundant with the number checks and risky (e.g. "25%" inside "125%").
**Decision:** The candidate's call. `cv-rules.json` `line_rules`: words that may not describe one cv.md line, on the CV (bullets built from that line) or in a draft sentence that mentions it. Lightning's sales words moved there; the 11 raw figures were removed (the number checks still block them). Lightning's line now ends "wound down by selling the inventory and domain, recouping almost all losses". To watch for a week.

## D100 — The daily run keeps the Mac awake until it finishes (2026-11-05)
**Context:** A run takes 20+ minutes; after a short wake the Mac can fall back asleep mid-run.
**Decision:** `daily.sh` runs under macOS's built-in `caffeinate -i`, which blocks idle sleep only while the run lasts. No system setting changes. A scheduled wake (`pmset`) is optional and the candidate's to set; it doesn't work with the lid closed and no external display.

## D101 — Exact posting keywords, a names note, and a fixed AI-native summary sentence (2026-11-05)
**Context:** The first fit report showed 14% keyword coverage, largely because the CV used different words for supported facts ("went live" vs "go-live"); ATS systems match exact terms. The AI also skipped the job-search agent in the summary for an AI-native company, and a recruiter at Lio could confuse it with the client Amazon Leo.
**Decision (the candidate's calls):**
- The tailoring step now lists the posting's 15-25 core terms with the cv.md lines that support each, and must use the posting's exact wording for every supported term. Unsupported terms stay off the CV. The number and hedge checks still apply. The fit report shows coverage of all terms and of supported terms (target near 100%), and names supported terms still missing.
- `cv-rules.json` `name_notes` go to both AI steps (Amazon Leo is Amazon's satellite internet program, not the company Lio); cv.md's first Leo line now says so.
- For a company ticked AI-native, if the summary doesn't mention the job-search agent, code appends `ai_native_sentence` from `cv-rules.json` (fixed, fact-checked like the rest).
- Names that contain a number ("Fortune 500", "S&P 500") aren't read as numbers by any check.
**Measured on Lio:** keyword coverage 14% → 33% (all terms), 67% (supported terms).

## D102 — Every pack README opens with an ATS check; private notes get softer name checks (2026-11-05)
**Decision:** The candidate's call. Each pack's README starts with the ATS check: ATS structure (career-ops' checker), keyword coverage of the posting's core terms, coverage of the terms his CV supports, and pages. In the interview prep (private notes, never sent), a name career-ops' fact gate can't find ("lists Salesforce") is a warning rather than a block; numbers and banned phrases still block there, and the cover letter and outreach stay fully strict.
**Known limit:** the core-term list is picked by the AI each build, so coverage moves by about ±10 points between builds of the same posting (Edra: 71%, then 58%).

## D103 — A keyword bank: approved terms tied to the experience that makes each true (2026-11-05)
**Context:** Across the 79 open S/A postings, common terms (customers, ownership, requirements, implementation, playbook, workflows, AI agents…) were missing from the CV word for word, though the experience behind many was real. ATS systems match exact words.
**Decision:** The candidate's call. `private/config/keyword-bank.md` (`keyword_bank` in `cv-rules.json`, required) lists approved terms, each with the experience behind it, its limits, and a "Never" list (C-suite, champion, roadmap ownership, healthcare, hackathons, workshops, Codex…). Both AI steps get it; career-ops' fact gate reads it as an approved source with every number removed, so numbers still come only from cv.md. Code builds the target list (the bank terms the posting uses), the same every build, and the tailoring must use those exact words where the experience appears. Coverage of that list is the fit report's stable keyword measure; the AI's own list is shown as a rough guide (it varies by build). cv.md gained the bank's skill terms; "prompt and context engineering" is back.
**Measured (bank terms used, after D104):** Lio 41% → 68%, Edra 57% → 62-67%, OpenAI 57-61%.

## D104 — The description line under each job may be tailored; numbers keep what they count (2026-11-05)
**Context:** The terms most often missing (customer-facing, ownership, priorities, solutions) belong in the line under each job title, which code copied word for word. A draft also turned "10K+ customer estimates" into "10K clients".
**Decision:** The candidate's call. The tailoring may reword each job's description line, checked like bullets (numbers and hedges against that job's cv.md description line; shown in the CV map). Both AI steps must keep what a number counts as cv.md writes it, and a code check flags a number paired with different words ("⚠️ check this number"). It's a flag, not a block, because cv.md sometimes names the counted thing earlier in the sentence.

## D105 — Placement: limited bank terms only on the jobs or lines they describe (2026-11-05)
**Decision:** The candidate's call (option A of the meaning-check card). A bank entry may carry `[where: Slalom]`, `[where: line "opening words"]` or `[where: projects]`. Code blocks a pack that uses such a term on another job's line (e.g. "customer-facing" on H&R Block, "trusted advisor" beyond the client-hire line, "RAG" beyond the biotech MVP). A term already in the source line itself is always fine there.

## D106 — Meaning check: a second AI read reports, code decides (2026-11-05)
**Context:** Code checks numbers and words, not meaning. Tailoring rewords lines, so a line can say more than the CV does ("helped" → "managed", a title-like phrase, "10K clients").
**Decision:** The candidate's call (option B; with D105, option C). One extra AI call per pack compares every line he'd send (CV bullets, description lines, summary, cover-letter paragraphs, outreach notes) with its sources: cv.md lines, the skills list, approved facts and his profile's strengths stories. Per line it reports same / stronger / new claim, quoting what changed. A new claim blocks the pack; a stronger claim is flagged first in the README ("⚠️ check this line"); a line without a verdict is flagged, never assumed fine. Report: `meaning-check.md`. Skills may move between groups but never be new.
**First results:** caught "managed 5-8 initiatives" (cv.md: partner on them) and "Data & AI consultant" (title is Associate Consultant); one false alarm (daily use of AI tools, true per the profile) fixed by giving the check the profile and skills.
**Cost:** about one more AI call per pack (~$0.10–0.15 API-equivalent).
**Trade-off:** an AI judging an AI can be wrong both ways; the candidate's own read stays the last check. If it blocks too often in the first weeks, make new claims flags too.

## D107 — Fixes from the first run with the new pack checks (2026-11-06)
- **"B2B" read as 2 billion:** the kit's number check read the "2B" in "B2B" as a number and blocked a good pack (Clay). A number glued to a letter ("B2B", "S3", "Q4") is now part of a name, not a claim.
- **A job board that moved:** Rippling's own board now redirects from ats.rippling.com to rippling.com/careers, which the kit doesn't read, and the scan failed (🚨). A board that redirects to another site now counts as "not found": a ⚠️ summary line, retired after 3 runs (D82, D93).
- **Not a bug:** career-ops' count check paired "10K+ customer estimates" with a later word ("…what clients paid") and reported "10k clients". In private notes it's only a warning; the kit's own check correctly stayed quiet. (The 2026-11-05 OpenAI report of "10K clients" was most likely the same misread.)

## D108 — A board that can't connect is retried once, then summarized (2026-11-06)
**Context:** The 2026-11-06 midday run failed (🚨) because 5 of 337 job boards timed out or couldn't connect. The Mac was asleep with its lid closed on battery, so the run started 42 minutes late in a brief wake and lost its network when the Mac slept again. All 5 boards worked in every other run. Nothing was lost (failed boards never close postings), but the alert cried wolf.
**Options:** (1) retry each such board once at the end of the scan, then put the ones still failing on a summary line; (2) retry only, any remaining failure still fails the run.
**Decision:** The candidate's call: option 1. A connection problem (no answer at all: "fetch failed", a timeout, DNS) is tried once more after 30 seconds. Still failing: a ⚠️ line in the morning summary ("couldn't connect, even on a retry"), postings kept open, checked again next run. The run still fails (🚨) when more than 10 boards can't connect after the retry (the Mac lost its network, not a few boards) or the same board can't connect 3 runs in a row. An answer from the board (HTTP 404, 500…) is not a connection problem and is handled as before (D82, D93).
**Why:** a brief network drop isn't something to act on; a board down for days, or a run with no network, is.
**Trade-off:** a board that's down twice in a row goes unflagged until the 3rd run. The midday run sends no text on success (D79), so its ⚠️ line shows only in the log.

## D109 — Two Radar pages for one company stop the run (2026-11-06)
**Context:** "Method" got a Company Radar page on 2026-11-05, before research named the company "Method Financial (Method)" (alias "Method") and made a second page. Both pages matched the same record, so each run read one page's Status as your edit and the other page undid it ("strong" ↔ "unknown"), logged as yours. Fixed by hand: the extra page went to the Notion trash and the status went back to research's "strong".
**Options:** (A) stop before reading any company edit and name the pages (fail loudly); (B) read only the page named exactly like the company and list the other as a warning.
**Decision:** The candidate's call: a guard that fails the run loudly. Before reading company edits, the kit checks whether two Radar pages match one company (by name or alias). If so, it reads none of them and fails with the company and page names and the fix (trash the extra page, keep the one named like the company).
**Trade-off:** grading waits (that step fails) until the extra page is trashed; roles are graded on the next run, nothing is lost. A wrong status is never applied.

## D110 — Reuse the board-named Radar page; trash duplicates that hold no edits (2026-11-08)
**Context:** D109's guard fired on the 2026-11-08 catch-up run: Squad, Flex and DoorDash each had two Radar pages. Every company first gets a page under its job board's name ("squadai"); when grading or research later names it ("Squad"), the sync made a new page instead of renaming the old one. With ~144 roles waiting to be graded, this would have stopped grading most mornings.
**Options:** (A) the sync renames and reuses the board-named page, and the 3 current extras are trashed by hand; (B) A, plus the kit trashes an extra page by itself when it holds none of your edits.
**Decision:** The candidate's call: option B. When a company gets its proper name, the sync looks for its page under the board name or an alias and renames it. Before reading company edits, any extra page whose Status, Verified, Watch and AI-native are all still the defaults is moved to the Notion trash, after its roles are relinked to the kept page (the one named exactly like the company), and the log says so. The run still fails loudly (D109) if an extra page holds an edit of yours, or if no page is named exactly like the company.
**Trade-off:** the kit removes pages on its own; they stay restorable from the Notion trash for 30 days, and each removal is logged.

## D111 — VC job lists get the same retry as job boards (2026-11-09)
**Context:** The 2026-11-09 midday run started the moment the laptop lid opened, before Wi-Fi was back. All 338 job boards failed to connect and every one was read on D108's retry, but the run still failed (🚨) because the 3 VC job lists (Thrive Capital and Scale Venture Partners on Getro, the a16z portfolio) are read first and had no retry. They had failed this way 9 times since 2026-11-03, always a connection problem during sleep or travel, and always read fine on the next run. They only find new companies; nothing is lost when one is skipped.
**Options:** (A) the same rule as job boards; (B) A, plus a wait of up to 3 minutes for a network connection at the start of every run; (C) leave it.
**Decision:** The candidate's call: option A. A VC list that can't connect ("fetch failed", a timeout, DNS) is tried again after the board scan, after the same 30-second wait. Still failing: its own ⚠️ line in the morning summary ("VC job lists couldn't connect, even on a retry; checked again next run"), not a failure. The run still fails when the same list can't connect 3 runs in a row. An answer from the site (HTTP 503 for one company page, for example) is not a connection problem and fails the run as before.
**Why:** the smallest change that stops the false alarm, reusing rules already proven on a live run.
**Trade-off:** a list down 2 runs in a row goes unflagged until the 3rd (at most a day of newly found companies). Boards a list finds only on its retry are scanned from the next run. A run with no network at all still fails step by step rather than once at the start (option B).

## D112 — Only a real problem sends the 🚨 text (2026-11-10)
**Context:** 7 of the 8 daily logs so far (2026-11-03 to 11-10) sent at least one 🚨 failure text, but only 2 were problems in the program: a Rippling pay format the kit couldn't read (11-04) and Rippling's changed pages (11-06). The rest were connection drops or cut-off AI calls while the Mac slept, and prep packs held back by their fact check. On 2026-11-10 two grading calls were cut off (code 143) by a closed lid; both roles stayed queued and are graded on the next run. The candidate: "I only want there to be a failure notice when it's a true issue with the program." Too many false alarms train him to ignore the real ones.
**Decision:** The candidate's call. The daily runner sorts each failed step's problems:
- **Temporary (⚠️ summary line, no 🚨):** one role, board or Radar source that got no answer (no network, a timeout), a server error (HTTP 5xx), or an AI call cut off (code 143, SIGTERM). The next run tries it again by itself. The midday run logs these and sends nothing.
- **Real (🚨) after 3 runs in a row:** the same item failing that way 3 runs in a row (counts in `data/alert-streaks.json`; a run where the step works clears its counts; steps that didn't run keep theirs).
- **Held back (🚫 line, no 🚨):** a prep pack blocked by its fact check. The check worked; whether to fix the CV or requeue is his call. The midday run sends a calm 🚫 text for it.
- **Real (🚨), as before:** anything else. That includes a whole step that breaks, even on a connection error (work done before the break, like graded roles, may not reach Notion), a step that times out, a prep pack that failed to build (it stays failed until requeued), an error the kit doesn't recognize, an unsendable text or reminder, and an unreadable count file.
- The usage-limit pause loses its 🚨 and its pop-up ("Nothing is broken").
**Why:** a 🚨 should always mean "do something". Problems that heal themselves still show in the morning summary.
**Checked against the logs:** replaying every failed step since 11-03, the 11-06 and 11-09 midday runs and the 11-10 morning run become calm summaries. The 11-04 pay format, the 11-06 Rippling change and the 11-07/11-08 runs the sleeping Mac broke still send 🚨.
**Trade-off:** a role, board or source that fails for a real reason that looks temporary is flagged only on its 3rd run in a row (about a day and a half), but it shows as ⚠️ in each morning summary meanwhile. Different roles cut off every run (a Mac that keeps sleeping mid-run) never add up to a 🚨.

## D113 — Funding news searched daily, with a warning a week before the search credits run out (2026-11-11)
**Context:** AlleyWatch's weekly report (2026-11-09) named 5 newly funded NYC companies; the kit had a round for 1 (Traversal). None of the other 4 had a Form D on file yet. They came from the companies' own announcements, which the weekly 4-search news search (D72) mostly missed: it had run once. Options considered: (A) a daily news search; (B) counting funded companies outside NYC; (C) Bay Area Form D (measured: about 4–5 real startups a week); (E) a tip list the candidate types in from his own reading, researched independently.
**Decision:** The candidate's call: start with A only, 10 searches a day, and warn him when about a week of credits is left so he can buy the 50k pack.
- **Search:** `funding_news.serper.every_days` 1, 10 NYC-focused queries (by stage, "New York-based", "NYC-based", "Brooklyn-based", AI, fintech, health tech), 1 credit each. Same reading rules as D72: Google's headline, snippet and link only, read by code. A search looks back over the time since the last good one (past day; past week or month after missed runs), so a daily search gets fresh stories instead of the week's top 10 again.
- **Credits:** each morning the radar reads the balance from Serper's free account check and keeps 14 days of history in `meta`. The pace is the measured drop once 3 days are recorded, never less than planned use (news searches plus search discovery, about 17 a day). At 7 days or less left: a 💳 line in the morning text (or the failure text) and a phone pop-up each morning until credits are bought. A higher balance starts the history over. A balance that can't be read is reported like any source (D112: a connection error is temporary).
- **AlleyWatch:** the candidate compares by hand over the next weeks. The kit never reads AlleyWatch (D72).
**Measured:** on a copy of the database, one first search (past week, 10 credits) recorded 7 newly funded NYC companies, including Cowboy and Kalepa from AlleyWatch's list and 5 that list didn't have; Sentra and Numica were still missed. Balance: 2,429 credits, about 141 days at the planned pace.
**Trade-off:** about 300 credits a month instead of about 16, so the free credits last about 4–5 months. The headline reader can still misread a name ("Nubank alum raises…" read as a company called "Nubank Alum"); each found company still gets research before it reaches the outreach list.

## D114 — Grading skips a role the latest scan didn't see (2026-11-12)
**Context:** The 2026-11-12 run sent a 🚨 because grading opened DoorDash's "Director, Strategy & Operations (DashOS)", and its page answered HTTP 404. DoorDash had taken it down overnight. A posting closes only after CLOSE_AFTER_MISSES (2) scans in a row miss it, so after the first miss it still counted as open and was queued. D112 treats a 404 as a real problem, since it can't tell a removed role from a broken link.
**Decision:** The candidate's call. Grading (and `--regrade`) leaves out a role whose board's latest scan didn't list it (`miss_count` > 0) and names it in the log. If it's back on the next scan, its miss count resets and it's graded then. If it's missed again, it closes as before. A board that couldn't be scanned adds no miss, so its roles are graded as usual.
**Checked:** a grading dry run on the live database held back the DashOS role and a second DoorDash role that also left the board on 11-12 and would have failed the next run.
**Trade-off:** a role that disappears from its board for one scan and then returns is graded a run later.

## D115 — Problems are counted in days: quiet on day 1, ⚠️ from day 2, 🚨 from day 5 (2026-11-12)
**Context:** After D112, a one-time blip still put a ⚠️ line in the morning text: two a16z company pages that timed out once (11-12), a text check that couldn't connect once (11-11), a board unreachable once after its retry. The candidate: warnings only when something needs looking into (the same board, company or link failing again), 🚨 only for a structural failure. "If I'm getting too many warnings, I'm going to start ignoring them." Option A of the card (B: a single item never sends a 🚨).
**Decision:** The candidate's call: option A.
- **Days, not runs:** every count is days in a row on the Mac's calendar. A morning and a midday failure are one day; a day without the failure (or a good run of that step) starts over.
- **One item** (a role, a job board, a VC list, an a16z company page, a text check, a Radar source) that got no answer, a server error or a cut-off AI call: day 1 only in the log; days 2–4 a ⚠️ line in the morning text with the days in a row; day 5 (ALERT_AFTER_DAYS) a 🚨. Boards and VC lists count from their scan history (`failingDays`), the rest in `data/alert-streaks.json` (now `{days, last}`; D112's plain counts read as a first day).
- **Not-found boards:** day 1 in the log, day 2 a ⚠️ line, retired on day 3 (RETIRE_AFTER now counts days).
- **Prep pack that fails on a connection error** (or a cut-off AI call) goes back in the queue once by itself; failing again it's a ⚠️ line asking for a requeue. Queued and failed packs don't use a build slot.
- **Still 🚨 the first time:** a whole step that breaks, more than 10 boards unreachable after the retry (the Mac lost its network; no longer read as temporary), an error the kit doesn't recognize, a pack that failed to build for another reason, a text or reminder that can't be sent, an unreadable count file.
- 🗑 retired, 🚫 held back, ⏳ paused and 💳 credits low are unchanged.
**Checked against the logs:** replaying every run since 11-03, each one-day blip since 11-09 stays in the log: the VC lists (11-09 midday), the two cut-off grading calls (11-10), the Ramp text check (11-11) and the two a16z pages (11-12). No item reached day 2. The 11-12 DoorDash 404 is D114's. The 11-04 pay format, the 11-06 Rippling change and the 11-07/08 sleep-broken runs still send 🚨.
**Trade-off:** a board or source that's broken for good is flagged a day later than before (day 2, not day 1), and becomes a 🚨 on day 5, not the 3rd run.

## D116 — Funding news: every Google News date form is read; date-dropped stories are read again (2026-11-12)
**Context:** The first daily news search (2026-11-12, D113) looked back a month (the last search was 11-05) and read 67 new headlines, but recorded 3. 22 were dropped as "no publish date": Google News gives a story's age as "3 days ago", "1 week ago", "2 weeks ago", "1 month ago" or a written date, and the reader only knew minutes, hours and days. They included NYC raises such as Qualitate ($25M), Fragment, Overwatch, Mural, Pennant, MARC and Baba.
**Decision:** The candidate's call (a bug fix within D72/D77; the rule "no date, not counted" stays).
- `relativeDate` reads minutes, hours, days, weeks (7 days each), months (31 days each, so "1 month ago" is always past the 30-day limit), "yesterday", "Nov 4, 2026", "4 Nov 2026" and ISO dates. A week can be up to 6 days older than it reads; a month is never made to look newer.
- A story dropped only for having no date is read again when a search finds it, and its row is updated. Every other story stays "seen" and is never overwritten.
- `market.sh radar --news-window day|week|month` searches now over that window (10 credits), for a one-time catch-up. Used once on 11-12 with "month".
**Not changed yet:** 39 headlines were not "company raises $X" in a form the reader knows ("AI operating system race heats up as Nevis raises $70 million", "Cuttable adds $20m Series A", "Blacksmith becomes a unicorn after raising $66M"). A wider headline reader is a separate change.

## D117 — Nationwide funding news with an NYC check, and a one-time Form D look-back (2026-11-12)
**Context:** Of six NYC companies in AlleyWatch's recent daily reports, the kit had Nidus and Marble and missed Imprint ($130M), Garage ($41M), The Shadery ($3M) and Cowboy ($5M). Their stories don't say "New York", and all 10 daily searches (D113) include New York words, so Google never returned them. The headline reader read all four correctly. Form D isn't the fix on its own. A filing lists the principal office (the kit filters on that, so Delaware incorporation doesn't matter), but 7 of 12 recent raises had no Form D since Aug 1. Others filed months before the news (Qualitate filed Aug 18, before the kit's Oct 6 start). A few list a Delaware registered-agent address as their office.
**Options:** (A) nationwide searches, with an AI NYC check for unknown companies; (B) nationwide searches that count only companies already tracked; (C) both; (D) leave it. Form D: a one-time look-back to Aug 1 (free); Delaware-address filings through the NYC check.
**Decision:** The candidate's call: C, plus the look-back (not the Delaware-address check).
- **Searches:** `funding_news.serper.national_queries` (5, no city: seed, Series A, Series B/C, AI, fintech) run with the 10 NYC searches every morning, 1 credit each (about 15 a day in all).
- **Tracked companies** are recorded wherever the story is set (unchanged, D72): this catches Garage.
- **Everyone else:** a raise in a story that doesn't place the company in NYC waits ("NYC check pending") for one short web-research AI call per company (`extractor/nyc-check.mjs`). It gets only the company name and the headline, may only search and read pages, and reports facts: operating company or not, HQ city, NYC office yes/no/unknown, a quoted line and a source link. Code decides (`nycVerdict`): recorded as an NYC raise only on "yes" with evidence and a link. "No", not found, and funds or nonprofits are logged with why. At most `funding_news.nyc_checks_per_run` (15) companies a run, newest first; the rest wait for the next run, and stories past the 30-day limit drop out.
- **Form D look-back:** `market.sh radar --form-d-since YYYY-MM-DD`, used once from 2026-08-01. Long ranges are read in 14-day windows: EDGAR's search returned HTTP 500 past its 500th result on the 3-month range.
- **Added after the first live run:** the check also reports whether the news is the company's own funding round (not a fund it manages, debt, an acquisition or an IPO). "Brookfield raises $25B" (an investment fund) had passed as an NYC company. Code requires it too. Raises found this way are recorded when found, so they appear as newly found even if the round closed in August.
**Trade-off:** about 150 more Serper credits a month (the free credits last about 100 days instead of 137, still warned a week ahead, D113), and up to 15 short AI calls a run on the Claude plan. An NYC company with no sign of New York online is still missed. Legal and brand names can still make two Radar entries for one company ("Overwatch Data, Inc." and "Overwatch"); merging stays manual (D71).

## D118 — "The first 90 days" isn't a number claim (2026-11-13)
**Context:** The 2026-11-13 morning run held back the Trunk Tools pack (🚫). The outreach note ended "I'd welcome a short conversation about the first 90 days", and the kit's number check found "90" in neither the CV nor the company research. The posting itself has a "What the first 90 days look like" section. The phrase is a role's opening time frame, not a claim about the candidate; every other number in the note matched the CV.
**Options:** (A) read "first/next/initial 30/60/90/100 days" and "30-60-90" as names, like "Fortune 500" (D98); (B) let cover letters and outreach notes also take numbers from the posting; (C) rebuild the pack and change nothing.
**Decision:** The candidate's call: option A. Both the kit's check and career-ops' fact gate read those phrases spelled out ("first ninety days"); the documents are unchanged. Any other number, including "90%" or "in 90 days", is still checked.
**Trade-off:** a made-up "in my first 90 days I…" would pass this check; the meaning check (D106) still reads every line for new claims. Option B was declined because a posting's number could then pass as his own.

## D119 — A Notion call with no answer is tried once more; what didn't sync waits for the next run (2026-11-16)
**Context:** The 2026-11-16 morning run sent a 🚨. Every part of the Company Radar step ran, and research covered 10 companies. Then the last step, the Notion sync, made one call that got no answer ("fetch failed"), and the whole step broke. The prep pack step right after it reached the internet fine. The Notion client had no retry by design ("a retry policy would need its own decision"), and grading's Notion sync broke the same way on 2026-11-07. Because each sync only sends what that run touched, the companies researched that morning would have stayed out of date in Notion. The break also hid the step's other problem (Gnau's research call, cut off). Separately, the daily news search skipped 11-13 and 11-16: "due" meant 24 hours since the last search, and those runs reached it a few minutes earlier than the day before.
**Options:** (A) try a call with no answer once more after 30 seconds; if it still fails, keep what didn't sync for the next run and count it as temporary (D115); (B) no retry, only the carry-over.
**Decision:** The candidate's call: option A.
- **Retry:** a Notion call that gets no answer at all (no network, a timeout: the same test as job boards, D108) is tried once more after 30 seconds. Any answer that is an error (400, 401, 403, 404, 429, 5xx) still stops with Notion's own message, as before.
- **Carry-over:** if the sync still fails, the Radar's companies (or grading's roles) are saved in the database (`notion_unsynced_companies`, `notion_unsynced_postings`) and sent with the next run's sync. The step's other problems are still listed.
- **Alerts:** a sync with no answer is a temporary problem (D115): only logged on day 1, ⚠️ from day 2, 🚨 from day 5. An error answer from Notion is real (🚨) the first time.
- **Due dates in calendar days:** the news search (every day) and board discovery (every 5 days) now count days on the Mac's calendar, not 24-hour periods.
**Trade-off:** a page-create call that reached Notion but whose answer was lost could make a duplicate page on the retry. D110 already trashes a duplicate Radar page that holds no edits of yours. While a sync is failing, Notion runs behind: graded roles catch up at the next run (midday or morning), Radar companies at the next morning run.

## D120 — A role with a blank title keeps its saved title, or is left out and flagged (2026-11-16)
**Context:** The 2026-11-16 midday run failed: OpenAI's public Ashby board listed one role ("Growth Marketing, Creative and Ad Operations", tracked since 11-03) with an empty title, likely an edit in progress at OpenAI. Recording a posting needs a title, so that one role failed the whole board and OpenAI's other 833 roles went unscanned (none were closed, by design). The error wasn't temporary, so it sent 🚨.
**Options:** (A) a role we already track (same link) keeps its saved title and counts as still open; a new role with no title is left out and flagged ⚠️ with its link; the rest of the board scans normally; (B) no change: the board fails every run until the company fixes the title; (C) count a blank title as temporary (D115): quieter alerts, but the board still goes unscanned.
**Decision:** Gabriel's call: option A.
- The saved title is the one we recorded from the board earlier; no title is ever made up. Keeping it is written to the log.
- A new untitled role is left out of the scan and listed in the morning text from day 1: "⚠️ N new role(s) with no title on the job board, left out until they get one: <company> <link>". It's added normally once the board gives it a title.
- Recording a posting with no title still throws, so any other path that tries is still loud.
**Trade-off:** while a tracked role's title is blank, we keep showing its old title, which may be out of date if the company is renaming it. A new untitled role's first-seen date is the day it gets a title, not the day it first appeared.

## D121 — The meaning check reads your whole CV, not just its bullets (2026-11-17)
**Context:** The meaning check (D106) had held 4 prep packs. Three were true statements: "I'm based in Brooklyn" (Rillet, Clarion) and "three years at Slalom" (Traversal, Jun 2022 – Sep 2025). Both facts are in cv.md, in the Location line and the job's date line, but the check was only shown the summary, bullets, skills and approved facts. The fourth (Method: an agent "for 10+ director-level stakeholders' analytics team") was a real stretch, correctly held. Clarion is an S-tier role.
**Options:** (A) show the check the CV's Location line and each job's title, company, place and dates; (B) A plus a "second look": a stronger AI pass on flagged lines that must quote supporting words (checked by code) and can clear the block with a ⚠️ note.
**Decision:** Gabriel's call: option A.
- Every line checked against "all sources" (summary, cover letter, outreach) also gets `Location:` and one `Job:` line per job. A tailored CV bullet's source also gets its own job's `Job:` line.
- Email, phone and LinkedIn are never shown to the check.
- The prompt says a length of time worked out from a job's dates is `same` unless it rounds up, which is `stronger`.
**Trade-off:** a different kind of false block can still happen; B stays an easy add if one does. B was not chosen because a second pass could clear a real stretch like Method's: the quoted words exist in the CV but don't support the claim, and a quote check can't catch that.
