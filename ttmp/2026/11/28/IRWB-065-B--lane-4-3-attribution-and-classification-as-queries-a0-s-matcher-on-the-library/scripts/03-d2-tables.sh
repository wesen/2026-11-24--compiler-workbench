#!/bin/sh
# D2's hot-shape tables on the three programs IRWB-037-G ran them on (its scripts/06-missed-benchmarks.sh), as the
# acceptance check of IRWB-065-B: the output must be identical before and after the provenance query replaces the
# walk over `origin.via`.
# usage: sh 03-d2-tables.sh <label>   (writes various/d2-<label>-{regex,lz,chess}.txt)
set -e
label=${1:?label}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
out="$here/../various"
cd "$root"
node tools/missed.mjs regex-nfa speed regexMatch --input '{"pattern":{"string":"[a-c]*[b-d]*a*d"},"text":{"string":"abccabbd"}}' --top 40 > "$out/d2-$label-regex.txt"
node tools/missed.mjs lz-roundtrip speed roundTrip --cases 100 --top 40 > "$out/d2-$label-lz.txt"
node tools/missed.mjs chess-search speed chessPerft --input '{"depth":1}' --top 40 > "$out/d2-$label-chess.txt"
