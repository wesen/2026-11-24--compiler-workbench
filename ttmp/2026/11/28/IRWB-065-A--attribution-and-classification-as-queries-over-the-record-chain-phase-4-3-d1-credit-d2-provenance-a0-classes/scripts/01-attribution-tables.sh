#!/bin/sh
# D1's tables, as IRWB-034-G's 04-attribution-tables.sh builds them: the bytecode VM under speed, both entries at
# n = 12, seed = 8, coalesce on. usage: sh 01-attribution-tables.sh before|after
# (writes ../various/attribution-<label>-{fib,checksum}.txt; the reference is the *before* output of this ticket.)
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
cd "$root"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":0,"n":12,"seed":8}' --coalesce --rows > "$here/../various/attribution-$1-fib.txt"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":34,"n":12,"seed":8}' --coalesce --rows > "$here/../various/attribution-$1-checksum.txt"
