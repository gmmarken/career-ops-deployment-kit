# Decision log

Short records of meaningful design choices: context, decision, why, trade-off.

## D1 — Build on career-ops instead of from scratch (2026-10-22)
**Context:** I needed a job search pipeline for roles with no standard title. career-ops (open source, MIT) already covered ATS scanning, liveness checks, evaluation, tailoring and tracking.
**Decision:** Adopt career-ops as the platform; build only the differentiated layer.
**Why:** Most of the requirements were already met by a maintained, tested platform. Time goes to what's unique: my rules, sources, and delivery.
**Trade-off:** I work within its conventions and extension points.

## D2 — Layer on top, don't fork (2026-10-29)
**Context:** Customizing a platform usually means forking it and drifting from upstream.
**Decision:** Keep career-ops unmodified and pinned; this kit plugs in through user-layer files, `plugins.local/`, and `CAREER_OPS_DATA_DIR`.
**Why:** Upstream fixes keep flowing with no merge conflicts, and reviewers see exactly what I added.
**Trade-off:** Some changes take more effort when no extension point exists; those become upstream PR candidates.

## D3 — Personal data and keys live outside the repo (2026-10-29)
**Decision:** All personal data and keys sit in a sibling `private/` folder that career-ops reads via `CAREER_OPS_DATA_DIR`.
**Why:** Makes it physically hard to leak a CV or key, and lets the repo go public later without a cleanup.
**Trade-off:** A little more setup for anyone copying the kit (handled by templates).

## D4 — The model extracts, code decides the tier (2026-10-29)
**Context:** Tier rules (caps, penalties, pay bands) are precise; LLM judgments drift.
**Decision:** The LLM returns structured facts with evidence quotes; a deterministic, unit-tested engine assigns S/A/B/C and explains why.
**Why:** Rules become testable and versioned, and when a role is mis-tiered the eval set shows whether extraction or a rule was wrong.
**Trade-off:** Two components to maintain instead of one prompt.

## D5 — Extraction runs with no tools (2026-10-29)
**Context:** career-ops' batch runner calls `claude -p` with permission checks disabled. Job descriptions are untrusted text and could carry prompt-injection instructions.
**Decision:** Extraction runs with no tools (text in, JSON out); only kit code writes files or calls APIs.
**Why:** A malicious posting can't make the agent run commands or touch files.
**Trade-off:** Extraction can't browse for extra context; enrichment is a separate, controlled step.

## D6 — Found gaps by reading the platform before building (2026-10-29)
**Context:** The initial plan assumed career-ops' weekly digest and Notion plugin would cover delivery.
**Finding:** `weekly-digest.mjs` summarizes interview sessions, not new roles, and the Notion plugin writes to a fixed "Applications" schema.
**Decision:** Build a weekly email plugin and a Notion export mapped to my own databases.
**Why:** Verifying the platform's actual behavior before building avoided designing around features that didn't exist.

## D7 — Fail loudly; no silent fallbacks (2026-10-30)
**Context:** AI coding agents tend to add fallbacks (backup data sources, hard-coded defaults, swallowed errors) that keep a pipeline "working" while hiding that it's broken.
**Decision:** Errors surface clearly with what failed and how to fix it. No backup providers, mock data, or defaults that mask missing information; unknown facts stay unknown. In unattended runs, failures are reported to me. A failed source can be skipped so the others still run, but the skip is reported and nothing is substituted.
**Why:** A job search tool that quietly returns stale or invented data is worse than one that stops. I'd rather know a source is down than trust results that look complete.
**Trade-off:** More runs end in visible errors that need a fix, and there's no automatic recovery.
