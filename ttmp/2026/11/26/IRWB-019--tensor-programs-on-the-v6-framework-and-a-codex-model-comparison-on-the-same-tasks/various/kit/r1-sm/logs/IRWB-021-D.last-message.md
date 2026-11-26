[IRWB-021-D ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

1. **Factor the normalizer.** Move the row-invariant division outside the weighted sum.
2. **Zip the sums.** Accumulate the normalizer and weighted numerator in one tuple fold.
3. **Replace the global shift.** Carry the running maximum, normalizer, and numerator, rescaling both sums when the maximum changes.
4. **Fold consecutive tiles.** Compute a local summary for each tile and merge it into the running state.
5. **Sink tile producers.** Compute scores and weights inside each tile and remove the unused square tensors.

Docmgr validation passed. The f32 tolerance and GB10 success thresholds are proposed experiment criteria. The benchmark remains unrun.

Commit `1a31c82ae1319678adc287598b0f4510a986722e`. The worktree is clean.