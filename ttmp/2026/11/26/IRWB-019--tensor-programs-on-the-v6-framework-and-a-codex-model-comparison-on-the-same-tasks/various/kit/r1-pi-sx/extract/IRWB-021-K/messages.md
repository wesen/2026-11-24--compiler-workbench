## 0

- [Ticket IRWB-021-K](ttmp/2026/11/26/IRWB-021-K--deriving-streaming-attention-by-checked-rewrites/index.md)
- [Research design](ttmp/2026/11/26/IRWB-021-K--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md)
- [Diary](ttmp/2026/11/26/IRWB-021-K--deriving-streaming-attention-by-checked-rewrites/analysis/01-diary.md)

**Rewrite rules**
1. Factor the invariant normalizer out of the output sum.
2. Zip the normalizer and weighted-output sums into one product-state fold.
3. Partition the max and additive folds into ordered tiles.
4. Recenter each tile at its local maximum and factor out the rescaling.
5. Merge maxima and rescaled sums in one streaming fold.
6. Fuse score production into the tile body and remove unused global tensors.

Documentation checks passed. No implementation or GPU measurements were made.

Commit: `2ceb2494be02f5558337532b22b4cb2d1cfef538`
