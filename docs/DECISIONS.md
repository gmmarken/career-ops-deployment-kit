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

## D8 — One master CV; role framing lives in the profile (2026-10-30)
**Context:** I had two AI-drafted resumes, one for deployment roles and one for operator roles, sharing most of the same facts.
**Options:** (A) one `cv.md` with every confirmed fact, plus per-archetype framing in `_profile.md`; (B) two CV files swapped in before each run.
**Decision:** A.
**Why:** career-ops reads one `cv.md` and tailors per job; one source of truth means facts can't drift between versions, and the fact checker sees everything.
**Trade-off:** The master file is longer than either resume.

## D9 — Every resume fact confirmed once, with a rounding rule for employer metrics (2026-10-30)
**Context:** The resumes were AI-drafted from conversations, which is where inflated or unsourced numbers hide. Some metrics from my current employer shouldn't appear at full precision.
**Options:** (A) keep numbers as written; (B) generalize all employer specifics; (C) tag each item keep / generalize / cut.
**Decision:** C, with a fixed rule: dollar amounts and counts are rounded to a clean figure ("+" or "nearly"), percentages are rounded up to the next 5 with "~", and small decimals become "over X". Internal program names and sensitive work are generalized.
**Why:** One explicit rule applies the same way every time and is easy to defend. The review also caught a percentage with no measurement behind it, which was cut.
**Trade-off:** Some metrics read less precisely.

## D10 — Strict fact gate on generated CVs (2026-10-30)
**Decision:** `config/cv-facts.json` blocks every cut or corrected claim (`forbidden_phrases`) and warns on inflated verbs (`warn_phrases`); career-ops' checker already blocks any number absent from `cv.md`. Tested: the real CV passes; a planted inflated CV is blocked.
**Why:** Phase 8 generates CVs without me watching each one.
**Trade-off / known gap:** career-ops' number matching ignores "~", so "~40" becoming "40" isn't caught. A kit-side check is planned for Phase 8.

## D11 — Target role defined as "is / is not", with trap signals (2026-10-30)
**Options:** (A) the requirements wording as written; (B) the same definition plus JD phrases that reveal each of the four traps.
**Decision:** B.
**Why:** Title-based precision is the core problem; spelling out trap signals helps the model now and becomes test material for Phases 2–3.

## D12 — Walk-away pay is a tier rule, not `compensation.minimum` (2026-10-30)
**Finding:** career-ops treats `profile.yml` → `compensation.minimum` as a dealbreaker that stops before scoring and writes no evaluation.
**Decision:** Keep the walk-away number out of that field. A range topping out at or below it is tiered "Walk-away" (recorded, not considered), except a borderline range with substantial equity, which is scored and capped at B. No posted pay is never a walk-away and never a miss; it's flagged for verification.
**Why:** Every role should be recorded (the Notion DB doubles as market data), and missing pay isn't bad pay.

## D13 — Exclusions follow ownership, not investment; some signals are flag-only (2026-10-30)
**Decision:** An excluded company's subsidiaries are excluded; companies it merely invested in are not (e.g. an Amazon-backed AI lab is fine). "Built to grow into a quota" and postings older than 60 days are flags, not tier changes.
**Why:** Surfaced by the first end-to-end evaluation, where the reference role hit all three edge cases.

## D14 — Add poppler for PDF text extraction (2026-10-30)
**Decision:** Install poppler (`pdftotext`) via Homebrew. Free, local, open source.
**Why:** career-ops' intake script and its ATS checks on generated CV PDFs both need it.
**Trade-off:** One more system dependency to list in `install.sh` (Phase 9).
