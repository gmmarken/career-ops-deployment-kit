#!/usr/bin/env bash
# Daily unattended run: board scan, tier new roles, Company Radar (Form D, funding news, research), back up market.db. Sends one iMessage every run:
# a morning summary when all went well, a loud failure notice otherwise (D63).
# Usage: scripts/daily.sh [--midday | --test-message | --sample-messages | --sample-email]   (launchd: no arguments at 7 AM, --midday at 1 PM via the helper app)
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "daily.sh: private data dir not found at $DATA_DIR" >&2; exit 2; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node --no-warnings=ExperimentalWarning "$KIT_DIR/scripts/daily.mjs" ${@+"$@"}
