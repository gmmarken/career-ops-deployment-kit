# market/

The long-term market dataset: every posting the kit sees, when it was open, and how it was classified, so hiring can be charted month by month (e.g. NYC deployment-strategy roles per company). (D30–D33)

| File | What |
|---|---|
| `store.mjs` | SQLite database (`<data dir>/data/market.db`, Node's built-in `node:sqlite`): companies, postings, scans, tier history, recall checks |
| `classify.mjs` | Versioned, no-AI classifiers run on every posting: title family (`title-v1`), home metro, company-name matching |
| `record.mjs` | Records one tiered posting plus fingerprints of the settings and extraction instructions |
| `metrics.mjs` | Monthly open/new counts per company and family, rankings, CSV |
| `cli.mjs` | `scripts/market.sh backfill · metrics · recall` |

## How time works
- A posting is **open** from its start (the earlier of the board's posted date and the day we first saw it) until it **closes**.
- A posting closes only after **2 complete, successful scans** of its board miss it, and it closes on the last day it was seen. A failed scan never closes anything.
- Every scan is logged. Metrics show how many scans ran each month; a month with none is "no coverage", never zero hiring.

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
```
