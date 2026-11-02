# Roadmap

One GitHub issue, branch and PR per phase. Check items off as they merge.

## Phase 0 — Scaffold
- [x] Repo initialized, scaffold committed, pushed to private GitHub repo
- [x] gitleaks installed; pre-commit hook active; GitHub Action green
- [x] `../private/` created with `.env` (empty) and README
- [x] career-ops installed (`npm install`), `CAREER_OPS_DATA_DIR` pointed at `../private/`, `node doctor.mjs` green (via `scripts/co.sh doctor.mjs`; only onboarding files missing, handled in Phase 1)
- [x] GitHub issues created for Phases 1–9

## Phase 1 — Onboard
- [x] `cv.md` in `private/` (verified facts only)
- [x] `config/profile.yml`, `modes/_profile.md` (target-role definition), `modes/_custom.md` (house rules)
- [x] `rules/` templates in this repo (placeholders, no personal thresholds)
- [x] One job evaluated end-to-end by hand

## Phase 2 — Extractor + tier engine
- [x] JSON schema for extracted facts (with evidence quotes)
- [x] Extraction prompt; runs via `claude -p` with no tools
- [x] `engine/tier-engine.mjs`: S/A/B/C, caps, drops, exclusions, "why this tier"
- [x] Unit tests for every rule

## Phase 3 — Calibration
- [x] 8–10 roles pulled from the old Job Postings DB; facts + expected tier confirmed by me
- [x] Eval runner; report shows extraction vs rule misses
- [x] ≥ 8/10 tiers match; misses explained and fixed or documented

## Phase 4 — Notion
- [ ] New Job Postings DB schema (market-tracking fields, date added)
- [ ] Export plugin: every scored role upserted; old DB archived
- [ ] Company Radar DB schema

## Phase 5 — Sources
- [ ] Companies to Watch boards → generated `portals.yml`
- [ ] startup-boards plugin enabled
- [ ] Serper discovery + NYC tech funding sites

## Phase 6 — Company Radar + Form D
- [ ] SEC Form D provider (NY filings flagged)
- [ ] Radar enrichment: funding, what they do, leaders (public sources), NYC presence, open roles, deployment-fit read

## Phase 7 — Delivery
- [ ] iMessage alert on new S-tier role
- [ ] Weekly email: newly funded NYC companies + roles roundup
- [ ] Daily runner via launchd

## Phase 8 — Prep packs
- [ ] Auto pack for S roles: tailored CV, cover letter, interview prep, outreach draft
- [ ] Pace: ~1/day, ≤3/day, ≤5/week; overflow queued by score
- [ ] Every CV line verified against `cv.md`

## Phase 9 — Ship
- [ ] `install.sh` + `/onboard`
- [ ] README results, demo GIF, eval numbers
- [ ] Form D upstream PR to career-ops
- [ ] Full-history secret scan + sanitizer; flip repo public
