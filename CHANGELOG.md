# Changelog

All notable changes to this kit. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- A Mac asleep with its lid closed no longer makes the morning run fail (D130). Step time limits and the 5-minute AI call limit count only time the Mac was awake. A step that runs out of time while the Mac slept is a temporary problem; the summary gets a 💤 line saying how long the Mac slept and to leave the lid open overnight. It becomes a real problem if it happens 5 days in a row.
- Companies waiting for a Notion sync are saved before the sync starts, so a run stopped in the middle of one (the 2026-11-22 morning run) no longer drops them; the next run syncs them.

### Docs
- `docs/ARCHITECTURE.md` rewritten to describe the kit as built: the three folders, what comes from career-ops (profile formats, CV rendering, the fact gate, ATS checks) and what the kit adds, the daily run step by step, the extract-then-decide rule, how prep packs are checked, and a code map. The old version was the October plan (generated `portals.yml`, career-ops plugins, career-ops' scanner), none of which was built that way.
- README: the career-ops comparison now says what the kit actually uses from career-ops; the diagram, status line and credits match what exists. The empty `plugins/` folder is gone.
- SECURITY and extractor README brought up to date.

### Added
- `/update-cv`: a Claude Code command for news about your job. It reads the CV files, asks the gap questions, checks the new facts against the approved list, shows a read-back, and only after your yes backs up and updates `cv.md`, the project notes and the fact files, then rebuilds the base resume (D129).
- `scripts/packs.sh cv-pdf`: builds the base resume from `cv.md` word for word (no posting, no AI) through the fact gate and career-ops' renderer, to `private/documents/cv.pdf`. Up to two pages.
- The repo is public (2026-11-20), after a final scan of every commit on every branch plus all PR and issue text found no keys or contact details (D125).
- `install.sh`: one command sets up a new user. It downloads career-ops at the exact commit the kit is tested on, creates the private folder from templates (never overwriting a file), installs the secret-scan hook and runs the setup check (D128).
- `scripts/check-setup.mjs`: checks every private file through the same checks the runs use and lists every problem at once, with how to fix it. It flags example values and template placeholders left in, and missing keys, without printing any value.
- `/onboard`: a Claude Code command that interviews a new user and fills in their private files, never inventing a fact.
- Templates for the files that had none: `cv.md`, `daily.json`, `cv-facts.json`, tailoring rules, eval cases.
- `scripts/tier-facts.mjs` grades a saved facts file with the tier engine alone (no AI, no network), with two made-up examples in `examples/`.
- README: results so far (postings, roles graded by tier, prep packs, accuracy re-run 2026-11-20: 21/24, 10/12 on unseen roles) and a demo GIF recorded from `docs/img/demo.tape` with example data only.

### Changed
- `.env.example` lists only the two keys the kit uses (Notion, Serper); the old Resend and SEC entries are gone.
- `docs/DECISIONS.md` records the Phase 9 ship decisions (D124–D128).

- The midday run now sends a short summary text every day, like the morning one: boards checked, new postings, roles graded by tier, and any ⚠️ lines. Before, a quiet midday run sent nothing, which looked like it hadn't run. Ready packs still get their own text and aren't repeated in the summary (D122).
- Funding news is also searched nationwide (5 more searches a day). A raise whose story doesn't place the company in NYC gets one short AI check of where it's based, and only a sourced NYC answer counts. Raises at companies already tracked count wherever the story is. `market.sh radar --form-d-since` adds a one-time Form D look-back (D117).
- Alerts count problems in days (D115). A role, board, VC list, company page or source that fails once is only logged. The same one failing 2 days in a row is a ⚠️ line in the morning text, and 5 days in a row sends 🚨. A morning and a midday failure count as one day. Not-found boards retire on the 3rd day (was the 3rd run). A prep pack that fails on a connection error is queued again once by itself. More than 10 boards unreachable after the retry now sends 🚨 right away.
- Funding news is searched every morning, 10 NYC-focused searches (was 4 a week), each looking back over the time since the last good search (D113). A first run found 7 newly funded NYC companies in a week.
- Each morning the Company Radar checks the Serper credit balance (free) and prints the pace. With about a week left, the morning text gets a 💳 warning and a phone pop-up so you can buy more (D113).

### Fixed
- The daily run, the setup check and the rules-drift check now run when started from a folder reached through a symlink (macOS `/tmp` is one). Before, they did nothing and exited as if all was well; found while recording the demo.
- The text check for borderline NYC titles skips a role the latest scan didn't see on its board. It's checked if the role comes back, and it closes on the next missed scan if not. On 2026-11-19 a CrossCountry Consulting role taken down between the morning and midday runs answered "not found" and sent a 🚨 (D123).
- The meaning check (D106) now also reads your CV's Location line and each job's title, company, place and dates (never email, phone or LinkedIn). Three of the four packs it had ever held were true statements backed only by those lines: "based in Brooklyn" (Rillet, Clarion) and "three years at Slalom" (Traversal) (D121).
- A job board role with a blank title no longer fails the whole board. A role we already track keeps its saved title; a new role with no title is left out and listed with its link as a ⚠️ line in the morning text (D120). The 2026-11-16 midday run skipped OpenAI's 834 roles this way.
- A Notion call that gets no answer is tried once more after 30 seconds. If the sync still fails, the companies or graded roles it couldn't send go with the next run's sync, the step's other problems are still listed, and it's a temporary problem (quiet on day 1, ⚠️ from day 2) instead of a 🚨 (D119). The 2026-11-16 morning run failed this way.
- The daily news search no longer skips every other day: "due" now counts calendar days, not 24-hour periods (D119). Board discovery too.
- A prep pack is no longer held back for "the first 90 days" or a "30-60-90" plan in a draft: these are read as phrases, not number claims (D118). Blocked the Trunk Tools pack on 2026-11-13.
- Funding news dated "1 week ago", "2 weeks ago", "1 month ago" or with a written date is no longer dropped as undated. The 2026-11-12 search had dropped 22 of 67 headlines this way, including NYC raises such as Qualitate's $25M. Stories dropped only for a missing date are read again. `market.sh radar --news-window month` runs a one-time catch-up (D116).
- Grading no longer opens a role its board's latest scan didn't list. Such a role was usually just taken down, and its "not found" page sent a false 🚨 (2026-11-12, a DoorDash role). It waits: graded if it's back on the next scan, closed if not (D114).
- Only a real problem sends the 🚨 failure text (D112). A role, board or Radar source that couldn't connect, got a server error, or had its AI call cut off while the Mac slept is tried again on the next run by itself, so it's a ⚠️ line in the morning summary, unless the same one fails 3 runs in a row. A prep pack held back by its fact check is a 🚫 line (a calm text at midday). A usage-limit pause no longer starts with 🚨. A whole step that breaks, a pack that failed to build, and any error the kit doesn't recognize still send 🚨. The 2026-11-10 run failed only on 2 grading calls cut off by a closed lid.
- A VC job list (Thrive Capital, Scale Venture Partners, a16z) that can't connect is tried once more after the board scan, under the same rules as job boards: still failing, it's a ⚠️ line in the morning summary ("VC job lists couldn't connect, even on a retry") instead of a failed run, unless the same list fails 3 runs in a row. An answer from the site (HTTP 503…) still fails as before (D111). The 2026-11-09 midday run failed only on these 3 lists, while all 338 boards connected on the retry.
- Company Radar no longer makes a second page when research names a company that already has a page under its job board's name ("squadai" → "Squad"): the old page is renamed and reused. A duplicate page that holds none of your edits is moved to the Notion trash automatically (its roles relinked first) and logged; one with an edit of yours still stops the run (D110).
- Two Company Radar pages for the same company (one named by its alias, made before research) no longer overwrite each other's status every run: the run now stops before reading any company edit and names the extra page to trash (D109). Found on Method / Method Financial.
- A job board that can't connect (no network, a timeout) is tried once more at the end of the scan. If it still can't, it's a ⚠️ line in the morning summary instead of a failed run, unless more than 10 boards fail (the Mac lost its network) or the same board fails 3 runs in a row (D108). The 2026-11-06 midday run failed on 5 such boards while the Mac slept with the lid closed.
- "B2B", "S3" and similar names are no longer read as numbers by the pack checks (blocked the Clay pack) (D107).
- A job board that now redirects to another site (Rippling's own) counts as "not found" and is retired after 3 runs, instead of failing the scan (D107).
- Prep packs: education lines no longer share ids with jobs (the fit report cited a degree as job evidence); "Fortune 500" no longer reads as a number to the fact gate; the CV's hidden empty consent box is removed (ATS 94 → 99).
- Alerts now pop up on the phone (D95): a ⭐ new S role, a 📦 pack, or a 🚨 failed or paused run also creates a reminder in the "Job Search Alerts" list (`reminders_list` in `daily.json`, required), because texts to your own number never notify. `install-daily.sh --test-message` also sends a test reminder (grants the Reminders permission once).
- Grading (D96): "N years in a field" is no longer read as a hard requirement, and a list of options joined by "or" counts as met if the CV shows any one.
- Grading (D94): roles requiring a language you don't speak, an active security clearance, non-full-time work, or an excluded industry are now Excluded (some caught from the title with no AI). Managing people from day one and off-hours drop a tier. Vague heavy travel, "able to obtain a clearance", 5 office days, a missing required degree and agency postings are flags. New `candidate.languages` and `excluded_industries` in the tier settings (required). `tier-new.sh --regrade S,A` grades open roles again.
- A job board answering "not found" before its 3rd run in a row no longer makes the run a failure: it's a ⚠️ line in the morning summary, and it's still retired on the 3rd (D93).
- Prep packs: "~40 people" was blocked as a different count from "~40-person" by career-ops' fact gate (fixed in private `allow_metrics`).
- Rippling postings with a pay range (e.g. Drivepoint's) failed grading; the range is now read (the New York one if it differs by place).
- Funding news (D77): stories older than `funding_news.max_age_days` (30, now required in `sources.json`) or with no date are logged but no longer counted as newly funded; several articles about one raise, or a Form D and an article, now stay one round.
- Morning text says "S&A" instead of "S/A" for the top roles.
- Rippling links that start with a language code (`ats.rippling.com/es-419/<company>/…`) were read as a board named after the language; the code is now skipped.
- Board names with a space (e.g. Ashby's `hippocratic ai`) were stored URL-encoded and then encoded again when read, so the board returned "not found". Links are now decoded once; board names may contain spaces.
- Daily run blocked by macOS (D65): the 7 AM job couldn't open the kit in the Documents folder, and failed without a text. `install-daily.sh` now builds a small helper app (`~/Applications/CareerOps Daily.app`) that launchd starts; you allow it into Documents once. If the run can't start or can't text, the app sends the failure text itself. New `install-daily.sh --run-now` and `--test-message`. A failed iMessage send now says why (e.g. waiting for the Messages permission) instead of repeating the whole command, text and phone number.

### Removed
- Built In NYC reader from the roadmap (D64).

### Added
- Prep packs follow the recruiter-review rules (D98): locked CV lines, the posting's title as headline, role types and allowed rewordings, and a `fit-report.md` (verdict, requirement evidence, rejection risks, measured ATS structure and keyword coverage, the AI's recruiter-impact estimate). New required `private/config/cv-rules.json` (see `packs/cv-rules.example.json`). One page preferred.
- Keyword bank (D103): approved terms tied to real experience; the tailoring must use the posting's exact wording for bank terms it uses; stable keyword coverage in the fit report and README. Required `keyword_bank` in `cv-rules.json` (example: `packs/keyword-bank.example.md`).
- Description lines under each job may be tailored (D104), with numbers checked; a flag when a number counts something different ("10K clients").
- Placement check (D105): limited bank terms only on their jobs or lines.
- Meaning check (D106): a second AI read compares every line you'd send with your CV; new claims block, stronger claims are flagged (`meaning-check.md`).
- Exact posting keywords on the CV wherever cv.md supports them, two coverage numbers in the fit report, a names note (Amazon Leo is not Lio), and a fixed job-search-agent sentence in the summary for AI-native companies (D101). New `name_notes` and `ai_native_sentence` in `cv-rules.json` (required).
- Line-specific banned words (D99), e.g. Lightning Supply can't be described with sales words, while "sales" elsewhere is fine.
- The daily run keeps the Mac awake until it finishes (D100).
- Prep packs (Phase 8, D83–D90). New step `scripts/packs.sh build` in the 7 AM and 1 PM runs:
  - **What's in a pack:** a tailored CV (PDF through career-ops), a cover letter draft, interview prep, outreach drafts (you send them), and "research next" with a ready-to-paste prompt for a Claude research session. Saved in `private/output/packs/<date>-<company>-<role>/`, and the text goes into the role's Notion page.
  - **Checks:** every CV bullet names the cv.md line it came from; code checks numbers, "~"/"nearly"/"under" hedges, "+", skills and job order; career-ops' fact gate checks the CV and the drafts. Any failure blocks the pack (no retry) and the text says why.
  - **Project map:** `cv-map.md` shows each bullet → cv.md line → the project behind it, from `private/cv-projects.md`. `scripts/packs.sh notes` lists lines still missing notes.
  - **Queue:** new S roles automatically; any role you tick **Make pack** on in Notion. Order: your ticks, role family, posted pay, newest. Pace: 1 a day, up to 3 when 2+ are waiting, at most 5 in 7 days (`packs` in `private/config/daily.json`, required). Closed roles drop out. `scripts/packs.sh status | requeue <link>`.
  - **Notion:** Job Postings gets **Make pack** (yours) and **Prep pack** (status).
  - **Texts:** "📦 N prep pack(s) ready" in the morning summary, its own text for a pack built at 1 PM, and blocked or failed packs in the 🚨 text.
  - Database schema v7 (`prep_packs`); older code refuses it.
- Delivery (Phase 7, D78–D82):
  - **S-tier text:** each new S role gets its own iMessage (role, pay, link) right after grading. A failed run's text now also lists the S/A roles it graded.
  - **Midday run** at 1 PM (`com.career-ops.midday`, `install-daily.sh --midday-at`): scan, then grade only roles first seen today; texts only for a new S role or a failure. Runs never overlap (`private/logs/daily.lock`).
  - **Weekly email** on Sundays through Apple Mail: newly funded NYC companies (funding, fit, what they do, leaders, NYC evidence, open roles, careers page), the week's S/A roles, and a market line. Needs `weekly_email` (`to`, `day`) in `private/config/daily.json`. Try it with `install-daily.sh --test-email` (or `daily.sh --sample-email`).
  - **Dead job boards** are retired after 3 "not found" runs in a row and their postings closed; `market.sh unretire <board>` undoes it. Database schema v6.
- Company Radar + Form D (Phase 6, D70–D76). New daily step `market.sh radar --research N`, run after grading:
  - **SEC Form D:** NYC tech and health-tech filings of $1M+ since the last run; funds, amendments and investment vehicles screened out; officers and directors kept as leaders (names and roles only). Needs `form_d` (with the contact email the SEC requires) in `private/config/sources.json`.
  - **Funding news:** TechCrunch funding feeds every run, Serper news search every 7 days (4 credits). NYC companies are added; companies we already track get their new round wherever they are. Needs `funding_news` in `sources.json`.
  - **Research:** 10 companies a day (`research_per_day` in `private/config/daily.json`, required), newly funded first. Adds leaders (public sources, never contact details), careers page (a readable job board joins the scan), NYC evidence, and three facts for the new **Deployment fit** (Strong / Possible / Unlikely / Unclear, decided by `engine/fit.mjs`).
  - **Notion:** ten new Company Radar columns (Deployment fit, Fit reason, Funding amount / date / source, Found via, Leaders, NYC presence, NYC evidence, Careers page) and a "🆕 Newly funded (last 30 days)" view.
  - **Morning text:** "🆕 N newly funded NYC companies: …".
- `market.sh enrich` uses the same research queue and questions.
- Market database schema v5: `formd_filings`, `funding_news`, new company columns, `funding_rounds.found_via`.
- Usage-limit pause (D68): if grading hits the Claude usage limit, `tier-new` stops and keeps what it graded, and the morning text reads "🚨 ⏳ Job search: grading PAUSED" instead of listing every remaining role as failed. The rest are graded on the next run.
- Daily grading cap (D67): the daily run grades at most `tier_per_day` (30) new roles, at most `tier_per_company` (5) per company, deployment / AI strategist roles first, then forward-deployed PM, chief of staff, BizOps and borderline. The rest wait for later runs, and the morning text says how many (⏳). Both settings are required in `private/config/daily.json`. `tier-new.sh --per-company N`.
- Search-engine discovery (D52, D66): once a week `market.sh scan` searches Google through Serper for the target titles on Ashby, Greenhouse, Lever and Rippling boards in New York (NYC, Brooklyn), and adds each company board found to the scan. 32 searches, capped at 50 credits a run. `market.sh discover --dry-run` lists the searches. Needs `SERPER_API_KEY` in `private/.env` and a `serper` block in `private/config/sources.json`.
- `market.sh retier [--dry-run]`: after a rules change, re-decide open tiered roles from their saved facts (no AI); only tier changes are recorded and synced (D62).
- Rippling board reader (D60): whole boards and single postings from Rippling's public pages; `tier.sh` and the scan accept `ats.rippling.com` links. Earlier investor-board traces to Rippling are picked up.
- a16z portfolio board (D61): `market.sh scan` checks a16z's company pages (about weekly each), and adds the boards of companies with target or borderline titles. Configure under `a16z_boards` in `private/config/sources.json`.
- Title classifier v2 (D49, D56): more target titles, a `borderline` label, and a no-AI text check (AI + deployment + customers) so only promising borderline roles are tiered; `market.sh relabel` moves open postings to the new version.
- Investor job boards (D50, D51, D57): `market.sh scan` reads Thrive's and Scale's public Getro sitemaps, traces each relevant company to its own Ashby/Greenhouse/Lever board, and adds it to the scan. Configured in `private/config/sources.json` (template: `market/sources.example.json`).
- Companies to Watch (D51): a watched company with no readable board is reported; `market.sh add-board <link>` adds one by hand.
- Repo scaffold: README, architecture, decision log, roadmap, security policy.
- Secret scanning: gitleaks pre-commit hook and GitHub Action.
- `scripts/co.sh`: runs a career-ops script with `CAREER_OPS_DATA_DIR` set to `../private` (e.g. `scripts/co.sh doctor.mjs`).
- GitHub issues for roadmap Phases 0–9 (label `roadmap`).
- `rules/_profile.template.md` and `rules/_custom.template.md`: public templates for the target-role definition and the S/A/B/C tier recipe, with placeholders instead of personal values.
- Working-style and fail-loudly rules in `CLAUDE.md` (D7).
- Phase 1 decisions D8–D14 in `docs/DECISIONS.md`.
- Tier engine (`engine/`): deterministic S/A/B/C with caps, drops, flags and a step-by-step explanation; settings from a private file; drift check against `_custom.md`.
- Extractor (`extractor/`): ATS hard-fact reader (Ashby, Greenhouse, Lever), no-tools judgment extraction with quotes, company watchlist + web-research step, schema checking.
- `scripts/tier.sh <job URL>`: URL to tier in one command, logging AI calls and tokens.
- 76 tests (`npm test`) and a `test` GitHub Action.
- Calibration (`evals/`, `scripts/evals.sh`): private labeled set, frozen extraction snapshots, AI-misread vs rule-miss classification; 12/12 on the first set (see D24 for the limit).
- `tier.sh` options for boards without a supported API: `--jd-file`, `--pay`, repeatable `--location`, `--title`.
- Rules: book-of-business red flag, travel ranges, below-level cap, AI-native sort preference (D23).
- Market database (`market/`, `scripts/market.sh`): every tiered role recorded with first/last seen dates and tier history; backfill, monthly metrics CSV with scan coverage, and a hand-collected recall check (D30–D33).
- Notion (`notion/`, `scripts/notion.sh`): Job Postings and Company Radar created from code; postings and companies synced; your company calls read back before tiering; old database archived (D34–D35).
- History (D37–D40): company records in the market database with snapshots, funding rounds and a log of company calls; posting change log; monthly stats that freeze once tracking begins; `scripts/market.sh enrich` and `stats`.
- `scripts/market.sh scan`: reads every open posting on known Ashby, Greenhouse and Lever boards, with no AI (D41); Company Radar counts are now real board totals; the Notion Job Postings view stays tiered-only (D42).
- `scripts/tier-new.sh [--limit N] [--dry-run]`: tiers every untiered open NYC target-family role the scan found, then syncs them to Notion in one pass; failures are listed and the run exits non-zero. First run: 38 roles, 7 S.
- `scripts/daily.sh`: the daily unattended run (D53). Runs `market.sh scan`, then `tier-new.sh`, then backs up `market.db`; every step runs even if an earlier one failed; writes `private/logs/daily-YYYY-MM-DD.log` and sends one iMessage listing every failure (including a single board). `--test-message` checks the iMessage link. Settings in `private/config/daily.json` (not in the repo; just `imessage_to` since D59).
- `scripts/install-daily.sh` + `scripts/launchd/com.career-ops.daily.plist.template`: fills in the launchd job, saves it under `private/launchd/` and prints it; loads it only with `--load` (`--unload` removes it).
- `market/backup.mjs`: daily dated `market.db` copy via SQLite `VACUUM INTO` (safe while open, integrity-checked), newest 30 kept (D54); they reach iCloud through the synced workspace folder, which every run checks and reports if it isn't synced (D59).

### Changed
- Search-engine discovery (D69): the core titles (deployment strategist, forward deployed, AI strategist) are searched every run; the other titles take turns with the credits left, each run continuing where the last one stopped. Two titles added to the rotation: "S&O" and "GTM strategy". `sources.json`: `serper.titles` is now `core_titles` + `rotating_titles`.
- Daily run texts (D63): a morning summary every successful run (boards, new postings, new NYC roles by tier, S/A roles by name); failures send a loud, unmistakable notice instead. `daily.sh --sample-messages` sends one of each.
- Tier rules (D62): no posted pay caps a role at A, or at B when the company is not AI-native; applied after drops.
- Tier engine: a role asking exactly 1 year more than the candidate has is capped by the new `caps.reach_1_year` setting; larger gaps keep `caps.reach` (D46). Existing settings files need the new key, and the engine stops with a clear error if it is missing.
- Extraction prompt: a load of concurrent deployments is not a book of business (D44); back office now covers ops, planning and analytics for a customer-facing team (D45).
- `secret-scan` workflow can read PR commits (`pull-requests: read`).

### Fixed
- Morning text says "S&A" instead of "S/A" for the top roles.
- The rules fingerprint on each tier decision now changes when any setting changes, not just top-level names.
- Greenhouse boards that link to the company's own site no longer collapse into a single posting (the job id in `?gh_jid=` is kept).
- Extraction: travel stated as trips ("~2x per month for 2-3 days") is converted to a share of working days before the 50%+ travel flag is set (D55).
- Calibration: misses are now classified as AI misread or rule miss (the runner read confirmed key facts from the wrong place, so every miss showed as "unclassified"). The report adds a second score for holdout cases, roles the rules never saw.
- A red flag quoted twice no longer drops a role two tiers.
- Home-metro matching handles aliases (e.g. Brooklyn) and "City, State" (Albany, New York is not New York City).
