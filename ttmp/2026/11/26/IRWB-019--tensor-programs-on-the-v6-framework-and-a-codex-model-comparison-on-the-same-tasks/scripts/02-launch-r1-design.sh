#!/usr/bin/env bash
# IRWB-019 research round r1 (deriving streaming attention), design only: four Codex configurations (sol/astra x medium/high), one agent each, same brief.
# Ticket letters map to configurations through various/results/r1-config-key.json (random, seed 20261126).
# Base 19ad269: before IRWB-019 exists, so the agents do not see the experiment's ticket.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=19ad269 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions.md
while read item round model effort; do
  MODEL=$model EFFORT=$effort bash $K/01-launch-codex-round.sh $round $T/various/prompts/r1 $item &
done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort)' $T/various/results/r1-config-key.json)
wait
