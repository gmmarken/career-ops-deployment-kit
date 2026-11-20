# Architecture (v0.2, 2026-10-29)

Built on [career-ops](https://github.com/santifer/career-ops) (MIT, pinned at commit `a068b71` from 2026-10-30; its VERSION file says 1.38.0, D128). This kit adds a personal deployment layer on top; it does not modify career-ops. Personal targets and thresholds live in private config, not in this repo.

## 1. Layers

| Layer | What | Where | Git |
|---|---|---|---|
| Upstream | career-ops, unmodified, pinned version | `career-ops/` | upstream only |
| Kit (this repo) | rules pack, plugins, scripts, evals, docs | `career-ops-deployment-kit/` | this repo |
| Private data | `cv.md`, real profile, tracker, reports, JDs | `private/` (`CAREER_OPS_DATA_DIR`) | never |
| Keys | `.env` (Notion, Serper…) | `private/.env` + password manager | never |
| Market data | Every posting seen (first/last seen, closed), companies, scans, tier history; source of truth for monthly hiring metrics. Notion is a working view synced from it (D30) | `private/data/market.db` | never |

## 2. Design principle: the model extracts, code decides the tier

Same principle as deterministic grading: the model never makes the final call.
1. **Extract (LLM, `claude -p`):** read the JD → structured JSON: role family, role shape (Strategic/Mixed/Tactical), pay range, equity, years asked + hard gates, location/remote, red flags found (with quotes), traps hit, back office vs growth-facing, GM/Product path, company stage/investors/raise + the model's company-bar judgment and reason, fit.
2. **Decide (deterministic code, `tier-engine.mjs`):** apply S/A/B/C rules, caps (Reach ≤ B, Tactical ≤ B, MBB ≤ A), one-tier drops (remote, back office, each red flag), exclusions.
3. **Explain:** every role carries "why this tier" (criteria met/missed, flags by name).

Why: rules are testable and versioned, the eval set can pinpoint whether a miss is extraction or rules, and it's a clean interview story.

## 3. Components

| # | Component | Type | Reuses from career-ops |
|---|---|---|---|
| 1 | **Rules pack** — `_profile.md` (who I am, target-role definition), `_custom.md` (house rules, traps) | user-layer files | evaluation modes, archetypes |
| 2 | **Extractor prompt + schema** | prompt + JSON schema | `oferta.md` A–H report kept for depth |
| 3 | **Tier engine** | Node module + unit tests | — (new) |
| 4 | **Sources**: Companies to Watch / Radar boards | `portals.yml` (generated) | `scan.mjs`, ATS providers |
| 5 | Startup boards | community plugin `startup-boards` | plugin engine |
| 6 | **SEC Form D** (`extractor/formd.mjs`, D70–D71) | reader in the kit (→ upstream PR in Phase 9) | `company-funded.mjs` idea; its feeds aren't reused (D72) |
| 7 | **Discovery**: Serper job-board search (D66) + funding news: TechCrunch RSS, Serper news (D72). AlleyWatch and Built In are not read (terms) | kit readers | RSS pattern |
| 8 | **Company Radar** — `market.sh radar`: funded companies in, research (funding, what they do, leaders from public sources, NYC presence, careers page), deployment fit by rule (`engine/fit.mjs`) | script + Notion DB | — |
| 9 | **Notion: new Job Postings DB** (every role, date added, market-tracking fields) + **Company Radar DB** | export plugin | `plugins/notion` client code |
| 10 | **iMessage S-tier alert** (macOS `osascript` → Messages): its own text per new S role, from the 7 AM and 1 PM runs (D78–D79) | `scripts/daily.mjs` | notify hook |
| 11 | **Weekly email** (Apple Mail on the Mac, D80): funded NYC companies + new roles roundup, Sundays (D81) | `delivery/weekly.mjs`, `delivery/mail.mjs` | — (new) |
| 12 | **Prep packs** for S roles: CV, cover, interview prep, outreach draft — ~1/day, ≤3/day, ≤5/week, queue overflow | orchestrator script | `pdf`, `cover`, `interview-prep`, `contacto` modes; `verify-cv-facts.mjs` |
| 13 | **Daily runner** (launchd on the Mac) | shell + Node | `install-scan-schedule.sh`, liveness checks |
| 14 | **Evals**: 8–10 real roles with my confirmed tier | harness + CI | `eval-golden.mjs` pattern |

## 4. Daily run

```
launchd 7:00 → CareerOps Daily.app → scripts/daily.sh
  1. scan: known boards + investor boards + weekly Serper job-board search (market.sh scan);
     a board "not found" 3 runs in a row is retired (D82)
  2. tier-new: grade up to 30 new NYC target roles → each new S role gets its own iMessage now (D78)
  3. radar: Form D + TechCrunch + weekly news search → newly funded NYC companies → research 10 → fit → Notion
  4. weekly-email (Sundays): newly funded NYC companies + roles roundup, sent through Apple Mail (D80–D81)
  5. backup
  → one summary iMessage (or the failure text, which still lists S/A roles graded)
launchd 13:00 → same app, midday mode (D79): scan + grade roles first seen today → S texts; text only on S or failure
(Phase 8: new S role → queue prep pack, pace limits)
```

## 5. Safety and security

- **Keys:** only in `private/.env`; this repo ships `.env.example`. gitleaks pre-commit hook + GitHub Action from the first commit. Full-history scan + sanitizer pass before flipping public.
- **Prompt injection:** job descriptions are untrusted text. career-ops' batch runner defaults to `claude -p --dangerously-skip-permissions`; we won't. Extraction runs with no tools (text in, JSON out); file writes happen in our code, not by the model.
- **Human-in-the-loop:** nothing is submitted or sent except the alert/digest to me. Outreach is drafts only. No LinkedIn scraping or sign-in.
- **CV honesty:** every tailored line checked against `cv.md` (`verify-cv-facts.mjs`); confirmed numbers only.

## 6. Folder layout

```
Claude Job Search Tool/
├── CLAUDE.md              # workspace instructions
├── career-ops/            # upstream runtime (pinned)
├── career-ops-deployment-kit/   # this repo
│   ├── README.md  CHANGELOG.md  install.sh  .env.example  .gitignore
│   ├── rules/             # _profile.template.md, _custom.md
│   ├── extractor/         # prompt + JSON schema
│   ├── engine/            # tier-engine.mjs + tests
│   ├── delivery/          # weekly email (build + send through Apple Mail), shared text formats
│   ├── scripts/           # run-daily.sh, radar-enrich.mjs, prep-queue.mjs, sync-portals.mjs
│   ├── evals/             # cases (URLs + my labels), runner
│   └── .github/workflows/ # gitleaks + tests
├── private/               # CAREER_OPS_DATA_DIR: cv, profile, thresholds, tracker, .env — never committed
└── coding-tutor/          # Project 2, later
```

## 7. Build phases (one branch + PR + issue each)

| # | Phase | Done when |
|---|---|---|
| 0 | Scaffold: repo, gitleaks, CLAUDE.md, `private/`, data dir, `doctor.mjs` green | first commit pushed, secret scan passing |
| 1 | Onboard: `cv.md`, profile, target-role definition | one manual eval end-to-end |
| 2 | Extractor + tier engine + unit tests | rules tests pass |
| 3 | Calibration: 8–10 roles from old DB, I confirm facts + tier | ≥ 8/10 tiers match; misses explained |
| 4 | Notion: new Job Postings DB + export | every scored role lands with date added |
| 5 | Sources: Watch boards, startup boards, Serper, funding sites | first daily scan fills the pipeline |
| 6 | Company Radar + Form D | Radar DB fills with enriched NYC/SF companies |
| 7 | Alerts + weekly email + daily runner | iMessage on S role; Sunday email arrives |
| 8 | Prep packs with pace limits | S role → pack within a day, facts verified |
| 9 | Polish: README, demo, install.sh, Form D upstream PR, sanitizer, go public | stranger can clone and run |

## 8. Open
- New Job Postings DB fields (Phase 4).
