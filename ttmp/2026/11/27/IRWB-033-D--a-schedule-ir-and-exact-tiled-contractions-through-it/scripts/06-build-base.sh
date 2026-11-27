#!/bin/sh
# IRWB-033-D script 06: build the base commit (0f45d04, this branch's start) into a scratch directory, for the
# `base` side of 03-bench.mjs (--base <dir>). Run from the worktree root. Then:
#   node <ticket>/scripts/03-bench.mjs --base "$B" corpus > 06-final-corpus.out.jsonl
B=${1:-/tmp/claude-1000/irwb033-base}
rm -rf "$B" && mkdir -p "$B"
git archive 0f45d04 src tools tsconfig.json package.json corpus | tar -x -C "$B"
ln -s "$(git rev-parse --show-toplevel)/../../../node_modules" "$B/node_modules" 2>/dev/null || true
(cd "$B" && node node_modules/typescript/bin/tsc -p tsconfig.json)
