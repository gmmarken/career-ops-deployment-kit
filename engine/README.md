# engine/

Deterministic tier engine: structured facts + your settings → S / A / B / C (or Excluded / Walk-away), with flags and a step-by-step "why this tier". No AI, no network: the same input always gives the same answer. (D4)

| File | What |
|---|---|
| `tier-engine.mjs` | `decideTier(facts, rules, { today })` and `explain(result)` |
| `rules.mjs` | Loads and checks the settings file; any bad field stops the run with its name |
| `tier-rules.example.json` | Example settings (made-up values) used by the tests |
| `check-rules-drift.mjs` | Fails if `config/tier-rules.json` and `modes/_custom.md` disagree on a number |
| `tier-engine.test.mjs` | At least one test per rule (`npm test`) |

Real settings live in `<data dir>/config/tier-rules.json` and are never committed.

## Order of steps
1. **Exclusions** by ownership (`company.owner_categories` ∩ `excluded_categories`) → Excluded
2. **Walk-away pay**: top of a yearly range in your currency ≤ `walkaway_top` → Walk-away, unless ≥ `borderline_floor_top` with substantial equity (then capped at `caps.borderline_equity`)
3. **Location**: no location matching `home_metro` or `home_metro_aliases` (whole words; in "City, State" only the city counts) and not remote → `location.outside_home_metro` (a tier or `Excluded`)
4. **Traps** → C
5. **Criteria**: family (`other` → C), company (`strong`/`exceptional`), shape (`strategic`, or `mixed` at an `exceptional` company), pay (`s_bar_top`, or `early_stage_bar_top` at an early stage; no posted pay is not a miss), fit (`weak` → C). Misses: 0 = S, 1 = A, 2 = B, 3+ = C
6. **Seniority**: years from `experience_start`; +1 to `reach_max_extra_years` over = Reach; more, or an unmet hard gate → C; asks `below_level_years` or more below = Below level
7. **Caps**: Reach (`caps.reach_1_year` when the ask is exactly 1 year over, `caps.reach` otherwise), Below level, Tactical, MBB, borderline equity, and anything `unclear` (family/shape/fit/company) → `caps.unclear_judgment`
8. **Drops**: remote, back office, each red flag; one tier each, never below C
Red flags (each one drop): `ticket_config_work`, `high_account_load`, `quota_ownership`, `travel_50_plus`, `book_of_business`. `sortKey.ai_native` breaks ties within a tier; it never changes the tier.

9. **Flags only**: quota path, old posting (> `old_posting_days`), pay not posted, pay conflict, unverified company research, suspected prompt injection
