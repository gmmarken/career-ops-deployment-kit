#!/usr/bin/env bash
# Calibration: re-tier the private labeled cases and report matches and misses.
# Usage: scripts/evals.sh [--refresh [case-id ...]] [--prefill]
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "evals.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node "$KIT_DIR/evals/run-evals.mjs" ${@+"$@"}
