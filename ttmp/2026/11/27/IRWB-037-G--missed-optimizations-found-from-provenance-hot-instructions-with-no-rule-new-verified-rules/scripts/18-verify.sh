#!/bin/sh
# The corpus-wide checks of the final compiler, into various/18-*.log: parity (every project's own pipeline with
# checks after each pass, then 100 cases against r0), the reference images and our O2 images against the
# evaluator, and `speed` on every corpus project against r0 under each backend option (IRWB_FULL).
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../../../../../.." && pwd); out="$here/../various"
cd "$root"
node tools/parity.mjs > "$out/18-parity.log" 2>&1
node tools/reference-check.mjs > "$out/18-reference-check.log" 2>&1
node tools/reference-check.mjs --o2 > "$out/18-reference-check-o2.log" 2>&1
IRWB_FULL=1 node --test tests/typed/speed.test.mjs > "$out/18-speed-full.log" 2>&1
tail -1 "$out/18-parity.log" "$out/18-reference-check.log" "$out/18-reference-check-o2.log"; grep -E "^ℹ (tests|pass|fail)" "$out/18-speed-full.log"
