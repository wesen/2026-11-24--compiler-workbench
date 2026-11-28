#!/usr/bin/env bash
# Run from the worktree root. Keep concurrency modest on the shared host.
set -u
result=0
for suite in typed framework workbench stdlib tensor; do
  files=()
  for file in tests/"$suite"/*.test.mjs; do
    [[ $file == *-gpu.test.mjs ]] || files+=("$file")
  done
  node --test --test-concurrency=2 "${files[@]}" > "/tmp/irwb051b-$suite.log" 2>&1 || result=1
  echo "$suite"
  tail -9 "/tmp/irwb051b-$suite.log"
done
exit "$result"
