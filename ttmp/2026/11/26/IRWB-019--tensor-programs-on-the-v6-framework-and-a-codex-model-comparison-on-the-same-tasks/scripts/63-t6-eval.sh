#!/usr/bin/env bash
# IRWB-019: build the T6 base and the ten T6 worktrees, then run the hidden T6 evaluation on them one at a time.
# Usage: 63-t6-eval.sh [worktree-name...]   (default: the base and all ten cells)
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
W=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees
names=("$@"); [ ${#names[@]} = 0 ] && names=(typed-base-eval t6-sm-irwb-033-a t6-am-irwb-033-b t6-tl-irwb-033-c t6-op-irwb-033-d t6-fa-irwb-033-e t6-g-h-irwb-033-f t6-ds-h-irwb-033-g t6-ds-x-irwb-033-h t6-gf-h-irwb-033-i t6-g-max-irwb-033-j)
paths=()
for n in "${names[@]}"; do
  if (cd "$W/$n" && npm run build --silent >/dev/null 2>&1); then echo "built $n"; else echo "BUILD FAILED $n"; fi
  paths+=("$W/$n")
done
node "$T/various/hidden-t6/t6-eval.mjs" run "$T/various/results/eval-t6.json" "${paths[@]}"
