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

### Changed
- `secret-scan` workflow can read PR commits (`pull-requests: read`).

### Fixed
- A red flag quoted twice no longer drops a role two tiers.
- Home-metro matching handles aliases (e.g. Brooklyn) and "City, State" (Albany, New York is not New York City).
