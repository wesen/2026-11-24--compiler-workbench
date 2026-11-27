#!/usr/bin/env bash
# IRWB-019: hand the small open fixes F14, F19, F20 (BACKLOG.md) to one Codex agent: Astra, high, on main as of F13
# (bc7702c). The global Codex policy is v3. Network access for the GPU machine (F20's cuBLAS probe).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=bc7702c OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export CODEX_EXTRA="-c sandbox_workspace_write.network_access=true"
MODEL=gpt-6.2-astra EFFORT=high bash $K/01-launch-codex-round.sh fix1-ah $T/various/prompts/fixes-1 IRWB-024
