# evals/

Calibration: does the pipeline give the tier the candidate would? (Phase 3)

| File | What |
|---|---|
| `run-evals.mjs` | Re-tiers every labeled case and writes a report (run via `scripts/evals.sh`) |
| `compare.mjs` | Compares one case: match, **AI misread** (a confirmed key fact differs), or **rule miss** (facts agree, tier doesn't) |
| `compare.test.mjs` | Tests for the comparison logic |

Everything personal stays in the private data dir:

```
<data dir>/evals/
  cases.json        labeled cases: id, label {tier, why, source}, source {url} or {jdFile, company, title, locations, pay}, key_facts
  snapshots/<id>.json  frozen extracted facts + the instruction fingerprint they came from
  reports/<date>.md    calibration reports
```

## How it saves AI calls
- `scripts/evals.sh` re-tiers from frozen snapshots: **zero AI calls**, under a second. Use it after any rule or settings change.
- `scripts/evals.sh --refresh [id …]` re-extracts with the AI. Use it after changing `extractor/prompt.md` or the schema; the report marks snapshots made with older instructions.
- Company status is re-read from the watchlist on every run, so watchlist edits count without new AI calls.
- `--prefill` copies extracted key facts into cases that have none, marked `key_facts_confirmed: false`. Misses stay unclassified until the candidate confirms those facts.
