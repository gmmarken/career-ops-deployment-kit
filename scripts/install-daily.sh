#!/usr/bin/env bash
# Install the daily run as a launchd job (D53). Nothing is loaded without --load.
#   scripts/install-daily.sh [--at HH:MM]            fill in the plist, save it under private/launchd/, print it
#   scripts/install-daily.sh [--at HH:MM] --load     …then copy it to ~/Library/LaunchAgents and load it
#   scripts/install-daily.sh --unload                stop and remove the job (and the helper app)
#   scripts/install-daily.sh --run-now               start today's run now, exactly as launchd does at the set time
#   scripts/install-daily.sh --test-message          send one test text through the helper app (checks the Messages permission)
#   scripts/install-daily.sh --test-email            send the SAMPLE weekly email through the helper app (checks the Mail permission)
#   --midday-at HH:MM                                time of the midday run (default 13:00, D79): scan + grade roles first seen today
#   --kit-dir DIR                                    which kit checkout the run uses (default: this one)
#
# launchd starts a small helper app, not bash directly (D65): macOS blocks background bash from
# the Documents folder, but an app can be allowed once. The app is rebuilt only when its content
# changes, because macOS ties the "Allow" to that exact build.
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$KIT_DIR"
APP_NAME="CareerOps Daily"
APP="$HOME/Applications/$APP_NAME.app"
APP_LOG="$HOME/Library/Logs/career-ops-daily.log"
LABEL=com.career-ops.daily
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
MID_LABEL=com.career-ops.midday
MID_AGENT="$HOME/Library/LaunchAgents/$MID_LABEL.plist"
AT=07:00; MID_AT=13:00; MODE=print
while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="${2:?--at needs HH:MM}"; shift 2 ;;
    --midday-at) MID_AT="${2:?--midday-at needs HH:MM}"; shift 2 ;;
    --test-email) MODE=testmail; shift ;;
    --load) MODE=load; shift ;;
    --unload) MODE=unload; shift ;;
    --run-now) MODE=run; shift ;;
    --test-message) MODE=test; shift ;;
    --kit-dir) KIT_DIR="$(cd "${2:?--kit-dir needs a folder}" && pwd)"; shift 2 ;;
    *) echo "install-daily.sh: unknown option $1" >&2; exit 1 ;;
  esac
done
DATA_DIR="$(cd "$KIT_DIR/.." && pwd)/private"

