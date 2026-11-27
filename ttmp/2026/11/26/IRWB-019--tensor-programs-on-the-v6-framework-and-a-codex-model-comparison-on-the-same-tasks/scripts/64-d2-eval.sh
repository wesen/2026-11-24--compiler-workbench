#!/usr/bin/env bash
# IRWB-019: hidden evaluation of D2 (IRWB-037) with the D1 evaluator, against d2-base; then the summary with tests.
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks; W=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees
export EVAL_BASE=d2-base
node $T/various/hidden-typed/d1-eval.mjs run $T/various/results/eval-d2.json $W/typed-d2-base-eval $W/d2-sm-irwb-037-a $W/d2-am-irwb-037-b $W/d2-tl-irwb-037-c $W/d2-ds-x-irwb-037-d $W/d2-g-h-irwb-037-e $W/d2-op-irwb-037-f $W/d2-fa-irwb-037-g > /dev/null
node $T/scripts/57-d1-summary.mjs $T/various/results/eval-d2.json --tests --base typed-d2-base-eval
