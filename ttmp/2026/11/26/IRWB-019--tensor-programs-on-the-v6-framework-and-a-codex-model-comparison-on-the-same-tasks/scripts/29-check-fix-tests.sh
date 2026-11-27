#!/usr/bin/env bash
# For each fixes agent (IRWB-024..027), check its regression tests independently of its own report:
#   old: a temporary worktree at the agent's HEAD with src/ and tools/ restored to the base (bc7702c), so the agent's
#        new tests run against the unfixed code; they should fail;
#   new: the agent's worktree as committed; its changed tests should pass, and so should every framework and tensor
#        test (tests/framework/*.test.mjs tests/tensor/*.test.mjs; the GPU tests reach the GB10).
# Writes various/results/fixes-1-checks/<item>-{old,new,all}.txt and prints a summary. Runs one agent at a time.
# Usage: 29-check-fix-tests.sh [item ...]   (default: all four)
set -u
R=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$R/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
WT=$R/.claude/worktrees; BASE=bc7702c; O=$T/various/results/fixes-1-checks; mkdir -p "$O"
declare -A ROUND=([IRWB-024]=fix1-ah [IRWB-025]=fix1-al [IRWB-026]=fix1-sl [IRWB-027]=fix1-tl)
summary() { grep -E '^ℹ (tests|pass|fail)' "$1" | awk '{printf "%s %s  ", $2, $3}'; }
for item in "${@:-IRWB-024 IRWB-025 IRWB-026 IRWB-027}"; do
  for it in $item; do
    w=$WT/${ROUND[$it]}-${it,,}
    mapfile -t tests < <(git -C "$w" diff --name-only "$BASE"..HEAD -- tests)
    tmp=$WT/check-${it,,}
    git -C "$R" worktree remove --force "$tmp" 2>/dev/null
    git -C "$R" worktree add -q --detach "$tmp" "$(git -C "$w" rev-parse HEAD)"
    ( cd "$tmp" && git checkout -q "$BASE" -- src tools && npm run build --silent \
        && node --test --test-reporter=spec "${tests[@]}" ) > "$O/$it-old.txt" 2>&1
    git -C "$R" worktree remove --force "$tmp"
    ( cd "$w" && npm run build --silent && node --test --test-reporter=spec "${tests[@]}" ) > "$O/$it-new.txt" 2>&1
    ( cd "$w" && node --test tests/framework/*.test.mjs tests/tensor/*.test.mjs ) > "$O/$it-all.txt" 2>&1
    echo "$it changed tests: ${tests[*]}"
    echo "  old code + new tests: $(summary "$O/$it-old.txt")  failing: $(grep -E '^ *✖' "$O/$it-old.txt" | sed 's/ ([0-9.]*ms)//' | sort -u | head -6 | tr '\n' ';')"
    echo "  new code + new tests: $(summary "$O/$it-new.txt")"
    echo "  all framework and tensor tests: $(summary "$O/$it-all.txt")"
  done
done
