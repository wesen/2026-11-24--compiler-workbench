#!/bin/sh
set -eu
scripts=$(dirname "$0")
dir=$scripts/../analysis
node "$scripts/01-vm.mjs" O2 >"$dir/o2-after.txt"
node "$scripts/01-vm.mjs" speed >"$dir/vm-after.txt"
node "$scripts/02-corpus.mjs" >"$dir/corpus-after.jsonl"
node tools/parity.mjs >"$dir/parity.txt"
node tools/reference-check.mjs >"$dir/reference.txt"
