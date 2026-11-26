#!/usr/bin/env bash
# The frozen gates of 03-frozen-gates.sh except the test files (which include the rules test and so need the
# recorded evidence): the full corpus passes and backend tests, the parity tool, and the corpus revisions diffed
# against the baseline. Used to run those gates while the evidence was still being computed; the test files were
# run afterwards. None of these imports src/typed/rules/evidence.ts.
#   bash scripts/10-frozen-gates-part.sh <out-dir>
set -u
cd "$(dirname "$0")/../../../../../.."
OUT=${1:-/tmp}
mkdir -p "$OUT"
T=ttmp/2026/11/25/IRWB-006--rewrite-rules-as-verified-data-and-a-single-assignment-view-of-typed-blocks
status=0
echo "== source $(git rev-parse --short HEAD) + working tree"
echo "== IRWB_FULL=1 passes + backend"
IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs > "$OUT/gate-full.log" 2>&1 || { echo FAIL full; status=1; }
grep -E "^ℹ (tests|pass|fail|skipped|duration_ms)" "$OUT/gate-full.log"
echo "== parity"
node tools/parity.mjs > "$OUT/gate-parity.log" 2>&1 || { echo FAIL parity; status=1; }
tail -5 "$OUT/gate-parity.log"
echo "== corpus revisions vs baseline"
node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs > "$OUT/gate-revisions.txt" 2>&1
if diff "$T/various/01-baseline-corpus-revisions.txt" "$OUT/gate-revisions.txt" > /dev/null; then echo "IDENTICAL ($(wc -l < "$OUT/gate-revisions.txt") lines)"; else echo "FAIL revisions differ"; status=1; fi
echo "status $status"
exit $status
