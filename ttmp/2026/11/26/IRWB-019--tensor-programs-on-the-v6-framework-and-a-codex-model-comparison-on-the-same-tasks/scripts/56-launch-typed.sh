#!/usr/bin/env bash
# IRWB-019: the Typed-side research and implementation stages that can run now, in parallel with T6 (the user,
# 2026-11-27: "cue up all the T6 and typed work and start whatever can be started in paralellel sessions already"):
#   D1 (IRWB-034, why `speed` slows the bytecode VM), A0 (IRWB-035, the share of local value rewrites),
#   B1 (IRWB-036, specializing the VM on its bytecode). D2 (missed optimizations) waits for D1's attribution.
# Five cells each, none of them Claude (the coordinator's choice, to keep Claude usage to T6's two cells): Codex Sol
# medium, Astra medium, Terra low; Pi DeepSeek 4.1 Flash xhigh, GLM 5.3 high. No GPU, no network for Codex.
# Base: t6-base. Policy v3r. Three-hour cap. Never edit this file while it runs; copy it instead.
# Usage: 56-launch-typed.sh [d1 a0 b1 ...]
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=t6-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v3r.md
for task in ${@:-d1 a0 b1}; do
  while read -r item round model effort harness tools; do
    case $harness in
      codex) MODEL=$model EFFORT=$effort bash $K/01-launch-codex-round.sh "$round" "$T/various/prompts/typed/$task" "$item" & ;;
      pi) PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
            bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/typed/$task" "$item" & ;;
    esac
  done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.harness, c.tools ?? "-")' "$T/various/results/$task-config-key.json")
done
wait
