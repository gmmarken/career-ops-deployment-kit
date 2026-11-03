# Changelog

All notable changes to this kit. Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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

### Changed
- `secret-scan` workflow can read PR commits (`pull-requests: read`).

### Fixed
- Calibration: misses are now classified as AI misread or rule miss (the runner read confirmed key facts from the wrong place, so every miss showed as "unclassified"). The report adds a second score for holdout cases, roles the rules never saw.
- A red flag quoted twice no longer drops a role two tiers.
- Home-metro matching handles aliases (e.g. Brooklyn) and "City, State" (Albany, New York is not New York City).
