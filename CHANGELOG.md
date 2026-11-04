# Changelog

All notable changes to this kit. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- Rippling links that start with a language code (`ats.rippling.com/es-419/<company>/…`) were read as a board named after the language; the code is now skipped.
- Board names with a space (e.g. Ashby's `hippocratic ai`) were stored URL-encoded and then encoded again when read, so the board returned "not found". Links are now decoded once; board names may contain spaces.
- Daily run blocked by macOS (D65): the 7 AM job couldn't open the kit in the Documents folder, and failed without a text. `install-daily.sh` now builds a small helper app (`~/Applications/CareerOps Daily.app`) that launchd starts; you allow it into Documents once. If the run can't start or can't text, the app sends the failure text itself. New `install-daily.sh --run-now` and `--test-message`. A failed iMessage send now says why (e.g. waiting for the Messages permission) instead of repeating the whole command, text and phone number.

### Removed
- Built In NYC reader from the roadmap (D64).

### Added
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
- Daily run texts (D63): a morning summary every successful run (boards, new postings, new NYC roles by tier, S/A roles by name); failures send a loud, unmistakable notice instead. `daily.sh --sample-messages` sends one of each.
- Tier rules (D62): no posted pay caps a role at A, or at B when the company is not AI-native; applied after drops.
- Tier engine: a role asking exactly 1 year more than the candidate has is capped by the new `caps.reach_1_year` setting; larger gaps keep `caps.reach` (D46). Existing settings files need the new key, and the engine stops with a clear error if it is missing.
- Extraction prompt: a load of concurrent deployments is not a book of business (D44); back office now covers ops, planning and analytics for a customer-facing team (D45).
- `secret-scan` workflow can read PR commits (`pull-requests: read`).

### Fixed
- The rules fingerprint on each tier decision now changes when any setting changes, not just top-level names.
- Greenhouse boards that link to the company's own site no longer collapse into a single posting (the job id in `?gh_jid=` is kept).
- Extraction: travel stated as trips ("~2x per month for 2-3 days") is converted to a share of working days before the 50%+ travel flag is set (D55).
- Calibration: misses are now classified as AI misread or rule miss (the runner read confirmed key facts from the wrong place, so every miss showed as "unclassified"). The report adds a second score for holdout cases, roles the rules never saw.
- A red flag quoted twice no longer drops a role two tiers.
- Home-metro matching handles aliases (e.g. Brooklyn) and "City, State" (Albany, New York is not New York City).
