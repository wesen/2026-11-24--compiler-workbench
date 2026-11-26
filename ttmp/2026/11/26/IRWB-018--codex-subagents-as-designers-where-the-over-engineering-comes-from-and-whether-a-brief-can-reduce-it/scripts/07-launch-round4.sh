#!/usr/bin/env bash
# IRWB-018 round 4: the baseline brief unchanged, plus the design policy as Codex developer_instructions.
# Uses the go-go-parc agent-design-review kit. Base d521d97 (as rounds 2 and 3); the global ~/.codex/AGENTS.md was
# cleaned up before this round (no bootstrap, Go/web parts scoped), a difference from the baseline's context.
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-018--codex-subagents-as-designers-where-the-over-engineering-comes-from-and-whether-a-brief-can-reduce-it
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=d521d97 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees MODEL=gpt-6.2-sol EFFORT=medium
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-round4.md AGENT_TIMEOUT=3600
bash $K/01-launch-codex-round.sh round4 $T/various/prompts/round4 IRWB-012 IRWB-013 IRWB-014 IRWB-015 IRWB-016 IRWB-017
