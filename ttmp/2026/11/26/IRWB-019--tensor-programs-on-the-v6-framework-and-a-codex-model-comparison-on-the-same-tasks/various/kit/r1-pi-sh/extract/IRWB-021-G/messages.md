## 0

- [Ticket IRWB-021-G](ttmp/2026/11/26/IRWB-021-G--deriving-streaming-attention-by-checked-rewrites/index.md)
- [Research design](ttmp/2026/11/26/IRWB-021-G--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- [Diary](ttmp/2026/11/26/IRWB-021-G--deriving-streaming-attention-by-checked-rewrites/reference/01-diary.md)

1. **Extract the invariant divisor:** Move row normalization outside the weighted sum.
2. **Lift centered aggregates:** Replace the row maximum, normalizer, and weighted sum with one structured fold.
3. **Partition the fold:** Group keys into consecutive tiles and merge their summaries in order.
4. **Expand each tile summary:** Compute tile-local maxima and weighted sums while retaining the running rescale.
5. **Sink producers and erase dead tensors:** Compute scores and weights inside each tile without materializing full matrices.

`docmgr doctor` passed. No compiler implementation or GPU benchmark was run.

Commit: `043b97b79efa8c4f1475a9b2bd701236f9ef32b3` (not pushed).
