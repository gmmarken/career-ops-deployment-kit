#!/usr/bin/env bash
# Run a career-ops script with its data dir pointed at ../private.
# career-ops stays unmodified; personal data never enters this repo.
#
# Usage: scripts/co.sh <script.mjs> [args...]
#   e.g. scripts/co.sh doctor.mjs
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$(cd "$KIT_DIR/.." && pwd)"
CO_DIR="$WORKSPACE/career-ops"
DATA_DIR="$WORKSPACE/private"

if [ $# -lt 1 ]; then
  echo "usage: scripts/co.sh <script.mjs> [args...]" >&2
  exit 2
fi
[ -d "$CO_DIR" ]   || { echo "co.sh: career-ops not found at $CO_DIR" >&2; exit 1; }
[ -d "$DATA_DIR" ] || { echo "co.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }

script="$1"; shift
[ -f "$CO_DIR/$script" ] || { echo "co.sh: no such career-ops script: $script" >&2; exit 1; }

export CAREER_OPS_DATA_DIR="$DATA_DIR"
cd "$CO_DIR"
# ${@+"$@"} keeps macOS bash 3.2 happy under `set -u` when there are no args.
exec node "$script" ${@+"$@"}
