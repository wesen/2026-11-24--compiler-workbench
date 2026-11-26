#!/usr/bin/env bash
# Launch one Codex agent (gpt-6.2-sol, medium reasoning) per playground program, each in its own git worktree,
# to create a docmgr ticket and a design doc (user request, IRWB-001 diary step 38). Prompts: various/codex-playground/prompts.
set -u
ROOT=/home/manuel/code/wesen/2026-11-24--compiler-workbench
D=$ROOT/ttmp/2026/11/24/IRWB-001--ir-workbench/various/codex-playground
BASE=${BASE:-HEAD}
for ID in IRWB-012 IRWB-013 IRWB-014 IRWB-015 IRWB-016 IRWB-017; do
  W=$ROOT/.claude/worktrees/codex-${ID,,}
  [ -d "$W" ] || git -C "$ROOT" worktree add -q -b "codex/${ID,,}" "$W" "$BASE"
  PROMPT="$(cat "$D/prompts/00-common.md" "$D/prompts/$ID.md")"
  ( cd "$W" && timeout 3600 codex exec -m gpt-6.2-sol -c model_reasoning_effort=medium \
      -s workspace-write --add-dir "$ROOT/.git" -o "$D/logs/$ID.last-message.md" "$PROMPT" \
      > "$D/logs/$ID.log" 2>&1; echo "$ID exit $?" >> "$D/logs/exits.txt" ) &
done
wait
echo all done
