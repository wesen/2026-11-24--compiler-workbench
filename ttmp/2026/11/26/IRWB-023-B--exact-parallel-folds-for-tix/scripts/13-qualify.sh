#!/bin/sh
set -eu
p=$(dirname "$0")
for range in '00000000 33000000 low' '33000000 42d00000 active' '42d00000 7f800001 high'; do
  set -- $range
  node "$p/10-run.mjs" attention-audit quadratic "$1" "$2" > "$p/13-$3-gpu.json"
  node "$p/06-node-audit.mjs" "$1" "$2" "$p/13-$3-gpu.json" > "$p/13-$3-node.json"
done
node "$p/13-node-attention.mjs" "$p/13-full.json" > "$p/13-full-node.json"
