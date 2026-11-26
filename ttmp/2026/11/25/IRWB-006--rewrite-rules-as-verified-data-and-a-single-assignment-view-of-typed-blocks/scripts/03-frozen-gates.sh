#!/usr/bin/env bash
# The frozen gates of IRWB-006, in order, from the repository root:
#   npm test (the same test files, with --test-concurrency to share the machine), the full corpus passes and
#   backend tests, the parity tool, and the corpus revisions diffed against the baseline recorded at 420d8e1.
#   bash scripts/03-frozen-gates.sh <out-dir>
set -u
cd "$(dirname "$0")/../../../../../.."
OUT=${1:-/tmp}
T=ttmp/2026/11/25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks
status=0
step() { echo "== $1"; }
step "build"; npm run build > "$OUT/gate-build.log" 2>&1 || { echo FAIL build; status=1; }
step "npm test (node --test --test-concurrency=3 tests/**/*.test.mjs)"
node --test --test-concurrency=3 "tests/**/*.test.mjs" > "$OUT/gate-npm-test.log" 2>&1 || { echo FAIL npm-test; status=1; }
grep -E "^ℹ (tests|pass|fail|cancelled|skipped|duration_ms)" "$OUT/gate-npm-test.log"
step "IRWB_FULL=1 passes + backend"
IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs > "$OUT/gate-full.log" 2>&1 || { echo FAIL full; status=1; }
grep -E "^ℹ (tests|pass|fail|skipped|duration_ms)" "$OUT/gate-full.log"
step "parity"
node tools/parity.mjs > "$OUT/gate-parity.log" 2>&1 || { echo FAIL parity; status=1; }
tail -5 "$OUT/gate-parity.log"
step "corpus revisions vs baseline"
node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > "$OUT/gate-revisions.txt" 2>&1
if diff "$T/various/01-baseline-corpus-revisions.txt" "$OUT/gate-revisions.txt" > /dev/null; then echo "IDENTICAL (44 lines)"; else echo "FAIL revisions differ"; status=1; fi
echo "status $status"
exit $status
