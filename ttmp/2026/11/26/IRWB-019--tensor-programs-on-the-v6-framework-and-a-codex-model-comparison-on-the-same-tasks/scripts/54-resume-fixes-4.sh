#!/usr/bin/env bash
# IRWB-019: resume the F24-F26 agent (IRWB-032, Terra low) with the coordinator's review (prompts/fixes-4/review-1.md):
# F26 imports node:util, which breaks the browser bundle of src/framework.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
CODEX_EXTRA="-c sandbox_workspace_write.network_access=true" MODEL=gpt-6.1-terra EFFORT=low bash $K/02-resume-codex-round.sh fix4-tl-r1 fix4-tl $T/various/prompts/fixes-4/review-1.md IRWB-032
