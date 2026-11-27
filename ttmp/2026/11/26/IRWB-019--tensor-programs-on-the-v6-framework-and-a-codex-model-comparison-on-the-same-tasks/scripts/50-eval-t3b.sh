#!/usr/bin/env bash
# Run the hidden T3b evaluator (hidden-t3b/t3b-eval.mjs: the whole T3 evaluation plus the outside variants and three
# held-out programs) on the ten T3b cells and on the baseline, t3b-base (main's T3 code, Opus's IRWB-029-D), in a
# detached worktree. Each worktree must be clean and is rebuilt from its HEAD first. One at a time, no GPU contention.
# Writes results/eval-t3b.json and prints a summary block per worktree.
set -u
R=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$R/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
wts=()
for c in t3b-baseline t3b-sm-irwb-030-a t3b-am-irwb-030-b t3b-tl-irwb-030-c t3b-op-irwb-030-d t3b-fa-irwb-030-e t3b-g-h-irwb-030-f t3b-ds-h-irwb-030-g t3b-ds-x-irwb-030-h t3b-gf-h-irwb-030-i t3b-g-max-irwb-030-j; do
  w=$R/.claude/worktrees/$c
  if [ -n "$(git -C "$w" status --porcelain)" ]; then echo "$c: worktree not clean, skipped"; continue; fi
  if ( cd "$w" && npm run build --silent ) > "$T/various/results/eval-t3b-build-$c.txt" 2>&1; then wts+=("$w"); rm "$T/various/results/eval-t3b-build-$c.txt"
  else echo "$c: build failed, see results/eval-t3b-build-$c.txt"; fi
done
echo "evaluating ${#wts[@]} worktrees from $(date -u +%H:%M:%SZ)"
node "$T/various/hidden-t3b/t3b-eval.mjs" run "$T/various/results/eval-t3b.json" "${wts[@]}"
echo "done $(date -u +%H:%M:%SZ)"
