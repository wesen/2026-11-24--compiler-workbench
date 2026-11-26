#!/bin/sh
set -eu
p=$(dirname "$0")
for range in '00000000 33000000 low' '33000000 42d00000 active' '42d00000 7f800001 high'; do
  set -- $range
  node "$p/04-run.mjs" audit "$1" "$2" > "$p/06-$3-gpu.json"
  node "$p/06-node-audit.mjs" "$1" "$2" "$p/06-$3-gpu.json" > "$p/06-$3-node.json"
  cat "$p/06-$3-node.json"
done
