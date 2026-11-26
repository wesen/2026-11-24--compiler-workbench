#!/usr/bin/env bash
# IRWB-018 implementation round, follow-up: resume each implementer to fit its project's files to the tile widths
# that tests/typed/format.test.mjs enforces (found at integration; the brief had kept agents off corpus-wide tests).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-018--codex-subagents-as-designers-where-the-over-engineering-comes-from-and-whether-a-brief-can-reduce-it
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=77ad469 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees MODEL=gpt-6.2-sol EFFORT=medium
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-impl.md AGENT_TIMEOUT=2400
bash $K/02-resume-codex-round.sh impl-fmt impl $T/various/prompts/impl-fmt.md IRWB-012 IRWB-013 IRWB-014 IRWB-015 IRWB-016 IRWB-017
