# market/

The long-term market dataset: every posting the kit sees, when it was open, and how it was classified, so hiring can be charted month by month (e.g. NYC deployment-strategy roles per company). (D30–D33)

| File | What |
|---|---|
| `store.mjs` | SQLite database (`<data dir>/data/market.db`, Node's built-in `node:sqlite`): companies, postings, scans, tier history, recall checks |
| `classify.mjs` | Versioned, no-AI classifiers run on every posting: title family (`title-v2`, incl. a `borderline` label), the text check for borderline titles (`text-v1`), home metro, company-name matching |
| `boards.mjs` | Which job boards the scan reads: boards seen on recorded postings, plus boards found on investor job boards or added by hand; watched companies with no board |
| `record.mjs` | Records one tiered posting plus fingerprints of the settings and extraction instructions |
| `metrics.mjs` | Monthly open/new counts per company and family, rankings, CSV |
| `cli.mjs` | `scripts/market.sh backfill · scan · discover · relabel · add-board · metrics · stats · recall · enrich` |
| `sources.example.json` | Template for `private/config/sources.json`: the investor job boards (Getro, a16z) the scan reads |

## How time works
- A posting is **open** from its start (the earlier of the board's posted date and the day we first saw it) until it **closes**.
- A posting closes only after **2 complete, successful scans** of its board miss it, and it closes on the last day it was seen. A failed scan never closes anything.
- Every scan is logged. Metrics show how many scans ran each month; a month with none is "no coverage", never zero hiring.

## History is append-only (D38–D40)
Nothing is overwritten without the old value being kept:

| Table | One row per… | Answers |
|---|---|---|
| `postings` | posting, with open/close dates | open roles per month |
| `posting_changes` | changed pay, title, location or work model | pay trends, retitled roles |
| `companies` | company record (status, stage, investors, sources…), the source of truth | current view |
| `company_snapshots` | each time research learns something new | what we knew, and when |
| `funding_rounds` | funding event (round, amount, date, investors, source) | newly funded companies |
| `company_calls` | change to your four company columns, by you, the kit, or the import | your judgment over time |
| `tier_decisions` | each tiering | how a role's tier changed |
| `scans` | scan run | was a month covered? |
| `monthly_stats` + `frozen_months` | month × company × family × scope | the numbers you publish |

`config/companies.json` is a **generated copy** of the company records; edit company calls in Notion.

## Monthly numbers freeze (D39)
- `scripts/market.sh stats` refreshes the current and other open months (**provisional**).
- A month **freezes 7 days after it ends**, but only once tracking has begun (from the month of the first completed scan). Earlier months are "before tracking" and never freeze.
- Frozen numbers never change. A later correction is a separate row with a reason.
- `metrics` exports the stored numbers.

## Definitions are versioned
`title_family` and `title_classifier` are stored per posting. Changing a definition bumps the version and is a recorded decision; old rows keep the version that labelled them, so month 1 and month 12 are compared like with like. Tiered postings also keep the AI's family in their tier history.

## Coverage
- Breadth comes from sources (Phase 5).
- `scripts/market.sh recall <file>` checks a list you collected **by hand** (one `Company | Title` per line, e.g. from a LinkedIn search; no scraping) and reports how many the database already had, plus which companies are missing.

## Commands
```bash
scripts/market.sh backfill                              # load already-tiered roles, no AI calls
scripts/market.sh metrics --from 2026-11 --to 2027-10   # NYC + target families; add --all-locations / --all-families
scripts/market.sh recall linkedin-2026-11.txt
scripts/market.sh enrich --limit 10                     # research companies with no researched info
scripts/market.sh stats                                 # refresh provisional months, freeze finished ones
scripts/market.sh scan                                  # investor boards → known boards → text check (all no AI)
scripts/market.sh relabel --dry-run                     # show what the current title classifier would change
scripts/market.sh add-board <job link> --company NAME   # read this company's board from now on
scripts/market.sh discover [--dry-run] [--force]        # search-engine discovery now (normally weekly, inside scan)
```

## What a scan does (D41, D49–D51)
1. **Investor job boards (Getro).** For each board in `private/config/sources.json`, read its public sitemap: every job link, with the title in the link. For each company with a target or borderline title that hasn't been traced yet, open **one** of its job pages to see where the company really posts jobs. Ashby, Greenhouse and Lever boards are added to the scan; anything else is listed as "posts somewhere we can't read yet". Postings themselves always come from the company's own board.
   **a16z-style portfolio boards** (`a16z_boards`, D61): the sitemap lists one page per company; up to 150 due pages per run are opened (new ones first, then any not checked for 7 days). A company with a target or borderline title among its listed jobs has its readable boards added.
2. **Every known board** is read in full (Ashby, Greenhouse, Lever, Rippling).
   **Search-engine discovery** (`serper`, D66): once every `every_days` (7), each title is searched on each readable job-board site (Ashby, Greenhouse, Lever, Rippling) in New York, NYC or Brooklyn, through Serper (Google results). Each company board in the results is added. One search page = one credit; a run stops at `max_credits_per_run`. A bad key or no credits stops the run and is reported. `market.sh discover --dry-run` lists the searches without spending; `--force` runs it now.
3. **Companies you Watch** with no readable board are reported as a problem, with the fix (`add-board`).
4. **Text check.** Open NYC postings labelled `borderline` by title are read from their board and checked for three things: AI work, putting it into use (deploy, implement, roll out, forward-deployed), and customers. Only hits are tiered by `tier-new.sh`, so AI is spent only on promising roles. The words found are stored with the result.

Any failed step is reported, the others still run, and the scan exits non-zero; a failed board never closes postings.

## Title classifier versions
- `title-v1`: deployment / AI strategist, forward-deployed PM, BizOps / S&O, chief of staff, forward-deployed engineer (context), other.
- `title-v2` (D49, D56): adds Solutions Strategist, Deployment Lead and non-engineer forward-deployed titles; Strategy & Planning counts as BizOps; adds the `borderline` label for titles that need the text check. `market.sh relabel` moves **open** postings to the current version (each change logged in `posting_changes`); closed postings keep their old label.

