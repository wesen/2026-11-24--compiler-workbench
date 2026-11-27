#!/bin/sh
set -eu
node --test --test-isolation=none tests/typed/regex-nfa.test.mjs
node tools/attribute.mjs regex-nfa speed regexMatch --input '{"text":{"string":"abccabbd"}}' --rows
