#!/usr/bin/env bash
# Set up the kit next to a pinned career-ops and a private data folder (D128).
#
#   ./install.sh
#
# Layout it creates (all side by side, in the folder that holds this kit):
#   career-ops/                  upstream, cloned at the pinned tag; never edited
#   career-ops-deployment-kit/   this repo
#   private/                     your CV, rules, keys and data; never committed
#
# Safe to re-run: it never overwrites a file in private/ and never loads a schedule.
# When it's done, open Claude Code in this folder and run /onboard to fill in private/.
set -euo pipefail

CAREER_OPS_REPO="https://github.com/santifer/career-ops.git"
# The exact career-ops commit the kit is built and tested on (its VERSION file says 1.38.0; it is
# 270 commits after the career-ops-v1.38.0 tag). Change it only together with a full test run.
CAREER_OPS_COMMIT="a068b716f9f351d3656a015e591ff969f39bc236"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "$KIT_DIR/.." && pwd)"
CO_DIR="$WORKSPACE/career-ops"
DATA_DIR="$WORKSPACE/private"

fail() { echo "install.sh: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

step "Tools"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "  ⚠ This isn't macOS. Setup continues, but the daily run (Messages, Mail, Reminders, launchd) only works on a Mac."
fi
command -v git >/dev/null 2>&1 || fail "git not found. Install it (macOS: xcode-select --install)."
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node 22.13 or newer (https://nodejs.org)."
command -v npm >/dev/null 2>&1 || fail "npm not found. It comes with Node.js."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || fail "Node $(node -v) is too old. The kit needs 22.13 or newer (it uses the built-in SQLite)."
echo "  ✓ git, node $(node -v), npm"
if command -v claude >/dev/null 2>&1; then echo "  ✓ claude"; else
  echo "  ⚠ The Claude Code CLI (claude) isn't on PATH. Grading and prep packs need it: https://claude.com/claude-code"
fi
if command -v gitleaks >/dev/null 2>&1; then echo "  ✓ gitleaks"; else
  echo "  ⚠ gitleaks isn't installed, so the secret-scan hook will block commits until it is (brew install gitleaks)."
fi

step "career-ops (pinned commit ${CAREER_OPS_COMMIT:0:7})"
if [ ! -d "$CO_DIR" ]; then
  mkdir -p "$CO_DIR"
  git -C "$CO_DIR" init --quiet
  git -C "$CO_DIR" remote add origin "$CAREER_OPS_REPO"
  git -C "$CO_DIR" fetch --quiet --depth 1 origin "$CAREER_OPS_COMMIT" \
    || fail "could not download career-ops commit $CAREER_OPS_COMMIT from $CAREER_OPS_REPO."
  git -C "$CO_DIR" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
  echo "  ✓ downloaded into $CO_DIR"
fi
have="$(git -C "$CO_DIR" rev-parse HEAD 2>/dev/null)" || fail "$CO_DIR exists but isn't a git checkout. Move it aside and re-run."
[ "$have" = "$CAREER_OPS_COMMIT" ] \
  || fail "$CO_DIR is at commit ${have:0:7}, but the kit is pinned to ${CAREER_OPS_COMMIT:0:7}. Move it aside and re-run, or check out $CAREER_OPS_COMMIT there."
echo "  ✓ at the pinned commit"
if [ ! -d "$CO_DIR/node_modules" ]; then
  # career-ops ships no lockfile, so this is npm install (its own version ranges), not npm ci.
  (cd "$CO_DIR" && npm install --silent --no-audit --no-fund) || fail "npm install failed in $CO_DIR."
  echo "  ✓ installed its packages"
fi
# Prep packs render the CV to PDF with career-ops' generate-pdf.mjs, which uses Playwright's Chromium.
(cd "$CO_DIR" && npx --no-install playwright install chromium >/dev/null) \
  || fail "could not install Chromium for PDF rendering (cd $CO_DIR && npx playwright install chromium)."
echo "  ✓ Chromium for PDFs"

step "Private folder: $DATA_DIR"
mkdir -p "$DATA_DIR/modes" "$DATA_DIR/config" "$DATA_DIR/evals" "$DATA_DIR/data" "$DATA_DIR/logs" "$DATA_DIR/output"
chmod 700 "$DATA_DIR"
# template (in the kit or career-ops) -> file in private/
seed() {
  local src="$1" dest="$DATA_DIR/$2"
  [ -f "$src" ] || fail "template missing: $src"
  if [ -e "$dest" ]; then echo "  · kept $2 (already there)"; else cp "$src" "$dest"; echo "  ✓ created $2"; fi
}
seed "$KIT_DIR/.env.example"                     .env
chmod 600 "$DATA_DIR/.env"
seed "$KIT_DIR/packs/cv.example.md"              cv.md
seed "$KIT_DIR/rules/_profile.template.md"       modes/_profile.md
seed "$KIT_DIR/rules/_custom.template.md"        modes/_custom.md
seed "$KIT_DIR/engine/tier-rules.example.json"   config/tier-rules.json
seed "$KIT_DIR/market/sources.example.json"      config/sources.json
seed "$KIT_DIR/scripts/daily.example.json"       config/daily.json
seed "$KIT_DIR/packs/cv-rules.example.json"      config/cv-rules.json
seed "$KIT_DIR/packs/tailoring-rules.example.md" config/tailoring-rules.md
seed "$KIT_DIR/packs/keyword-bank.example.md"    config/keyword-bank.md
seed "$KIT_DIR/packs/cv-facts.example.json"      config/cv-facts.json
seed "$CO_DIR/config/profile.example.yml"        config/profile.yml
seed "$KIT_DIR/evals/cases.example.json"         evals/cases.json

step "Secret-scan hook"
if git -C "$KIT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  (cd "$KIT_DIR" && scripts/setup-hooks.sh) | sed 's/^/  ✓ /'
else
  echo "  · the kit isn't a git checkout; no hook to install"
fi

step "Setup check"
# Expected to list problems on a fresh install: the private files still hold the example values.
if node "$KIT_DIR/scripts/check-setup.mjs" --data-dir "$DATA_DIR"; then :; else
  echo
  echo "Next: open Claude Code in $KIT_DIR and run /onboard. It walks you through each item above."
  echo "Then re-run: node scripts/check-setup.mjs (from the kit folder)"
fi
