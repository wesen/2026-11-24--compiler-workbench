#!/usr/bin/env bash
# IRWB-019: resume the F23 agent (IRWB-031, Terra low) with the coordinator's review (prompts/fixes-3/review-1.md):
# the declared lists are checked, but entry IDs in a directly built Correspondence are not.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
MODEL=gpt-6.1-terra EFFORT=low bash $K/02-resume-codex-round.sh fix3-tl-r1 fix3-tl $T/various/prompts/fixes-3/review-1.md IRWB-031
