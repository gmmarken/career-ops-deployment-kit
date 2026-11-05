#!/usr/bin/env bash
# Prep packs for S-tier roles (Phase 8).
# Usage: scripts/packs.sh build [--dry-run] | status | requeue <job link> | notes
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "packs.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node --no-warnings=ExperimentalWarning "$KIT_DIR/scripts/packs.mjs" ${@+"$@"}
