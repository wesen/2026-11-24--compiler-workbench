#!/bin/sh
# Run from the repository root. Bound concurrency on the shared machine.
exec node --test --test-concurrency=1 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs
