## 1

I’ll use the docmgr and diary skills to create IRWB-021-D, verify the framework interfaces in this worktree, and commit the design and diary.

## 2

The framework can compare every candidate with the same pinned original. The first rewrite needs that tolerance check because Tix puts the final division inside the sum. Moving it outside is exact over the reals and can change f32 results.

## 3

The derivation now gives each rewrite a local proof. The experiment also separates the removal of square intermediates from total DRAM traffic, which depends on how the kernel reuses K and V.

## 4

Docmgr validation and all 10 relative links passed. The sandbox blocked `git add` because the linked worktree’s Git index is read-only there. I’ll retry with elevated access, scoped to this ticket.

## 5

[IRWB-021-D ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sm-irwb-021-d/ttmp/2026/11/26/IRWB-021-D--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

1. **Factor the normalizer.** Move the row-invariant division outside the weighted sum.
2. **Zip the sums.** Accumulate the normalizer and weighted numerator in one tuple fold.
3. **Replace the global shift.** Carry the running maximum, normalizer, and numerator, rescaling both sums when the maximum changes.
4. **Fold consecutive tiles.** Compute a local summary for each tile and merge it into the running state.
5. **Sink tile producers.** Compute scores and weights inside each tile and remove the unused square tensors.

Docmgr validation passed. The f32 tolerance and GB10 success thresholds are proposed experiment criteria. The benchmark remains unrun.

Commit `1a31c82ae1319678adc287598b0f4510a986722e`. The worktree is clean.
