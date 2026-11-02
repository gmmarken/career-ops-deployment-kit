#!/usr/bin/env bash
# Tier one job: hard facts (code) → judgment facts (claude, no tools) → company bar → tier (code).
# Usage: scripts/tier.sh <job URL> [--model sonnet] [--no-research]
#        scripts/tier.sh --jd-file <file> --company "<name>" [--title "<role>"] [--location "<city>" ...] [--pay 135000-180000]
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "tier.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node "$KIT_DIR/scripts/tier.mjs" ${@+"$@"}
