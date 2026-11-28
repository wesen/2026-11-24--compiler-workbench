#!/bin/sh
# The attribution tables of IRWB-034-G, re-run as the acceptance check of IRWB-065-B: the bytecode VM under `speed`,
# both entries at n = 12, seed = 8, coalesce on, one row per changed group (`--rows`).
# usage: sh 01-d1-tables.sh <label>   (writes various/d1-<label>-{fib,checksum}.txt)
# This is ttmp/2026/11/27/IRWB-034-G--*/scripts/04-attribution-tables.sh with the output directory moved into this
# ticket: the coordinator's rule is that we do not write into another ticket's workspace.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
cd "$root"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":0,"n":12,"seed":8}' --coalesce --rows > "$here/../various/d1-$1-fib.txt"
node tools/attribute.mjs bytecode-vm speed runVm --input '{"entry":34,"n":12,"seed":8}' --coalesce --rows > "$here/../various/d1-$1-checksum.txt"
