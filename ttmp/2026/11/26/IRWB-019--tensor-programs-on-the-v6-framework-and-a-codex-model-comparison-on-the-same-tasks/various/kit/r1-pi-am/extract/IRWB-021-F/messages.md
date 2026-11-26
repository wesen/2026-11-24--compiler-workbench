## 0

**Ticket:** [IRWB-021-F — Deriving streaming attention by checked rewrites](ttmp/2026/11/26/IRWB-021-F--deriving-streaming-attention-by-checked-rewrites/index.md)  
**Design:** [From stable softmax to a block summary](ttmp/2026/11/26/IRWB-021-F--deriving-streaming-attention-by-checked-rewrites/design-doc/01-from-stable-softmax-to-a-block-summary.md)

1. **Expose producers:** Inline pure tensor definitions without changing index bindings, reduction order, or score arithmetic.
2. **Extract the invariant divisor:** Move the row normalizer outside the weighted value sum.
3. **Pack common-range moments:** Accumulate the weight sum and weighted value sum together at the same row maximum.
4. **Split and rescale:** Merge adjacent summaries by rescaling both to their shared maximum before adding them.
5. **Tile and fold:** Visit key blocks in order, carry only the merged summary, and divide once at the end.

The derivation is exact over the reals. The design specifies separate f32 acceptance checks and a GB10 experiment; neither was run for this design-only ticket. `docmgr doctor` passed.

**Commit:** `0e7a88b`
