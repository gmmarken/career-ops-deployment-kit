# Security & privacy

## Where things live
| What | Where | In git? |
|---|---|---|
| API keys (Notion, Serper) | `../private/.env`, backed up in a password manager | Never |
| CV, profile, pay thresholds, tracker, reports, job descriptions | `../private/` (career-ops `CAREER_OPS_DATA_DIR`) | Never |
| Rules templates, code, eval labels | this repo | Yes |

Because personal data sits outside the repo folder, `git add .` cannot pick it up.

## Guards
1. `.gitignore` blocks env files, CVs, PDFs, and career-ops user-layer paths as a second line of defense.
2. **gitleaks pre-commit hook** (`scripts/setup-hooks.sh`) blocks any commit containing something that looks like a secret.
3. **gitleaks GitHub Action** scans every push and PR.
4. Before the repo went public (2026-11-20): a gitleaks scan of every commit on every branch, and a personal-data pass over the code history and every PR, issue and comment (D125).
5. `scripts/check-setup.mjs` reports whether each key is set without ever printing it.

## If a key is ever committed
Treat it as compromised, even in a private repo:
1. Revoke and regenerate it with the provider first.
2. Then remove it from history (`git filter-repo`) and force-push.
3. Note it in the changelog without the value.

## Untrusted input
Job descriptions and web pages are written by strangers and may contain instructions aimed at AI models. The extraction step runs with no tools (text in, JSON out); only this kit's code writes files or calls APIs.

## Key hygiene
- One key per service, scoped as narrowly as the service allows (e.g. the Notion integration is shared only with the one page that holds its two databases).
- Prefer free tiers and hard spend limits where offered.
- Rotate keys if a laptop is lost or a key appears anywhere unexpected.
