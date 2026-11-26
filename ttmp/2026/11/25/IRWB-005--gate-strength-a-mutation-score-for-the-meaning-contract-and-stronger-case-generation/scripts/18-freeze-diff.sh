#!/usr/bin/env bash
# Compare two runs of 01-freeze-baseline.sh (the comparison 01's header calls 02-freeze-diff.sh; 02 became the site
# census, so it lives here). Timing lines and per-test durations are ignored; everything else must be identical,
# except tests added since the baseline, which are listed.
#   bash ttmp/2026/11/25/IRWB-005--*/scripts/18-freeze-diff.sh <baseline-dir> <final-dir>
set -u
a=${1:?usage: 18-freeze-diff.sh <baseline-dir> <final-dir>}
b=${2:?usage: 18-freeze-diff.sh <baseline-dir> <final-dir>}
names() { grep -E '^ *(✔|✖|﹣)' "$1" | sed -E 's/ \([0-9.]+m?s\)//' | sort; }
untimed() { grep -vE '^(real|user|sys)[[:space:]]' "$1"; }
echo "baseline $(cat "$a/COMMIT")"
echo "final    $(cat "$b/COMMIT")"
for f in npm-test irwb-full; do
  echo "== $f: summary"
  grep -E '^ℹ (tests|pass|fail|skipped)' "$a/$f.txt" | tr '\n' ' '; echo
  grep -E '^ℹ (tests|pass|fail|skipped)' "$b/$f.txt" | tr '\n' ' '; echo
  echo "== $f: tests removed (<) or added (>)"
  diff <(names "$a/$f.txt") <(names "$b/$f.txt") && echo "(identical test names and results)"
done
for f in parity corpus-revisions; do
  echo "== $f"
  diff <(untimed "$a/$f.txt") <(untimed "$b/$f.txt") && echo "(identical)"
done