if [ "$MODE" = unload ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || echo "($LABEL was not loaded)"
  rm -f "$AGENT"; echo "Removed $AGENT"
  launchctl bootout "gui/$(id -u)/$MID_LABEL" 2>/dev/null || echo "($MID_LABEL was not loaded)"
  rm -f "$MID_AGENT"; echo "Removed $MID_AGENT"
  rm -rf "$APP"; echo "Removed $APP"; exit 0
fi
if [ "$MODE" = test ]; then
  [ -d "$APP" ] || { echo "install-daily.sh: $APP not found. Run with --load first." >&2; exit 1; }
  open -g -W --env CAREER_OPS_DAILY_TEST=1 "$APP"
  echo "Test text requested. If macOS asks to let \"$APP_NAME\" control Messages, click Allow."
  echo "Result: tail -1 $APP_LOG (exit 0 = sent)"; exit 0
fi
if [ "$MODE" = testmail ]; then
  [ -d "$APP" ] || { echo "install-daily.sh: $APP not found. Run with --load first." >&2; exit 1; }
  open -g -W --env CAREER_OPS_DAILY_MODE=sample-email "$APP"
  echo "Sample weekly email requested. If macOS asks to let \"$APP_NAME\" control Mail, click Allow."
  echo "Result: tail -1 $APP_LOG (exit 0 = handed to Mail) · details: private/logs/daily-$(date +%F).log"; exit 0
fi
if [ "$MODE" = run ]; then
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || { echo "install-daily.sh: $LABEL is not loaded. Run with --load first." >&2; exit 1; }
  launchctl kickstart "gui/$(id -u)/$LABEL"
  echo "Started today's run. You'll get the morning text when it finishes (often 10–60 min)."
  echo "Progress: private/logs/daily-$(date +%F).log · helper log: $APP_LOG"; exit 0
fi

[ -d "$DATA_DIR" ] || { echo "install-daily.sh: private data dir not found at $DATA_DIR" >&2; exit 1; }
[[ "$AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { echo "install-daily.sh: --at must be HH:MM (24-hour)" >&2; exit 1; }
[[ "$MID_AT" =~ ^([01][0-9]|2[0-3]):([0-5][0-9])$ ]] || { echo "install-daily.sh: --midday-at must be HH:MM (24-hour)" >&2; exit 1; }
HOUR=$((10#${AT%%:*})); MINUTE=$((10#${AT##*:}))
MID_HOUR=$((10#${MID_AT%%:*})); MID_MINUTE=$((10#${MID_AT##*:}))
NODE="$(command -v node)" || { echo "install-daily.sh: node not found on PATH" >&2; exit 1; }
CLAUDE="$(command -v claude)" || { echo "install-daily.sh: claude not found on PATH (tier-new needs it)" >&2; exit 1; }
RUN_PATH="$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/bin:/bin:/usr/sbin:/sbin"
[ -f "$DATA_DIR/config/daily.json" ] || { echo "install-daily.sh: $DATA_DIR/config/daily.json is missing (see scripts/daily.mjs loadConfig)" >&2; exit 1; }
[ -x "$KIT_DIR/scripts/daily.sh" ] || { echo "install-daily.sh: $KIT_DIR/scripts/daily.sh not found or not runnable" >&2; exit 1; }
# The handle goes only into the app (outside the repo), never printed.
TEXT_TO="$("$NODE" -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!c.imessage_to){process.stderr.write("imessage_to is missing\n");process.exit(1)} process.stdout.write(String(c.imessage_to))' "$DATA_DIR/config/daily.json")" \
  || { echo "install-daily.sh: could not read imessage_to from $DATA_DIR/config/daily.json" >&2; exit 1; }

mkdir -p "$DATA_DIR/launchd" "$DATA_DIR/logs"
OUT="$DATA_DIR/launchd/$LABEL.plist"
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }
ases() { esc "$(printf '%s' "$1" | sed -e 's/[\\"]/\\&/g')"; }   # also escaped for an AppleScript string

# 1. The helper app.
APP_SRC="$DATA_DIR/launchd/CareerOpsDaily.applescript"
sed -e "s|__DAILY_SH__|$(ases "$KIT_DIR/scripts/daily.sh")|" \
    -e "s|__PATH__|$(ases "$RUN_PATH")|" \
    -e "s|__IMESSAGE_TO__|$(ases "$TEXT_TO")|" \
    -e "s|__APP_LOG__|$(ases "$APP_LOG")|" \
    "$SRC_DIR/scripts/launchd/CareerOpsDaily.applescript.template" > "$APP_SRC.new"
if [ -d "$APP" ] && [ -f "$APP_SRC" ] && cmp -s "$APP_SRC" "$APP_SRC.new"; then
  rm "$APP_SRC.new"; echo "Helper app unchanged: $APP"
else
  mv "$APP_SRC.new" "$APP_SRC"
  mkdir -p "$HOME/Applications" "$(dirname "$APP_LOG")"
  rm -rf "$APP"
  osacompile -o "$APP" "$APP_SRC"
  # No Dock icon or window: it runs in the background.
  plutil -replace LSUIElement -bool true "$APP/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string "$LABEL" "$APP/Contents/Info.plist"
  codesign --force --sign - "$APP"
  echo "Built helper app: $APP"
  echo "  First run: macOS will ask to let \"$APP_NAME\" use your Documents folder and control Messages. Click Allow for both."
fi

# 2. The launchd job, which starts the app.
sed -e "s|__APP_BIN__|$(esc "$APP/Contents/MacOS/applet")|" \
    -e "s|__LOG_DIR__|$(esc "$DATA_DIR/logs")|g" \
    -e "s|__HOUR__|$HOUR|" -e "s|__MINUTE__|$MINUTE|" \
    "$SRC_DIR/scripts/launchd/$LABEL.plist.template" > "$OUT"
plutil -lint "$OUT" >/dev/null
echo "Wrote $OUT:"; echo; cat "$OUT"
MID_OUT="$DATA_DIR/launchd/$MID_LABEL.plist"
sed -e "s|__APP_BIN__|$(esc "$APP/Contents/MacOS/applet")|" \
    -e "s|__LOG_DIR__|$(esc "$DATA_DIR/logs")|g" \
    -e "s|__HOUR__|$MID_HOUR|" -e "s|__MINUTE__|$MID_MINUTE|" \
    "$SRC_DIR/scripts/launchd/$MID_LABEL.plist.template" > "$MID_OUT"
plutil -lint "$MID_OUT" >/dev/null
echo; echo "Wrote $MID_OUT (midday run at $MID_AT)"

if [ "$MODE" = load ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true   # replacing an older copy, if any
  cp "$OUT" "$AGENT"
  launchctl bootstrap "gui/$(id -u)" "$AGENT"
  launchctl bootout "gui/$(id -u)/$MID_LABEL" 2>/dev/null || true
  cp "$MID_OUT" "$MID_AGENT"
  launchctl bootstrap "gui/$(id -u)" "$MID_AGENT"
  echo; echo "Loaded $LABEL: runs daily at $AT. Check with: launchctl print gui/$(id -u)/$LABEL"
  echo "Loaded $MID_LABEL: midday run at $MID_AT (scan + grade today's new roles; texts only for a new S role or a failure)"
else
  echo; echo "Not loaded. Re-run with --load to install it."
fi
