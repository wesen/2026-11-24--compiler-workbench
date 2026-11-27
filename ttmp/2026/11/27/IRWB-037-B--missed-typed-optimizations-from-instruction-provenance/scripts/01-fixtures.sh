#!/bin/sh
set -eu
node --test --test-isolation=none tests/typed/regex-nfa.test.mjs tests/typed/lz-roundtrip.test.mjs
node corpus/projects/chess-search/scripts/fixtures.mjs measure
