#!/bin/sh
set -eu
ticket=ttmp/2026/11/27/IRWB-037-B--missed-typed-optimizations-from-instruction-provenance
node --test --test-concurrency=2 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs > "$ticket/various/tests.txt" 2>&1
