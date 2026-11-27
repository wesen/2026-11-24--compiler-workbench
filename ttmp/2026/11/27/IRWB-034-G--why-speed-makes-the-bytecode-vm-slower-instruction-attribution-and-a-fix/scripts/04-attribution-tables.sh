#!/bin/sh
# The attribution tables of the report: the bytecode VM under speed, both entries at n = 12, seed = 8, coalesce on.
# usage: sh 04-attribution-tables.sh <label>   (writes various/attribution-<label>-{fib,checksum}.txt)
# "before" was produced with src/typed/analyses.ts of commit 85889a1 (one loop per back edge) and the tool of this
# ticket; "after" with the per-header loops.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
cd "$root"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":0,"n":12,"seed":8}' --coalesce --rows > "$here/../various/attribution-$1-fib.txt"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":34,"n":12,"seed":8}' --coalesce --rows > "$here/../various/attribution-$1-checksum.txt"
