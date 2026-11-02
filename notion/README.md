# notion/

Notion is the **working view** of the market database (D26, D30): you browse, triage and edit there; the market database stays the source of truth for history.

| File | What |
|---|---|
| `client.mjs` | Minimal Notion API client (version 2025-09-03). Paced under ~3 requests/s; **no retries**: any error stops with Notion's message and a next step |
| `schema.mjs` | Layouts for **Job Postings** and **Company Radar**, and which columns are yours |
| `setup.mjs` | Creates both databases under a parent page; ids go to `<data dir>/config/notion.json` |
| `sync.mjs` | Push postings and companies; pull your company calls |

## Setup (once)
1. Create an internal integration at notion.so/profile/integrations (read, update, insert content; no user info). Put its secret in `<data dir>/.env` as `NOTION_ACCESS_TOKEN=…`.
2. Share one parent page with it (••• → Connections).
3. `scripts/notion.sh setup <parent page URL>`

## Who owns what
| Database | Written by the kit (overwritten every sync) | Yours (set once on create, never overwritten) |
|---|---|---|
| Job Postings | Role, Company (link), Tier, Why, Flags, Family, Shape, Fit, GM/Product path, Back office, Pay, Locations, NYC, Work model, Office days, Years asked, Posted, Date added, Last seen, Live, Board, URL, Key | Status, Favorite, Notes |
| Company Radar | Stage, Last raise, Investors, What they do, Parent, Excluded as, Reason, Sources, Origin, First seen (+ role counts) | **Status, Verified, Watch, AI-native**, read back into the watchlist before every tiering run |

## Commands
```bash
scripts/notion.sh sync    # push everything (tier.sh already syncs each role it tiers)
scripts/notion.sh pull    # read your company calls into the watchlist (tier.sh does this first)
```
`tier.sh --no-notion` skips both, with a printed warning.
