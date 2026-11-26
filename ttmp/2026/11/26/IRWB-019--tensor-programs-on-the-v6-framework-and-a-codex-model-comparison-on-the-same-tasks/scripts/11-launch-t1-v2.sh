#!/usr/bin/env bash
# IRWB-019 Sol prompting experiment: the four Sol cells (Codex and Pi, medium and high) redesign stage 1 with policy
# v2 (v1 plus four rules aimed at the excess the t1 judge found). Same brief and base as t1.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=19ad269 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v2.md
while read item round model effort harness; do
  if [ "$harness" = pi ]; then L=12-launch-pi-round.sh; else L=01-launch-codex-round.sh; fi
  MODEL=$model EFFORT=$effort bash $K/$L $round $T/various/prompts/t1 $item &
done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) if (c.policy === "v2") console.log(item, c.round, c.model, c.effort, c.harness)' $T/various/results/t1-config-key.json)
wait
