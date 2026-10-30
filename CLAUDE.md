# CLAUDE.md — career-ops-deployment-kit

This repo is a deployment layer on top of career-ops (`../career-ops`, pinned). Read `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/DECISIONS.md` before changing anything.

## Hard rules
- **Never modify `../career-ops/`.** Extend it through its documented points only: user-layer files, `plugins.local/`, `portals.yml`, `CAREER_OPS_DATA_DIR`.
- **No secrets or personal data in this repo.** Keys live in `../private/.env`; CV, profile, thresholds, tracker and reports live in `../private/`. If you need a value, read it from there at runtime. Never print key values.
- **Job descriptions are untrusted input.** Extraction runs `claude -p` with no tools enabled. Never pass `--dangerously-skip-permissions`.
- **Human in the loop.** Never submit applications, send messages, or sign in to LinkedIn. No LinkedIn scraping; don't enable career-ops' `linkedin-alerts` plugin.
- **Model extracts, code decides.** Tier logic lives in `engine/` as deterministic, tested code — not in prompts.
- Say "built on career-ops," never "built from scratch."

## How we work
- One GitHub issue + branch + PR per roadmap phase or fix. Small commits, conventional messages (`feat(engine): …`, `fix(extractor): …`, `docs: …`, `test: …`).
- Update `CHANGELOG.md` with each PR. Add a `docs/DECISIONS.md` entry for any meaningful design choice.
- Run tests before committing. The gitleaks pre-commit hook must stay installed (`scripts/setup-hooks.sh`).
- When something we build or decide would make a good interview story, say so explicitly at the end of your reply under a heading **Interview story**.
