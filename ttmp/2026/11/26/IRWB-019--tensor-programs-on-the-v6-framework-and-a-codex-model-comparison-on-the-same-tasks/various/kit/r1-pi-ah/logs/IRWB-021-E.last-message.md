**IRWB-021-E — Deriving streaming attention by checked rewrites**  
[Ticket](ttmp/2026/11/26/IRWB-021-E--deriving-streaming-attention-by-checked-rewrites/index.md) · [Design](ttmp/2026/11/26/IRWB-021-E--deriving-streaming-attention-by-checked-rewrites/design-doc/01-from-row-softmax-to-a-checked-block-fold.md) · [Diary](ttmp/2026/11/26/IRWB-021-E--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

1. **Substitute producers:** Inline pure tensor definitions at their indexed reads without changing reduction scope or f32 operation order.
2. **Factor the denominator:** Move division by the positive, row-invariant normalizer outside the weighted sum.
3. **Pack row statistics:** Represent the maximum, normalizer and weighted value sum as one summary.
4. **Merge at a common maximum:** Rescale both partial normalizers and weighted sums to the larger maximum, yielding an associative fold over the reals.
5. **Partition the fold:** Compute tile-local summaries and merge them in key order without materializing a global score or weight matrix.

The design separates exact real identities from sampled f32 checks against the original program. `docmgr doctor` passed; the GB10 experiment is specified, not run.

**Commit:** `ff9a56f1cfd371a4fa3b3366e4baabaee9dc4a28`
