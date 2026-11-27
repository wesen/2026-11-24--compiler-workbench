#!/usr/bin/env bash
# IRWB-019: resume the F2-F6 agent (IRWB-028, Terra low) with the coordinator's review of F5 (prompts/fixes-2/review-1.md):
# F5 replaced exact corpus-wide totals with "> 0"; it is asked to keep each quantity per project instead.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
MODEL=gpt-6.1-terra EFFORT=low bash $K/02-resume-codex-round.sh fix2-tl-r1 fix2-tl $T/various/prompts/fixes-2/review-1.md IRWB-028
