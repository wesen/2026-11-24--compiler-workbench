#!/usr/bin/env bash
# IRWB-019: F23 (BACKLOG.md; correspondence entity lists checked against the artifacts) to one Codex agent, Terra low
# (gpt-6.1-terra), as the user set for small fixes. F22, listed with it in the coordinator's plan, is part of F15 (the
# tolerance relation) and goes with T4 instead. Base: t3b-base (main after T3, without the coordinator's ticket and
# backlog). No network needed. Runs alongside T3b, which is told not to touch the correspondence code.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=t3b-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v3.md
MODEL=gpt-6.1-terra EFFORT=low bash $K/01-launch-codex-round.sh fix3-tl $T/various/prompts/fixes-3 IRWB-031
