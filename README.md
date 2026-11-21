# career-ops-deployment-kit

**A deployment layer for [career-ops](https://github.com/santifer/career-ops): the open-source AI job search agent, configured and extended for one demanding user.**

> Status: shipped 2026-11-20, and running every day since 2026-11-03 (7 AM and 1 PM). All nine phases are done except offering the Form D reader back to career-ops, which is drafted but not yet sent. See the [roadmap](docs/ROADMAP.md).

![Demo: install, then the tier engine grading two example roles](docs/img/demo.gif)

## Why this exists

I'm searching for customer- and strategy-facing AI deployment roles (Deployment Strategist, Forward Deployed PM, AI Strategist, BizOps/S&O, Chief of Staff) at AI-native and frontier tech companies in New York. That search has two problems:

- **Recall.** There's no standard title. The right role might be called "Deployment Strategist," "AI Transformation," or "Forward Deployed PM," and many live only on a company's own job board or at a company that raised money last week.
- **Precision.** Titles mislead. A "Forward Deployed" role can be a software engineering job; a "Deployment" PM can be internal inference infrastructure; a BizOps role can be back-office or quota-carrying.

Rather than build a job search tool from scratch, I built on career-ops. I started from its formats for describing a candidate and their rules, and I use its CV-to-PDF rendering, its fact gate (every number and claim in a document is checked against the CV) and its ATS keyword checks. Everything else here is my own layer: sources it doesn't read, a market database, my judgment encoded as tested rules, and delivery that fits how I actually work.

It's also the deployment job in miniature: take a general platform, configure it for one customer's workflow, extend it where it falls short, measure whether it works, and iterate.

## What the kit adds

| Area | What the kit does |
|---|---|
| **Sources** | Reads company job boards directly (Ashby, Greenhouse, Lever, Rippling), finds new boards through investor portfolio boards and a weekly search, and spots newly funded NYC companies from SEC Form D filings and funding news |
| **Market database** | Every posting seen, with open and close dates, so hiring can be counted month by month |
| **Grading** | The AI fills in a fixed form about each role, with quotes; a **deterministic tier engine** (plain tested code) decides S / A / B / C and explains why, step by step |
| **Precision** | Catches misleading titles: engineering jobs with strategy titles, internal-infrastructure "deployment" roles, quota-carrying sales, back-office roles |
| **Company Radar** | Researches newly funded NYC companies and scores how likely they are to need deployment roles |
| **Delivery** | Notion databases for triage, a text for every new top role, a daily summary text, a Sunday email of newly funded companies |
| **Prep packs** | A tailored CV, cover letter, interview prep and outreach drafts for top roles, paced, with every line checked against the CV; nothing is ever sent |
| **Quality** | 364 tests, a setup check, and an accuracy check against real roles I've labeled, re-run after rule changes |

How the pieces fit: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Results so far

From the first daily run on 2026-11-03 to 2026-11-20:

| | |
|---|---|
| Job postings tracked | **55,082** from **496** company job boards plus investor portfolio boards (7,912 in New York) |
| Roles graded by the tier engine | **580**: 63 S · 107 A · 76 B · 242 C · 92 excluded or below the walk-away pay |
| Funding signals | **3,015** SEC Form D filings screened and **236** funding rounds recorded; **686** companies tracked |
| Prep packs | **24** built for top roles. **4** held for a human look by the meaning check: 1 real stretch, 3 true lines the check couldn't yet see (fixed in D121) |

**Accuracy** (2026-11-20, rules as of today): **21 of 24** real postings get the tier I'd give them (88%); on the **12 roles the rules never saw** while being written, **10 of 12** (83%). Of the 3 misses, 2 are the AI misreading a role's shape and 1 is a rule; the report says which, so each miss points at its fix. The labeled roles themselves stay private.

## How it works

```mermaid
flowchart LR
  A[Sources<br/>company job boards · investor boards<br/>search · Form D · funding news] --> B[(Market database<br/>every posting seen)]
  B --> C[Extract<br/>AI fills in a fixed form, with quotes]
  C --> D[Tier engine<br/>tested code: S/A/B/C]
  D --> E[Notion<br/>Job Postings + Company Radar]
  D --> F[Text<br/>new S-tier role]
  D --> G[Prep pack<br/>CV · cover · prep · outreach draft]
  B --> H[Weekly email<br/>newly funded companies]
```

**Design principle: the model extracts, code decides.** The AI reads each job description and returns structured facts (role shape, years asked, traps and red flags, each with a quote); the pay, location and dates come straight from the job board. A small, unit-tested rules engine turns those facts into a tier. When a role is mis-tiered, the accuracy check shows whether the AI's reading or a rule was wrong.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · design decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## Principles

- **Built on career-ops, not a fork.** career-ops stays unmodified, pinned to the exact version the kit is tested on; updating it is a deliberate step with a full test run. The kit uses it through its scripts and file formats, with its data folder pointed at `private/`.
- **Human in the loop.** Nothing is ever submitted or sent on my behalf. Outreach is drafts only. No LinkedIn scraping or automated sign-in.
- **Private by construction.** Personal data and keys live outside this repo entirely (see [docs/SECURITY.md](docs/SECURITY.md)).
- **Honest outputs.** Tailored CV lines are checked against the source CV; no invented facts or numbers.

## Repo layout

```
install.sh   one-command setup (career-ops at the pinned commit + private folder from templates)
rules/       target-role definition and house rules (templates; real values stay private)
extractor/   AI extraction (no tools), job-board readers, SEC Form D, funding news, company research
engine/      deterministic tier engine + tests
market/      the market database: every posting seen, scans, Company Radar
packs/       prep packs: tailored CV, cover letter, interview prep, outreach draft, fact checks
notion/      Notion sync (Job Postings + Company Radar)
delivery/    weekly email through Apple Mail
scripts/     daily runner, setup check, launchd install
evals/       eval runner (labeled roles live in the private folder)
examples/    made-up facts files for trying the tier engine
docs/        architecture, decisions (D1–D128), roadmap, security
```

## Possible next steps

- Company Radar for San Francisco Series A–C AI companies (D73).
- Switches to run without Notion or Serper (D128 keeps them required for now).

## Setup

Needs macOS (the daily run uses Messages, Mail, Reminders and launchd), Node 22.13+, git, the [Claude Code](https://claude.com/claude-code) CLI, a [Notion](https://www.notion.so/my-integrations) integration and a [Serper](https://serper.dev) key.

```bash
mkdir job-search && cd job-search
git clone https://github.com/gmmarken/career-ops-deployment-kit.git
career-ops-deployment-kit/install.sh
```

`install.sh` downloads career-ops at the pinned commit next to the kit, creates a `private/` folder beside it from the templates (it never overwrites a file there), installs the secret-scan hook, and runs the setup check. Then open Claude Code in the kit folder and run `/onboard`: it interviews you and fills in `private/` (CV, target roles, tier rules, sources, daily run) until `node scripts/check-setup.mjs` passes. Last, `scripts/install-daily.sh --load` schedules the 7 AM and 1 PM runs. Later, when something changes at work, run `/update-cv`: it checks the new facts with you, updates the CV files and rebuilds `private/documents/cv.pdf` (`scripts/packs.sh cv-pdf`).

## Credits

- [career-ops](https://github.com/santifer/career-ops) by santifer (MIT): the platform this kit is built on.
- Built with [Claude Code](https://claude.com/claude-code).

## License

MIT, see [LICENSE](LICENSE).
