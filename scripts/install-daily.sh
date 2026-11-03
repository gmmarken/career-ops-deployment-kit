#!/usr/bin/env bash
# Install the daily run as a launchd job (D53). Nothing is loaded without --load.
#   scripts/install-daily.sh [--at HH:MM]            fill in the plist, save it under private/launchd/, print it
#   scripts/install-daily.sh [--at HH:MM] --load     …then copy it to ~/Library/LaunchAgents and load it
#   scripts/install-daily.sh --unload                stop and remove the job
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"
LABEL=com.career-ops.daily
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
AT=07:00; MODE=print
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="${2:?--at needs HH:MM}"; shift 2 ;;
    --load) MODE=load; shift ;;
    --unload) MODE=unload; shift ;;
    *) echo "install-daily.sh: unknown option $1" >&2; exit 1 ;;
  esac
done

if [ "$MODE" = unload ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || echo "($LABEL was not loaded)"
  rm -f "$AGENT"; echo "Removed $AGENT"; exit 0
fi

[ -d "$DATA_DIR" ] || { echo "install-daily.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
[[ "$AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { echo "install-daily.sh: --at must be HH:MM (24-hour)" >&2; exit 1; }
HOUR=$((10#${AT%%:*})); MINUTE=$((10#${AT##*:}))
NODE="$(command -v node)" || { echo "install-daily.sh: node not found on PATH" >&2; exit 1; }
CLAUDE="$(command -v claude)" || { echo "install-daily.sh: claude not found on PATH (tier-new needs it)" >&2; exit 1; }
RUN_PATH="$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin:/usr/sbin:/sbin"
[ -f "$DATA_DIR/config/daily.json" ] || { echo "install-daily.sh: $DATA_DIR/config/daily.json is missing (see scripts/daily.mjs loadConfig)" >&2; exit 1; }

mkdir -p "$DATA_DIR/launchd" "$DATA_DIR/logs"
OUT="$DATA_DIR/launchd/$LABEL.plist"
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
sed -e "s|__DAILY_SH__|$(esc "$KIT_DIR/scripts/daily.sh")|" \
    -e "s|__PATH__|$(esc "$RUN_PATH")|" \
    -e "s|__LOG_DIR__|$(esc "$DATA_DIR/logs")|g" \
    -e "s|__HOUR__|$HOUR|" -e "s|__MINUTE__|$MINUTE|" \
    "$KIT_DIR/scripts/launchd/$LABEL.plist.template" > "$OUT"
plutil -lint "$OUT" >/dev/null
echo "Wrote $OUT:"; echo; cat "$OUT"

if [ "$MODE" = load ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true   # replacing an older copy, if any
  cp "$OUT" "$AGENT"
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  echo; echo "Loaded $LABEL: runs daily at $AT. Check with: launchctl print gui/$(id -u)/$LABEL"
else
  echo; echo "Not loaded. Re-run with --load to install it."
fi
