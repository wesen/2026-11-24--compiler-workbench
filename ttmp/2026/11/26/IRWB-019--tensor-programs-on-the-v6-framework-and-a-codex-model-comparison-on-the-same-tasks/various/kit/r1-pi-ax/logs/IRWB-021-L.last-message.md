**IRWB-021-L — Deriving streaming attention by checked rewrites**  
[Ticket](ttmp/2026/11/26/IRWB-021-L--deriving-streaming-attention-by-checked-rewrites/index.md) · [Design](ttmp/2026/11/26/IRWB-021-L--deriving-streaming-attention-by-checked-rewrites/design-doc/01-from-dense-softmax-to-a-checked-block-fold.md) · [Diary](ttmp/2026/11/26/IRWB-021-L--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

1. **Substitute** pure tensor definitions at their uses, preserving index bindings and arithmetic order.
2. **Extract** the row normalizer from the output sum, dividing the numerator once.
3. **Zip** the normalizer and weighted-value sums into one tuple reduction.
4. **Partition** the key index into disjoint blocks with explicit reduction trees.
5. **Rebase** each block’s exponential weights at its own maximum, factoring out one scale.
6. **Merge** block summaries by rescaling both normalizers and numerators to the larger maximum.
7. **Stream** each block directly into the running state, retaining only tile-local scores.

The design separates exact real identities from sampled f32 checks against the original program’s f64 reference. `docmgr doctor` passed. No kernel was implemented or benchmarked.

**Commit:** `4a4a6b082a47620ae757b2cc4a6f368aa7a6f247`
