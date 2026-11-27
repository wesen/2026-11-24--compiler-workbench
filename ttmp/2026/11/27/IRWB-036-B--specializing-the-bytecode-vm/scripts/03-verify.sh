#!/usr/bin/env bash
# Run from the repository root. Limit concurrent test files on the shared machine.
set -eu
npm run build
node --test --test-concurrency=2 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs
