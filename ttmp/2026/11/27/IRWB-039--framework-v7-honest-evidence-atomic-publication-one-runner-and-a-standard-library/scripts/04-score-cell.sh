#!/usr/bin/env bash
# IRWB-039: score one matrix cell on its last commit, by the brief's acceptance, without trusting its final message.
# Usage: 04-score-cell.sh <worktree> <test-name-regex>   (prints one JSON line; run cells one at a time)
#   - build and tsc; format:check (the files flagged beyond main's nine pre-existing ones)
#   - the step's test: present without `todo`, and passing; any other change to the three defect-test files
#   - the baselines: differences against main's baselines (ROOT=<worktree>)
#   - the suites: typed, framework, workbench, tensor without *-gpu (pass/fail/todo)
#   - scope: lines added per area against v7-p1-base; uncommitted files
set -u
W=$(realpath "$1"); RE=$2
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library
cd "$W" || exit 1
build=ok; npm run -s build >/tmp/score-build.$$ 2>&1 || build="fail: $(tail -c 300 /tmp/score-build.$$ | tr '\n"' ' ')"
tsc=ok; npm run -s check >/dev/null 2>&1 || tsc=fail
fmt=$(npx prettier --list-different "src/**/*.ts" 2>/dev/null | grep -v -x -E 'src/framework/contracts/differential.ts|src/framework/core/data.ts|src/framework/ir/correspondence.ts|src/framework/ir/store.ts|src/typed/candela-render.ts|src/typed/evaluate.ts|src/typed/ir.ts|src/typed/model.ts|src/typed/program.ts' | tr '\n' ' ')
files=(tests/framework/r3-defects.test.mjs tests/tensor/r3-tix-in-plans.test.mjs tests/typed/d2-defects.test.mjs)
todo_left=$(grep -n -E "todo: '" "${files[@]}" | grep -c -E "$(echo "$RE" | sed 's/|/|/g')" )
# assertion lines removed from the defect tests (weakening), other than the todo option itself
removed=$(git diff v7-p1-base HEAD -- "${files[@]}" | grep -E '^-[^-]' | grep -v -E "todo" | grep -c -E 'assert')
target=$(node --test --test-name-pattern="$RE" "${files[@]}" 2>&1 | grep -E '^ℹ (pass|fail|todo)' | tr '\n' ' ')
base=$(ROOT="$W" timeout 1800 node $T/scripts/02-baselines.mjs check $T/various/baselines/main.json 2>&1 | grep -v '^timing' )
ndiff=$(echo "$base" | grep -c -v '^no differences')
suites=""
for d in typed framework workbench tensor stdlib; do
  [ -d tests/$d ] || continue
  fs=$(ls tests/$d/*.test.mjs | grep -v -- '-gpu.test.mjs')
  r=$(node --test $fs 2>&1 | grep -E '^ℹ (pass|fail|todo)' | awk '{printf "%s=%s ", $2, $3}')
  suites="$suites$d[$r] "
done
scope=$(git diff --numstat v7-p1-base HEAD | awk '{split($3,p,"/"); k=(p[1]=="src"||p[1]=="tests")?p[1]"/"p[2]:p[1]; a[k]+=$1} END {for (k in a) printf "%s:+%d ", k, a[k]}')
dirty=$(git status --porcelain | grep -v -E 'dist/' | wc -l)
node -e 'console.log(JSON.stringify(Object.fromEntries(process.argv.slice(1).map(x => x.split("\u0001")))))' \
  "cell$(printf '\001')$(basename "$W")" "head$(printf '\001')$(git rev-parse --short HEAD)" "build$(printf '\001')$build" "tsc$(printf '\001')$tsc" \
  "newFormatIssues$(printf '\001')$fmt" "todoLeft$(printf '\001')$todo_left" "assertLinesRemoved$(printf '\001')$removed" \
  "target$(printf '\001')$target" "baselineDiffs$(printf '\001')$ndiff" "baseline$(printf '\001')$(echo "$base" | head -12 | tr '\n' ';')" \
  "suites$(printf '\001')$suites" "scope$(printf '\001')$scope" "dirty$(printf '\001')$dirty"
