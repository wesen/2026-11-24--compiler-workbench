#!/usr/bin/env bash
# IRWB-019 round R2 (creativity and scientific depth): "what compiler work would make Tix best in class?", design and
# experiments only. Codex cells (Sol and Astra, high), launched here; the two Claude cells (Opus, Fable) go through the
# coordinator's Agent tool with the same brief and policy. Base: branch r2-base (12bc661) = stage 2 as merged
# (IRWB-022-I) plus the tool header fix, without BACKLOG.md and the IRWB-019 ticket, so no agent sees the coordinator's
# backlog or analysis. Policy r2 (developer-instructions-r2.md) keeps only the probe and isolation rules: v1's
# "describe only what can be built with the current code" would cap a creativity round, and a policy outranks the brief.
# Codex gets network access (ssh to the GPU machine) and live web search; 3-hour timeout.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=12bc661 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-r2.md
export CODEX_EXTRA="-c sandbox_workspace_write.network_access=true -c web_search=live"
MODEL=gpt-6.2-sol EFFORT=high bash $K/01-launch-codex-round.sh r2-sh $T/various/prompts/r2 IRWB-023-A &
MODEL=gpt-6.2-astra EFFORT=high bash $K/01-launch-codex-round.sh r2-ah $T/various/prompts/r2 IRWB-023-B &
wait
