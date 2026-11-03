# market/

The long-term market dataset: every posting the kit sees, when it was open, and how it was classified, so hiring can be charted month by month (e.g. NYC deployment-strategy roles per company). (D30–D33)

| File | What |
|---|---|
| `store.mjs` | SQLite database (`<data dir>/data/market.db`, Node's built-in `node:sqlite`): companies, postings, scans, tier history, recall checks |
| `classify.mjs` | Versioned, no-AI classifiers run on every posting: title family (`title-v1`), home metro, company-name matching |
| `record.mjs` | Records one tiered posting plus fingerprints of the settings and extraction instructions |
| `metrics.mjs` | Monthly open/new counts per company and family, rankings, CSV |
| `cli.mjs` | `scripts/market.sh backfill · scan · metrics · stats · recall · enrich` |

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
scripts/market.sh scan                                  # read every open posting on known boards (no AI)
```
