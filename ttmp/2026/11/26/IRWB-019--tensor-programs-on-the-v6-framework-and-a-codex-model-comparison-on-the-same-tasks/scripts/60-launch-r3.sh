#!/usr/bin/env bash
# IRWB-019 R3 (IRWB-038): a design-level review of the framework from all the material so far. Adapted from 58-launch-d2.sh.
# The user, 2026-11-27: "cue up all the T6 and typed work and start whatever can be started".)
#   policy r3 (creativity invited; every claim cites path:line; read-only on the other worktrees).
# Four cells: Opus and Fable through the coordinator's Agent tool (prompts/r3/claude/), and here: Codex Sol
# medium and Astra medium (the user, 2026-11-27: "launch fable/opus/sol/astra"). No network.
# Base: r3-base (main at 93ec5fc, with IRWB-019 and BACKLOG.md: they are material here). Three-hour cap. Never edit this file while it runs; copy it instead.
# Usage: 60-launch-r3.sh
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=r3-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-r3.md
for task in ${@:-r3}; do
  while read -r item round model effort harness tools; do
    case $harness in
      codex) MODEL=$model EFFORT=$effort bash $K/01-launch-codex-round.sh "$round" "$T/various/prompts/$task" "$item" & ;;
      pi) PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
            bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/$task" "$item" & ;;
    esac
  done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.harness, c.tools ?? "-")' "$T/various/results/$task-config-key.json")
done
wait
