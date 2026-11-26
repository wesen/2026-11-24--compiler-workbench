#!/bin/sh
set -eu
p=$(dirname "$0")
for range in '00000000 33000000 low' '33000000 42d00000 active' '42d00000 7f800001 high'; do
  set -- $range
  node "$p/10-run.mjs" deploy-audit quadratic "$1" "$2" > "$p/11-$3-gpu.json"
  node "$p/06-node-audit.mjs" "$1" "$2" "$p/11-$3-gpu.json" > "$p/11-$3-node.json"
done
for shape in full wide tail; do
  node "$p/11-node-program.mjs" "$p/11-$shape.json" > "$p/11-$shape-node.jsonl"
done
