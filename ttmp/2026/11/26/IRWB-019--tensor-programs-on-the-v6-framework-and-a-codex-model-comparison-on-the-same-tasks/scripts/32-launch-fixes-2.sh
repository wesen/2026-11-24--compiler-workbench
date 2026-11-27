#!/usr/bin/env bash
# IRWB-019: the small Typed-side fixes F2-F6 (BACKLOG.md) to one Codex agent, Terra low (gpt-6.1-terra; the account
# cannot run gpt-6.2-terra), as the user chose (2026-11-27: small fixes to one Terra low agent). Base: t3-base (main
# without the coordinator's ticket and backlog). No network needed. A new file rather than an edit of 26-, which was
# edited while running once (diary step 35).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=t3-base OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees AGENT_TIMEOUT=5400
MODEL=gpt-6.1-terra EFFORT=low bash $K/01-launch-codex-round.sh fix2-tl $T/various/prompts/fixes-2 IRWB-028
