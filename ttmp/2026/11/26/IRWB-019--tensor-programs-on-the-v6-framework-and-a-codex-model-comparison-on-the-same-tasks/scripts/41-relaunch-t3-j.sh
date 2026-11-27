#!/usr/bin/env bash
# Relaunch T3 cell J (GLM 5.3 Flash max, Pi) alone: its first attempt failed at start with LunaRoute's "the upstream
# stream failed before completion" (kit/t3-gf-max/attempt-1/). Same configuration as 33-launch-t3.sh; the worktree from
# the first attempt (no commits) is reused. A new file, since 33- is still running (diary step 35).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=t3-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v3.md
PI_FLAGS="--no-extensions --no-mcp -e $E --tools read,bash,edit,write" MODEL=lunaroute/glm-5.3-flash EFFORT=max \
  bash $K/12-launch-pi-round.sh t3-gf-max "$T/various/prompts/t3" IRWB-029-J
