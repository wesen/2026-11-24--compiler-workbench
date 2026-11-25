#!/usr/bin/env bash
# Print the heading outline (levels 1-3, with line numbers) and sizes of the two IR surveys.
# Usage: 01-survey-outline.sh [/tmp/irs.md /tmp/irs2.md]
set -euo pipefail
files=("${@:-/tmp/irs.md}")
[ $# -eq 0 ] && files=(/tmp/irs.md /tmp/irs2.md)
for f in "${files[@]}"; do
  echo "== $f  $(wc -c <"$f") bytes, $(wc -l <"$f") lines"
  grep -n '^#\{1,3\} ' "$f"
done
