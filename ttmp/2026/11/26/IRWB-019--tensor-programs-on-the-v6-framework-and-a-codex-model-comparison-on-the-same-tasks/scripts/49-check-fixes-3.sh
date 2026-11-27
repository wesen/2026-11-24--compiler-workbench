#!/usr/bin/env bash
# Check IRWB-031 (F23, Terra low) independently of its own report, as 29- did for the tensor fixes:
#   old: a temporary worktree at the agent's HEAD with src/, tools/ and corpus/ restored to t3-base, so its changed
#        tests run against the unfixed code (the new tests should fail);
#   new: the agent's worktree; its changed tests, then every typed, workbench and framework test.
# Writes various/results/fixes-3-checks/IRWB-031-{old,new,all}.txt.
set -u
R=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$R/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
W=$R/.claude/worktrees/fix3-tl-irwb-031; BASE=t3b-base; O=$T/various/results/fixes-3-checks; mkdir -p "$O"
summary() { grep -E '^ℹ (tests|pass|fail)' "$1" | awk '{printf "%s %s  ", $2, $3}'; }
mapfile -t tests < <(git -C "$W" diff --name-only "$BASE"..HEAD -- tests | grep '\.test\.mjs$')
tmp=$R/.claude/worktrees/check-irwb-031
git -C "$R" worktree remove --force "$tmp" 2>/dev/null
git -C "$R" worktree add -q --detach "$tmp" "$(git -C "$W" rev-parse HEAD)"
( cd "$tmp" && git checkout -q "$BASE" -- src tools corpus && npm run build --silent \
    && node --test --test-reporter=spec "${tests[@]}" ) > "$O/IRWB-031-old.txt" 2>&1
git -C "$R" worktree remove --force "$tmp"
( cd "$W" && npm run build --silent && node --test --test-reporter=spec "${tests[@]}" ) > "$O/IRWB-031-new.txt" 2>&1
( cd "$W" && node --test tests/framework/*.test.mjs tests/typed/*.test.mjs $(ls tests/tensor/*.test.mjs | grep -v gpu) ) > "$O/IRWB-031-all.txt" 2>&1
echo "IRWB-031 changed tests: ${tests[*]}"
echo "  old code + new tests: $(summary "$O/IRWB-031-old.txt")  failing: $(grep -E '^ *✖' "$O/IRWB-031-old.txt" | sed 's/ ([0-9.]*ms)//' | sort -u | head -8 | tr '\n' ';')"
echo "  new code + new tests: $(summary "$O/IRWB-031-new.txt")"
echo "  all framework, typed and non-GPU tensor tests: $(summary "$O/IRWB-031-all.txt")"
