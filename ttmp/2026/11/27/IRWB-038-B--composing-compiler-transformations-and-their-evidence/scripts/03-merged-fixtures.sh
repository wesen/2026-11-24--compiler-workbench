#!/bin/sh
# From the repository root, after npm run build. CPU fixtures only.
set -eu
node --test tests/framework/core.test.mjs tests/framework/pass-policy.test.mjs tests/framework/ir-rewriting.test.mjs tests/framework/strategy.test.mjs tests/framework/contracts.test.mjs \
  tests/tensor/passes.test.mjs tests/tensor/fusion.test.mjs tests/tensor/cuda.test.mjs \
  tests/typed/attribute.test.mjs
