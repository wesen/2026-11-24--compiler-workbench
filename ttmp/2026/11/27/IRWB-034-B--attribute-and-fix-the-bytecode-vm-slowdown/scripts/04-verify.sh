#!/bin/sh
# From the worktree root, after npm run build.
set -eu
dir=$(dirname "$0")/../analysis
node --test --test-concurrency=2 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs >"$dir/tests.txt" 2>&1
