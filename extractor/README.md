# extractor/

Turns a job link into the facts the engine needs. Code owns exact facts; the model owns judgment; nothing is guessed. (D4, D5)

| Step | Who | File |
|---|---|---|
| Title, locations, workplace, posted date, **pay**, JD text | Code, from the ATS's public API (Ashby, Greenhouse, Lever) | `ats.mjs` |
| Family, shape, traps, red flags, years, fit, tags, each with a JD quote | `claude -p` with **no tools**, Sonnet by default | `extract.mjs`, `prompt.md`, `judgment.schema.json` |
| Company bar (status, stage, owner, sources) | Private watchlist first; else a **separate** `claude -p` call that gets only the company name and may only search/read the web, run only when the role could reach S or A | `research.mjs`, `company.schema.json` |
| Answer checking | Our own schema checker re-validates every model answer | `validate.mjs` |
| Running `claude` safely | Empty temp dir, explicit tool list, `--strict-mcp-config`, no session persistence, never `--dangerously-skip-permissions` | `claude.mjs` |

Run everything with `scripts/tier.sh <job URL>`. Results are saved to `<data dir>/tiers/`, with the number of AI calls and tokens used.

The watchlist is `<data dir>/config/companies.json` (`{ "companies": [ { "name", "aliases", "status", "stage", "owner_categories", "parent", "is_mbb", "reason", "verified" } ] }`). Research results are added as `"verified": false`; set it to `true` (or edit the call) once you've checked it.

Set `KIT_EXTRACT_MODEL` to use a different model.
