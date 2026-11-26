## 1

I’ll use the docmgr and diary skills to create IRWB-021-I, inspect the framework’s checking interfaces, and write and commit the research design.

## 2

The Tix grammar puts `/ l[i]` inside the output reduction and `/ sqrt(D)` inside the score reduction. The design will check the first move against the f64 reference and preserve the score expression as written. I’ll also distinguish eliminating the quadratic intermediates from reducing measured GPU memory traffic.

## 3

The draft now traces all four rewrites through the tiled fold. The Node probes confirmed that hoisting the division and regrouping the sums can change f32 results. I’ll validate the ticket and its links before committing.

## 4

[IRWB-021-I ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sx-irwb-021-i/ttmp/2026/11/26/IRWB-021-I--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sx-irwb-021-i/ttmp/2026/11/26/IRWB-021-I--deriving-streaming-attention-by-checked-rewrites/design-doc/01-deriving-streaming-attention-by-checked-rewrites.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sx-irwb-021-i/ttmp/2026/11/26/IRWB-021-I--deriving-streaming-attention-by-checked-rewrites/reference/01-diary.md)

1. **Hoist invariant division.** Move the row normalizer outside the weighted sum.
2. **Zip the weighted sums.** Accumulate the normalizer and vector numerator in one ordered fold, preserving each accumulator’s f32 evaluation.
3. **Use maximum-relative summaries.** Replace the global maximum and weight tensors with running state that rescales both sums when the maximum rises.
4. **Tile the summary fold.** Summarize contiguous key blocks and merge them in order, keeping scores and weights in tile-local scratch.

The design uses bounded f32 inputs and a fixed tolerance against the original f64 program. Ticket validation passed. The GB10 experiment remains unrun.

Committed locally as `4ca97c98d94260de7aea34e37d1015f2abebe506`.
