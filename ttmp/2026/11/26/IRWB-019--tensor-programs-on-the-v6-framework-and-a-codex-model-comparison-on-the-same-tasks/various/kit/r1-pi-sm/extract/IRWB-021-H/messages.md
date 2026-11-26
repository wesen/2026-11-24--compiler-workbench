## 0

- [Ticket: IRWB-021-H](ttmp/2026/11/26/IRWB-021-H--deriving-streaming-attention-by-checked-rewrites/index.md)
- [Research design](ttmp/2026/11/26/IRWB-021-H--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- [Diary](ttmp/2026/11/26/IRWB-021-H--deriving-streaming-attention-by-checked-rewrites/reference/01-diary.md)

**Rewrite rules**
1. **Extract invariant divisors** from the score and output sums.
2. **Pack co-indexed sums** into an ordered tuple fold.
3. **Replace the global shift** with a mergeable maximum, normalizer, and weighted numerator.
4. **Partition the fold** into contiguous key tiles using the summary’s real-valued merge law.
5. **Evaluate each tile at a fixed local shift** instead of rescaling after every key.
6. **Move score and weight production into the tile** so neither matrix is materialized globally.

Documentation checks passed. No implementation or GPU benchmark was run.

**Commit:** `0a09d3ad852a1717cde5ba03e266fad0c6aac9fe`
