#!/bin/sh
set -eu
trap 'rm -rf corpus/projects/irwb-028-copy' EXIT
cp -R corpus/projects/blend corpus/projects/irwb-028-copy
node --test --test-name-pattern='every function of every corpus|evaluator at r0 agrees|SSA def-use|corpus lifted from the tape' tests/typed/backend.test.mjs tests/typed/ssa.test.mjs tests/typed/tape.test.mjs
