#!/usr/bin/env bash
# Extract the v6 archive into a fresh directory and re-run its own checks:
# strict typecheck (shipped TypeScript), the full node:test suite against the
# shipped dist/, and a rebuild + re-test to confirm dist/ is reproducible.
#
# Usage: 02-run-verification.sh /path/to/ir-source-workbench-v6-complete.zip /path/to/empty-workdir
set -uo pipefail
ZIP="$1"
WORK="$2"
mkdir -p "$WORK"
if [ -n "$(ls -A "$WORK" 2>/dev/null)" ]; then echo "workdir not empty: $WORK" >&2; exit 2; fi
unzip -q "$ZIP" -d "$WORK"
cd "$WORK/ir-source-workbench" || exit 2
echo "== node $(node --version)"
echo "== typecheck (tsc --noEmit)"
node node_modules/typescript/bin/tsc --noEmit; echo "tsc exit=$?"
echo "== test suite against shipped dist/"
node --test tests/*.test.mjs > "$WORK/tests-shipped.tap" 2>&1; echo "tests exit=$?"
tail -12 "$WORK/tests-shipped.tap"
echo "== rebuild (npm run build:source)"
node scripts/build.mjs > "$WORK/build.log" 2>&1 && node scripts/build-source.mjs >> "$WORK/build.log" 2>&1; echo "build exit=$?"
tail -3 "$WORK/build.log"
echo "== test suite against rebuilt dist/"
node --test tests/*.test.mjs > "$WORK/tests-rebuilt.tap" 2>&1; echo "tests exit=$?"
tail -12 "$WORK/tests-rebuilt.tap"
