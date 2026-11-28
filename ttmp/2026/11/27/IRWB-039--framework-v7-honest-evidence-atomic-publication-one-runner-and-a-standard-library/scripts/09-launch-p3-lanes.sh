#!/usr/bin/env bash
# IRWB-039: solver move and F39 lanes (copy of 06- with BASE=v7-p2). The user, 2026-11-27: "yes" (to migration + F39 + solver).
# until you can validate your opinions on the types of task ahead of us"). Three cells per task: Codex Terra low (A),
# Pi GLM 5.3 high (B), Pi DeepSeek 4.1 Flash xhigh (C); policy v4; base v7-p1-base (phase 0 merged, phase 1a tests and
# baselines). Never edit this file while it runs; copy it instead.
# Usage: 03-launch-matrix.sh <timeout-seconds> <task>...   (tasks: f34 f27 f36 f37 f35 f33 lib)
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=v7-p2 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees
export AGENT_TIMEOUT=$1; shift
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v4.md
for task in "$@"; do
  while read -r item round model effort harness tools; do
    case $harness in
      codex) MODEL=$model EFFORT=$effort bash $K/01-launch-codex-round.sh "$round" "$T/various/prompts/$task" "$item" & ;;
      pi) PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
            bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/$task" "$item" & ;;
    esac
  done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.harness, c.tools ?? "-")' "$T/various/results/$task-config-key.json")
done
wait
