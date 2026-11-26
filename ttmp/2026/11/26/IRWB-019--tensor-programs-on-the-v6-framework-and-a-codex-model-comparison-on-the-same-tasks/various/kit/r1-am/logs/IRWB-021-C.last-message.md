[IRWB-021-C ticket](ttmp/2026/11/26/IRWB-021-C--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](ttmp/2026/11/26/IRWB-021-C--deriving-streaming-attention-by-checked-rewrites/design-doc/01-from-three-row-reductions-to-streaming-attention.md) · [Diary](ttmp/2026/11/26/IRWB-021-C--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

The design derives streaming attention over the reals in five checked rewrites. Each f32 revision is checked against the same original f64 reference.

1. **Inline pure definitions** to expose the score and weight expressions while preserving the score’s reduction order.
2. **Factor the row normalizer** out of the output sum, using its positivity to justify division after accumulation.
3. **Zip the sums** so one record accumulates both the normalizer and the weighted value vector.
4. **Lift to a mergeable summary** by carrying each partial sum’s maximum and rescaling both operands to their shared maximum before addition.
5. **Partition the reduction** into contiguous key blocks, using the disjoint-union identity to justify merging their summaries.

The derivation eliminates quadratic score and weight storage. Actual DRAM traffic depends on tile reuse, so the proposed GB10 experiment measures bytes and runtime against both unfused and handwritten kernels. Those performance claims remain untested.

Ticket validation passed. The worktree is clean at commit `3c6b7f7c9fff1acf04ec7f113e1a10297746d54f`.