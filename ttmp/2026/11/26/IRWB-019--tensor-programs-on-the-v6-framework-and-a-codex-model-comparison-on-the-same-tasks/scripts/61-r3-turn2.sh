#!/usr/bin/env bash
# IRWB-019 R3: once each Codex reviewer's first turn has ended, resume it with the standard-library question (the user,
# 2026-11-27, added after launch; the Claude reviewers received it by message during their first turn).
T=/home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks
K=/home/manuel/code/wesen/go-go-golems/go-go-parc/Research/playbooks/agents/scripts/agent-design-review
export REPO=/home/manuel/code/wesen/2026-11-24--compiler-workbench OUT=$T/various/kit AGENT_TIMEOUT=7200
export DEV_INSTRUCTIONS_FILE=$T/various/prompts/developer-instructions-r3.md
go() { # round item model
  until [ -f "$OUT/$1/heads.json" ]; do sleep 30; done
  MODEL=$3 EFFORT=medium bash $K/02-resume-codex-round.sh "$1-t2" "$1" "$T/various/prompts/r3/turn2-standard-library.md" "$2"
}
go r3-sm IRWB-038-A gpt-6.2-sol &
go r3-am IRWB-038-B gpt-6.2-astra &
wait
