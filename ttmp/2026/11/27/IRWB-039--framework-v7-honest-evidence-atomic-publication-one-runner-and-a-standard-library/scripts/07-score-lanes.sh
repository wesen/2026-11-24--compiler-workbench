#!/usr/bin/env bash
# IRWB-039: score matrix cells one at a time with 04-score-cell.sh; appends to various/results/lanes-scores.jsonl.
# Usage: 05-score-cells.sh <worktree-name>...   (the task is read from the name: v7-<task>-...)
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library
W=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees
for n in "$@"; do
  task=$(echo "$n" | cut -d- -f2)
  case $task in f34) re='F34';; f27) re='F27';; f36) re='F36|F38';; f37) re='F37';; f35) re='F35';; f33) re='F33';; lib) re='stdlib|liveness';; graph|lattice|affine|num|solver|f39) re='zzz';; spike) re='transformation';; esac
  BASEREF=${BASEREF:-v7-p2-base} bash $T/scripts/04-score-cell.sh "$W/$n" "$re" >> $T/various/results/lanes-scores.jsonl
  echo "scored $n"
done
