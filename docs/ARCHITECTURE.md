# Architecture (v0.2, 2026-10-29)

Built on [career-ops](https://github.com/santifer/career-ops) (MIT, pinned at v1.38.0). This kit adds a personal deployment layer on top; it does not modify career-ops. Personal targets and thresholds live in private config, not in this repo.

## 1. Layers

| Layer | What | Where | Git |
|---|---|---|---|
| Upstream | career-ops, unmodified, pinned version | `career-ops/` | upstream only |
| Kit (this repo) | rules pack, plugins, scripts, evals, docs | `career-ops-deployment-kit/` | this repo |
| Private data | `cv.md`, real profile, tracker, reports, JDs | `private/` (`CAREER_OPS_DATA_DIR`) | never |
| Keys | `.env` (Notion, Resend, Serper…) | `private/.env` + password manager | never |
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
| 6 | **SEC Form D** | provider/ingest plugin (→ upstream PR) | `company-funded.mjs` pattern |
| 7 | **Discovery**: Serper search + funding sites (AlleyWatch, Built In NYC, TechCrunch) | plugin(s) | `serper` community plugin, RSS pattern |
| 8 | **Company Radar** — enrich new companies (funding, what they do, leaders from public sources, NYC presence, open roles, "could they use a DS?") | script + Notion DB | `company-funded.mjs` |
| 9 | **Notion: new Job Postings DB** (every role, date added, market-tracking fields) + **Company Radar DB** | export plugin | `plugins/notion` client code |
| 10 | **iMessage S-tier alert** (macOS `osascript` → Messages) | notify plugin | notify hook |
| 11 | **Weekly email** (Resend): funded NYC companies + new roles roundup | notify plugin | — (new) |
| 12 | **Prep packs** for S roles: CV, cover, interview prep, outreach draft — ~1/day, ≤3/day, ≤5/week, queue overflow | orchestrator script | `pdf`, `cover`, `interview-prep`, `contacto` modes; `verify-cv-facts.mjs` |
| 13 | **Daily runner** (launchd on the Mac) | shell + Node | `install-scan-schedule.sh`, liveness checks |
| 14 | **Evals**: 8–10 real roles with my confirmed tier | harness + CI | `eval-golden.mjs` pattern |

## 4. Daily run

```
launchd (daily) → run-daily.sh
  1. discover: Form D + funding feeds + Serper → new companies → Company Radar (enrich)
  2. scan: portals.yml (Watch + Radar boards) + startup boards → pipeline.md
  3. liveness check (static "filled" = provisional)
  4. extract (claude -p, new postings only) → JSON
  5. tier engine → S/A/B/C + reasons
  6. Notion: upsert every role (date added) + Radar updates
  7. new S role → iMessage + queue prep pack (pace limits)
Weekly (Sun): Resend email — newly funded NYC companies + roles roundup
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
│   ├── plugins/           # sec-form-d, discovery, notion-job-search, imessage-alert, resend-weekly
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
