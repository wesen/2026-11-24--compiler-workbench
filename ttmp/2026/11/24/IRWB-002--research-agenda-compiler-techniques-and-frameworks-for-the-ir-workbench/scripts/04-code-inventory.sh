#!/usr/bin/env bash
# Counts cited in the intern guide, taken from the source tree (read-only; run from the repository root).
# Usage: bash 04-code-inventory.sh
set -euo pipefail
lines() { find "$1" -name "$2" -type f -print0 | xargs -0 cat | wc -l; }
echo "framework ts lines:       $(lines src/framework '*.ts')"
echo "typed ts lines:           $(lines src/typed '*.ts')"
echo "  of which backend:       $(lines src/typed/backend '*.ts')"
echo "workbench ts lines:       $(lines src/workbench '*.ts')"
echo "site-src js lines:        $(lines site-src '*.js')"
echo "test files:               $(find tests -name '*.test.mjs' | wc -l)"
echo "test cases (test( calls): $(grep -rhoE "^\s*(test|it)\(" tests | wc -l)"
echo "corpus projects:          $(find corpus/projects -mindepth 1 -maxdepth 1 -type d | wc -l)"
echo "corpus scripts:           $(find corpus/projects -path '*/scripts/*.js' | wc -l)"
echo "project strategies:       $(find corpus/projects -path '*/strategies/*.json' | wc -l)"
echo "book chapters:            $(ls corpus/book/*.md | wc -l)"
echo "passes (PASSES keys):     $(sed -n '/^export const PASSES/,/^});/p' src/typed/passes.ts | grep -cE "^  ['a-z]")"
echo "pipelines:                $(sed -n '/^export const PIPELINES/,/^});/p' src/typed/passes.ts | grep -cE "^  '?[A-Za-z0-9+]+'?: ")"
echo "analyses (ANALYSES):      $(sed -n '/^export const ANALYSES/,/^}/p' src/typed/analyses.ts | grep -cE '^  [a-z]+')"
echo "value operators:          $(sed -n '/^export type ValueOp/,/;$/p' src/typed/model.ts | grep -c '|')"
echo "stmt operators:           $(grep -E '^export type StmtOp' src/typed/model.ts | grep -o "'" | wc -l | awk '{print $1/2}')"
echo "strategy node kinds:      $(sed -n '/^export type StrategyNode =/,/;$/p' src/framework/strategy/ir.ts | grep -c '|')"
echo "candela functions (src):  $(cat corpus/candela-gallery/*.typed | grep -cE '^\s*(export )?function ')"
echo "candela s<k>_ sections:   $(cat corpus/candela-gallery/*.typed | grep -cE '^\s*(export )?function s[0-9]+_')"
echo "candela source lines:     $(cat corpus/candela-gallery/*.typed | wc -l)"
echo "simplify return sites:    $(sed -n '/^export const simplify/,/^});/p' src/typed/passes.ts | grep -c 'return ')"
echo "select.ts emit sites:     $(grep -c "emit('" src/typed/backend/select.ts)"
echo "backend options:          $(sed -n '/^export interface BackendOptions/,/^}/p' src/typed/backend/options.ts | grep -cE '^  readonly ')"
