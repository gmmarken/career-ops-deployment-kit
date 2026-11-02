#!/usr/bin/env bash
# Notion: setup <parent page URL> | sync (push postings + companies) | pull (read back company edits)
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
[ -d "$DATA_DIR" ] || { echo "notion.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
export CAREER_OPS_DATA_DIR="$DATA_DIR"
exec node --no-warnings=ExperimentalWarning "$KIT_DIR/notion/cli.mjs" ${@+"$@"}
