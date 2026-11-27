#!/usr/bin/env bash
# Run the hidden T3 evaluator on the nine finished T3 cells (J, GLM 5.3 Flash max, did not run; diary step 38).
# Each worktree must be clean; it is rebuilt from its HEAD first, so dist/ matches the committed code. Then
# hidden-t3/t3-eval.mjs evaluates them one after another (no GPU contention between implementations), about 18 minutes each.
# Writes results/eval-t3.json (one key per worktree) and prints one summary block per cell.
set -u
R=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$R/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
wts=()
for c in t3-sm-irwb-029-a t3-am-irwb-029-b t3-tl-irwb-029-c t3-op-irwb-029-d t3-fa-irwb-029-e t3-g-h-irwb-029-f t3-ds-h-irwb-029-g t3-ds-x-irwb-029-h t3-gf-h-irwb-029-i; do
  w=$R/.claude/worktrees/$c
  if [ -n "$(git -C "$w" status --porcelain)" ]; then echo "$c: worktree not clean, skipped"; continue; fi
  if ( cd "$w" && npm run build --silent ) > "$T/various/results/eval-t3-build-$c.txt" 2>&1; then wts+=("$w"); rm "$T/various/results/eval-t3-build-$c.txt"
  else echo "$c: build failed, see results/eval-t3-build-$c.txt"; fi
done
echo "evaluating ${#wts[@]} worktrees from $(date -u +%H:%M:%SZ)"
node "$T/various/hidden-t3/t3-eval.mjs" run "$T/various/results/eval-t3.json" "${wts[@]}"
echo "done $(date -u +%H:%M:%SZ)"
