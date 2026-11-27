#!/usr/bin/env bash
# IRWB-019: Typed stage D2 (IRWB-037, missed optimizations from provenance), on the D1 merge. Adapted from 56-launch-typed.sh.
# The user, 2026-11-27: "cue up all the T6 and typed work and start whatever can be started".)
#   policy v4 (v3r plus the framework-first rules, BACKLOG "Framework first, grounded in theory").
# Seven cells: Opus and Fable through the coordinator's Agent tool (prompts/typed/d2/claude/), and here: Codex Sol
# medium, Astra medium, Terra low; Pi DeepSeek 4.1 Flash xhigh, GLM 5.3 high. No GPU, no network for Codex.
# Base: d2-base (main after the D1 merge, without IRWB-019 and BACKLOG.md). Three-hour cap. Never edit this file while it runs; copy it instead.
# Usage: 58-launch-d2.sh
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=d2-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v4.md
for task in ${@:-d2}; do
  while read -r item round model effort harness tools; do
    case $harness in
      codex) MODEL=$model EFFORT=$effort bash $K/01-launch-codex-round.sh "$round" "$T/various/prompts/typed/$task" "$item" & ;;
      pi) PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
            bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/typed/$task" "$item" & ;;
    esac
  done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.harness, c.tools ?? "-")' "$T/various/results/$task-config-key.json")
done
wait
