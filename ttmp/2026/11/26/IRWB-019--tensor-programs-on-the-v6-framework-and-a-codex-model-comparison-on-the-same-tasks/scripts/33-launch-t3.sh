#!/usr/bin/env bash
# IRWB-019 stage 3 (checked fusion), an implementation stage in one session per cell, no design round (R2 settled the
# approach). Cells from results/t3-config-key.json, as the user set them on 2026-11-27:
#   Codex: Sol medium, Astra medium, Terra low (gpt-6.1-terra), with network access for the GPU machine;
#   Pi with only the LunaRoute extension and the four built-in tools: GLM 5.3 high, DeepSeek 4.1 Flash high and xhigh,
#   GLM 5.3 Flash high and max.
# The Claude cells (Opus, Fable) go through the coordinator's Agent tool with the same brief and policy
# (prompts/t3/claude/). Base: t3-base (main without the coordinator's ticket and backlog). Policy: v3 for every cell
# (Codex: developer_instructions; Pi: --append-system-prompt). Three-hour cap.
# Never edit this file while it runs (diary step 35); copy it instead.
# Usage: 33-launch-t3.sh [codex|pi ...]   (default: both)
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
E=/home/manuel/.pi/agent/npm/node_modules/@lunaroute/pi-extension/src/index.ts
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=t3-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=10800
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v3.md
cells() { node -e 'for (const [item, c] of Object.entries(require(process.argv[1]))) if (c.harness === process.argv[2]) console.log(item, c.round, c.model, c.effort, c.tools ?? "-")' "$T/various/results/t3-config-key.json" "$1"; }
for h in ${@:-codex pi}; do
  while read -r item round model effort tools; do
    case $h in
      codex) CODEX_EXTRA="-c sandbox_workspace_write.network_access=true" MODEL=$model EFFORT=$effort \
               bash $K/01-launch-codex-round.sh "$round" "$T/various/prompts/t3" "$item" & ;;
      pi) PI_FLAGS="--no-extensions --no-mcp -e $E --tools $tools" MODEL=$model EFFORT=$effort \
            bash $K/12-launch-pi-round.sh "$round" "$T/various/prompts/t3" "$item" & ;;
    esac
  done < <(cells "$h")
done
wait
