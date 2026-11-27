#!/bin/bash
# Launch in a dedicated tmux server and keep its owning shell alive until the job completes.
# From the worktree root: bash <ticket>/scripts/04-verify.sh bench|contract|tests
set -eu
scripts=$(dirname "$0")
case "$1" in
  bench) cmd="node $scripts/01-benchmark.mjs 3 both"; output=01-final.jsonl ;;
  contract) cmd="node $scripts/03-contract.mjs"; output=03-contract.jsonl ;;
  tests) cmd='node --test --test-concurrency=1 tests/tensor/*.test.mjs'; output=04-tests.log ;;
  *) exit 2 ;;
esac
socket="irwb030b-$1"
status=$(mktemp)
trap 'rm -f "$status"' EXIT
tmux -L "$socket" new-session -d -c "$(pwd)" -s "$1" "$cmd > $scripts/$output 2>&1; echo \$? > '$status'; tmux -L $socket wait-for -S done"
tmux -L "$socket" wait-for done
exit "$(cat "$status")"
