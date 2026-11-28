#!/usr/bin/env bash
# IRWB-056-B probe 04: the O2 corpus before this step, built from the base commit's own sources.
#
# The decision point asks whether recording derivations makes the corpus compile more than about 2x slower. The
# numbers in 03-cost.mjs compare two ways of computing the correspondence *in this build*; this script measures the
# base commit (`$1`, default: the commit this ticket branched from) beside the current build, in one process, so the
# machine's load is shared. Everything it writes stays in this ticket's directory.
#
#   node 04-cost-before-after.mjs <base-commit>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../../" && pwd)
base=${1:-ab23152}
work="$here/../various/before"   # not committed: a build of the base commit
rm -rf "$work"
mkdir -p "$work"
cd "$root"
git archive "$base" src tools tsconfig.json | tar -x -C "$work"
ln -s "$root/vendor" "$work/vendor"
ln -s "$root/corpus" "$work/corpus"
(cd "$work" && "$root/node_modules/.bin/tsc" -p tsconfig.json)
echo "built $base into $work/dist"
node "$here/04-cost-before-after.mjs" "$work"
