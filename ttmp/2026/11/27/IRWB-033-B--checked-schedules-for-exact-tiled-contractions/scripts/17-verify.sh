#!/bin/sh
# Run from repository root after npm run build. Each suite reports its own pass count.
set -eu
out=$(dirname "$0")
case "$1" in
  cpu)
    node --test --test-concurrency=1 tests/framework/native-pass-sync.test.mjs tests/framework/layering.test.mjs tests/framework/pass-policy.test.mjs tests/framework/ext-e3-e6.test.mjs \
      tests/tensor/corpus.test.mjs tests/tensor/language.test.mjs tests/tensor/passes.test.mjs \
      tests/tensor/cuda.test.mjs tests/tensor/fusion.test.mjs tests/tensor/schedule.test.mjs >"$out/17-cpu.log" 2>&1 ;;
  gpu)
    node --test --test-concurrency=1 tests/tensor/cuda-gpu.test.mjs tests/tensor/fusion-gpu.test.mjs \
      tests/tensor/gate-choice-gpu.test.mjs tests/tensor/terms-gpu.test.mjs tests/tensor/schedule-gpu.test.mjs >"$out/17-gpu.log" 2>&1 ;;
esac
