#!/usr/bin/env bash
# IRWB-019: F24-F26 (BACKLOG.md: kernel entities, the gate's choice, the baseline-key contract) to one Codex agent, Terra low
# (gpt-6.1-terra), as the user set for small fixes. The user asked for these on 2026-11-27 ("and 3"). They run before T6, whose base includes them.
# Base: fix4-base (main after T3b and F23, without the coordinator's ticket and backlog). Network access for the F25 GPU test.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=fix4-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-v3.md
CODEX_EXTRA="-c sandbox_workspace_write.network_access=true" MODEL=gpt-6.1-terra EFFORT=low bash $K/01-launch-codex-round.sh fix4-tl $T/various/prompts/fixes-4 IRWB-032
