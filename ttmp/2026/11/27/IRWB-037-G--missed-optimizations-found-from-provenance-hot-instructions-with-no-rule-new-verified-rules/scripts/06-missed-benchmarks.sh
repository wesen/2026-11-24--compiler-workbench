#!/bin/sh
# The hot-shape tables of the three benchmarks (tools/missed.mjs), into various/06-missed-<name>-<label>.txt.
# usage: sh 06-missed-benchmarks.sh before|after [extra tool flags, e.g. --tuned]
set -e
label=${1:?label}; shift
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../../../../../.." && pwd); out="$here/../various"
cd "$root"
node tools/missed.mjs regex-nfa speed regexMatch --input '{"pattern":{"string":"[a-c]*[b-d]*a*d"},"text":{"string":"abccabbd"}}' --top 40 "$@" > "$out/06-missed-regex-$label.txt"
node tools/missed.mjs lz-roundtrip speed roundTrip --cases 100 --top 40 "$@" > "$out/06-missed-lz-$label.txt"
node tools/missed.mjs chess-search speed chessPerft --input '{"depth":1}' --top 40 "$@" > "$out/06-missed-chess-perft-$label.txt"
