#!/usr/bin/env bash
# Tier every untiered open NYC target-family role found by the board scan.
# Usage: scripts/tier-new.sh [--limit N] [--dry-run]
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "tier-new.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node --no-warnings=ExperimentalWarning "$KIT_DIR/scripts/tier-new.mjs" ${@+"$@"}
