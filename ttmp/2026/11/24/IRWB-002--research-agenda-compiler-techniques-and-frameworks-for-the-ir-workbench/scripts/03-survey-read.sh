#!/usr/bin/env bash
# Print a line range of a survey for reading in chunks, with link targets, inline SVG figures,
# horizontal rules and repeated blank lines removed (URLs and SVG markup carry no content for the agenda).
# Usage: 03-survey-read.sh FILE FROM TO
set -euo pipefail
sed -n "${2},${3}p" "$1" \
  | awk '/^```svg/{skip=1} !skip{print} skip&&/^```$/{skip=0; print "[figure]"}' \
  | sed -E 's/\[([^]]*)\]\(https?:[^)]*\)/[\1]/g; s/\\([.:>#*_-])/\1/g' \
  | grep -v '^---$' | cat -s
