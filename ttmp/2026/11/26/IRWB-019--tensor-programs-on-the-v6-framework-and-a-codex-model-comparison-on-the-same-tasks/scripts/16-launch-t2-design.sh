#!/usr/bin/env bash
# IRWB-019 stage 2 (CUDA lowering), design turn: the twelve Codex and Pi cells, one agent each, same brief and policy
# (v1). Base: branch t2-base (1880fc4) = stage 1 as merged (IRWB-020-B) plus tools/cuda-remote.mjs, without the
# IRWB-019 ticket, so the agents do not see the experiment's keys or results. Codex gets sandbox network access for
# ssh to the GPU machine (without it, agents escalate and the approval sidecar grants it; see diary step 14).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=1880fc4 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions.md
while read item round model effort harness; do
  if [ "$harness" = pi ]; then MODEL=$model EFFORT=$effort bash $K/12-launch-pi-round.sh $round $T/various/prompts/t2 $item &
  else MODEL=$model EFFORT=$effort CODEX_EXTRA="-c sandbox_workspace_write.network_access=true" bash $K/01-launch-codex-round.sh $round $T/various/prompts/t2 $item &
  fi
done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) console.log(item, c.round, c.model, c.effort, c.harness)' $T/various/results/t2-config-key.json)
wait
