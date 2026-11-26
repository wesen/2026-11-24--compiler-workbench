#!/usr/bin/env bash
# IRWB-019: the Pi cells of the t1 and r1 design rounds (same briefs, base and policy; harness Pi 1.5.1 with
# --no-extensions --no-mcp; the policy appended to Pi's system prompt). Usage: 05-launch-pi-design.sh t1|r1
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks; task=$1
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=19ad269 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions.md
while read item round model effort; do
  MODEL=$model EFFORT=$effort bash $K/12-launch-pi-round.sh $round $T/various/prompts/$task $item &
done < <(node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) if (c.harness === "pi") console.log(item, c.round, c.model, c.effort)' $T/various/results/$task-config-key.json)
wait
