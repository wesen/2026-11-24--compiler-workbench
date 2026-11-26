**Streaming attention can be derived in six locally checkable rewrites over the reals.** The design specifies how to check each resulting f32 program against the original f64 reference. Numerical accuracy, GPU time, and DRAM traffic remain experimental questions for the GB10 run.

[Ticket IRWB-021-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ah-irwb-021-a/ttmp/2026/11/26/IRWB-021-A--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ah-irwb-021-a/ttmp/2026/11/26/IRWB-021-A--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-a-block-streaming-attention-fold.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ah-irwb-021-a/ttmp/2026/11/26/IRWB-021-A--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

1. **Inline producers.** Substitute pure indexed definitions while preserving index bindings and the score’s f32 operation order.
2. **Hoist the output divisor.** Move division by the positive row normalizer outside the weighted sum.
3. **Zip the sums.** Accumulate the normalizer and weighted value vector over the same key indices.
4. **Partition the reductions.** Split the maximum and tuple sum over consecutive key blocks, including the short final block.
5. **Rebase each block.** Compute its sums at its own maximum and scale both by `exp(block_max − row_max)`.
6. **Fold the summaries.** Merge each block into the running state by rescaling both summaries to their common maximum, then adding their normalizers and weighted values.

Committed as `f25bb8674750d8e5017674b45f9598ab583a14cc`. Ticket validation passed and the worktree is clean.