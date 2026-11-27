#!/usr/bin/env bash
# Check IRWB-028 (F2-F6, Terra low) independently of its own report, as 29- did for the tensor fixes:
#   old: a temporary worktree at the agent's HEAD with src/, tools/ and corpus/ restored to t3-base, so its changed
#        tests run against the unfixed code (F2, F3, F4, F6 should fail; F5's tests are test-only changes and may pass);
#   new: the agent's worktree; its changed tests, then every typed, workbench and framework test.
# Writes various/results/fixes-2-checks/IRWB-028-{old,new,all}.txt.
set -u
R=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$R/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
W=$R/.claude/worktrees/fix2-tl-irwb-028; BASE=t3-base; O=$T/various/results/fixes-2-checks; mkdir -p "$O"
summary() { grep -E '^ℹ (tests|pass|fail)' "$1" | awk '{printf "%s %s  ", $2, $3}'; }
mapfile -t tests < <(git -C "$W" diff --name-only "$BASE"..HEAD -- tests | grep '\.test\.mjs$')
tmp=$R/.claude/worktrees/check-irwb-028
git -C "$R" worktree remove --force "$tmp" 2>/dev/null
git -C "$R" worktree add -q --detach "$tmp" "$(git -C "$W" rev-parse HEAD)"
( cd "$tmp" && git checkout -q "$BASE" -- src tools corpus && npm run build --silent \
    && node --test --test-reporter=spec "${tests[@]}" ) > "$O/IRWB-028-old.txt" 2>&1
git -C "$R" worktree remove --force "$tmp"
( cd "$W" && npm run build --silent && node --test --test-reporter=spec "${tests[@]}" ) > "$O/IRWB-028-new.txt" 2>&1
( cd "$W" && node --test tests/typed/*.test.mjs tests/workbench/*.test.mjs tests/framework/*.test.mjs ) > "$O/IRWB-028-all.txt" 2>&1
echo "IRWB-028 changed tests: ${tests[*]}"
echo "  old code + new tests: $(summary "$O/IRWB-028-old.txt")  failing: $(grep -E '^ *✖' "$O/IRWB-028-old.txt" | sed 's/ ([0-9.]*ms)//' | sort -u | head -8 | tr '\n' ';')"
echo "  new code + new tests: $(summary "$O/IRWB-028-new.txt")"
echo "  all typed, workbench and framework tests: $(summary "$O/IRWB-028-all.txt")"
