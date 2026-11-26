#!/usr/bin/env bash
# IRWB-018 implementation round: six Codex agents (gpt-6.2-sol, medium) implement the merged round-2 designs
# (IRWB-012..017) from 77ad469 (loader plumbing for ingest/entries in 6ad38d0), with the design policy as
# developer_instructions plus a worktree-isolation line. The brief is neutral about test volume and harness code,
# because the question is whether the agents over-index on testing and build frameworks (user's hypothesis).
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-018--codex-subagents-as-designers-where-the-over-engineering-comes-from-and-whether-a-brief-can-reduce-it
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench BASE=77ad469 OUT=$T/various/kit WORKTREES=/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees MODEL=gpt-6.2-sol EFFORT=medium
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-impl.md AGENT_TIMEOUT=5400
bash $K/01-launch-codex-round.sh impl $T/various/prompts/impl IRWB-012 IRWB-013 IRWB-014 IRWB-015 IRWB-016 IRWB-017
