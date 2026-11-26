#!/usr/bin/env bash
# Record (or re-record) the frozen outputs of the default contract: npm test, the full typed suites, corpus parity
# and the per-project revision fingerprints (IRWB-001 script 08). Run from the repository root:
#   bash ttmp/2026/11/25/IRWB-005--*/scripts/01-freeze-baseline.sh <outdir>
# Compare two runs with 02-freeze-diff.sh.
set -u
out=${1:?usage: 01-freeze-baseline.sh <outdir>}
mkdir -p "$out"
git rev-parse HEAD > "$out/COMMIT"
npm run build > "$out/build.txt" 2>&1
( time npm run test:only ) > "$out/npm-test.txt" 2>&1
( time IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs ) > "$out/irwb-full.txt" 2>&1
( time node tools/parity.mjs ) > "$out/parity.txt" 2>&1
( time node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs ) > "$out/corpus-revisions.txt" 2>&1
echo done > "$out/DONE"
