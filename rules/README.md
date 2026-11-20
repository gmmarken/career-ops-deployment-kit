# rules/

Templates for career-ops' two personal rule files. Real values, including pay thresholds and CV content, live in the private data dir (`../private/`), never here.

| Template | Copy to | What it holds |
|---|---|---|
| `_profile.template.md` | `<data dir>/modes/_profile.md` (`install.sh` copies it there) | Who the candidate is: target-role definition and traps, archetypes, strengths with CV-backed stories, "why now" story, comp targets, location, writing style |
| `_custom.template.md` | `<data dir>/modes/_custom.md` | How roles are judged: the S/A/B/C tier recipe (exclusions, walk-away pay, traps, criteria, seniority, caps, drops, tags), fact rules, output preferences, off-limits actions |

Replace every `{placeholder}`. Keep the walk-away number out of `config/profile.yml` → `compensation.minimum`: career-ops treats that field as a dealbreaker and skips scoring entirely.

The tier recipe in `_custom.md` is the readable version; the tier engine in `engine/` applies the same numbers from `config/tier-rules.json`, and a drift check (`engine/check-rules-drift.mjs`, also part of `scripts/check-setup.mjs`) fails if the two disagree.
