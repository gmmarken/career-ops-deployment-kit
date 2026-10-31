# rules/

Templates for career-ops' two personal rule files. Real values, including pay thresholds and CV content, live in the private data dir (`../private/`), never here.

| Template | Copy to | What it holds |
|---|---|---|
| `_profile.template.md` | `<data dir>/modes/_profile.md` | Who the candidate is: target-role definition and traps, archetypes, strengths with CV-backed stories, "why now" story, comp targets, location, writing style |
| `_custom.template.md` | `<data dir>/modes/_custom.md` | How roles are judged: the S/A/B/C tier recipe (exclusions, walk-away pay, traps, criteria, seniority, caps, drops, tags), fact rules, output preferences, off-limits actions |

Replace every `{placeholder}`. Keep the walk-away number out of `config/profile.yml` → `compensation.minimum`: career-ops treats that field as a dealbreaker and skips scoring entirely.

The tier recipe is prompt-level for now. Phase 2 moves it into tested code in `engine/`.
