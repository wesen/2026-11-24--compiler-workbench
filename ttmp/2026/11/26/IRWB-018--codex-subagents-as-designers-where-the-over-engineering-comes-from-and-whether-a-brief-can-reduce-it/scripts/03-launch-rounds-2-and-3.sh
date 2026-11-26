#!/usr/bin/env bash
# IRWB-018: two interventions on the six playground designs, run concurrently.
#   Round 2: fresh Codex agents (gpt-6.2-sol, medium) with the revised brief (prompts/00-common-round2.md + the
#            unchanged per-program specs), in new worktrees codex2-irwb-0NN on branches codex2/irwb-0NN from
#            d521d97 (the baseline's repository state, without the baseline prompt files).
#   Round 3: the six baseline sessions resumed with a generic self-review prompt (prompts/round3-self-review.md),
#            in their own worktrees codex-irwb-0NN (baseline commits stay as recorded in the IRWB-001 review).
set -u
ROOT=/home/manuel/code/wesen/2026-11-24--compiler-workbench
T=$(ls -d $ROOT/ttmp/2026/11/26/IRWB-018--*)
P=$T/various/prompts
L2=$T/various/logs/round2; L3=$T/various/logs/round3; mkdir -p $L2 $L3
BL=$ROOT/ttmp/2026/11/24/IRWB-001--ir-workbench/various/codex-playground/logs
SANDBOX=(-c sandbox_mode=\"workspace-write\" -c "sandbox_workspace_write.writable_roots=[\"$ROOT/.git\"]")
for ID in IRWB-012 IRWB-013 IRWB-014 IRWB-015 IRWB-016 IRWB-017; do
  id=${ID,,}
  W2=$ROOT/.claude/worktrees/codex2-$id
  [ -d "$W2" ] || git -C "$ROOT" worktree add -q -b "codex2/$id" "$W2" d521d97
  PROMPT2="$(cat "$P/00-common-round2.md" "$P/$ID.md")"
  ( cd "$W2" && timeout 3600 codex exec -m gpt-6.2-sol -c model_reasoning_effort=medium \
      -s workspace-write --add-dir "$ROOT/.git" -o "$L2/$ID.last-message.md" "$PROMPT2" \
      > "$L2/$ID.log" 2>&1; echo "$ID round2 exit $?" >> "$L2/exits.txt" ) &
  SID=$(grep -m1 "session id:" "$BL/$ID.log" | awk '{print $3}')
  W1=$ROOT/.claude/worktrees/codex-$id
  ( cd "$W1" && timeout 3600 codex exec resume -m gpt-6.2-sol -c model_reasoning_effort=medium "${SANDBOX[@]}" \
      -o "$L3/$ID.last-message.md" "$SID" "$(sed "s/<ID>/$ID/" "$P/round3-self-review.md")" \
      > "$L3/$ID.log" 2>&1; echo "$ID round3 exit $?" >> "$L3/exits.txt" ) &
done
wait
echo all done
