#!/bin/sh
# D2's benchmark outputs, as IRWB-037-G's 06-missed-benchmarks.sh builds them (the three programs the tool was run
# on for its report). usage: sh 02-missed-benchmarks.sh before|after   (writes ../various/06-missed-*-<label>.txt)
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
out="$here/../various"
cd "$root"
node tools/missed.mjs regex-nfa speed regexMatch --input '{"pattern":{"string":"[a-c]*[b-d]*a*d"},"text":{"string":"abccabbd"}}' --top 40 > "$out/06-missed-regex-$1.txt"
node tools/missed.mjs lz-roundtrip speed roundTrip --cases 100 --top 40 > "$out/06-missed-lz-$1.txt"
node tools/missed.mjs chess-search speed chessPerft --input '{"depth":1}' --top 40 > "$out/06-missed-chess-perft-$1.txt"
