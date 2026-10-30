#!/usr/bin/env bash
# Point git at the repo's hooks folder so the gitleaks pre-commit hook runs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath scripts/hooks
echo "Hooks installed (core.hooksPath=scripts/hooks)."
