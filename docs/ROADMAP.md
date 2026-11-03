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

## Phase 4 — Market database + Notion
- [x] 4a: market database (postings with first/last seen, companies, scans, tier history), versioned classifiers, monthly metrics CSV, recall check
- [x] 4b: Notion integration key (by hand)
- [x] History: company records + snapshots, funding rounds, company-call log, posting changes, frozen monthly stats
- [x] New Job Postings DB schema (market-tracking fields, date added)
- [x] Export plugin: every scored role upserted; old DB archived
- [x] Company Radar DB schema

## Phase 5 — Sources
- [x] Whole-board scan of known company boards (`market.sh scan`, run by hand; first scan 2026-11-02)
- [x] Batch-tier new NYC target-family roles (`tier-new.sh`)
- [x] Run the scan daily: `scripts/daily.sh` via launchd (scan → `tier-new.sh` → backup), an iMessage every morning: a summary when it worked, a loud failure notice when it didn't (D47, D53, D63)
- [x] Daily dated `market.db` backup, keep 30, reaching iCloud through the synced workspace folder (D48, D54, D59)
- [ ] Search-engine discovery of ATS postings (deployment-family titles, New York)
- [x] Title classifier v2: more title patterns, plus a no-AI text check for borderline titles (D49, D56)
- [x] Investor job boards on Getro (Thrive, Scale) → companies' own boards added to the scan (D50–D51, D57)
- [x] Companies to Watch: a watched company with no readable board is reported; `market.sh add-board` (D51)
- [x] Rippling board reader (D60)
- [x] a16z portfolio board: relevant companies traced to their boards, pages rechecked weekly (D61)
- [ ] Built In NYC reader (after a terms-of-use review)
- [ ] Serper discovery + NYC tech funding sites

## Phase 6 — Company Radar + Form D
- [ ] SEC Form D provider (NY filings flagged)
- [ ] Radar enrichment: funding, what they do, leaders (public sources), NYC presence, open roles, deployment-fit read

## Phase 7 — Delivery
- [ ] iMessage alert on new S-tier role
- [ ] Weekly email: newly funded NYC companies + roles roundup
- [x] Daily runner via launchd (minimal form built early in Phase 5, D53; this phase adds the S-tier alert and weekly email to it)

## Phase 8 — Prep packs
- [ ] Auto pack for S roles: tailored CV, cover letter, interview prep, outreach draft
- [ ] Pace: ~1/day, ≤3/day, ≤5/week; overflow queued by score
- [ ] Every CV line verified against `cv.md`

## Phase 9 — Ship
- [ ] `install.sh` + `/onboard`
- [ ] README results, demo GIF, eval numbers
- [ ] Form D upstream PR to career-ops
- [ ] Full-history secret scan + sanitizer; flip repo public
