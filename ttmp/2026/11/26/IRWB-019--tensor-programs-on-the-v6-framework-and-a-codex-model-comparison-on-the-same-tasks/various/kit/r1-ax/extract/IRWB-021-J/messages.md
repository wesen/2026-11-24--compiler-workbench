## 1

I’ll use the docmgr and diary skills to create IRWB-021-J. I’ll check the framework’s existing validation interfaces, then use them to distinguish what the rewrite proofs establish from what the f32 experiment must measure.

## 2

The framework’s rewrite and differential-contract tests passed on Node 24. Two details shape the design. Tix puts the output division inside `sum(j)`, so moving it needs its own checked rule. And eliminating the `N×N` tensors proves a storage saving, while total GPU traffic still depends on how often query tiles reread `k` and `v`.

## 3

The six-rule derivation is written. I checked its smallest partial-block example numerically: the correct fold returns `0.75`, dropping the old numerator’s rescaling gives `1`, and skipping the tail gives `0.5`. I’ll use that case in the design as a control, then validate the ticket and commit it.

## 4

[Ticket IRWB-021-J](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ax-irwb-021-j/ttmp/2026/11/26/IRWB-021-J--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ax-irwb-021-j/ttmp/2026/11/26/IRWB-021-J--deriving-streaming-attention-by-checked-rewrites/design-doc/01-from-materialized-scores-to-a-checked-streaming-fold.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-ax-irwb-021-j/ttmp/2026/11/26/IRWB-021-J--deriving-streaming-attention-by-checked-rewrites/reference/01-research-diary.md)

The design derives single-pass attention over the reals using six local rewrites. Each candidate also faces a numerical check against the original program evaluated in f64.

1. **Substitute pure producers** at their uses so scores and weights can be computed within a tile.
2. **Hoist the invariant divisor** out of the output sum, exposing the unnormalized numerator.
3. **Zip co-indexed sums** so one tuple reduction accumulates the normalizer and weighted values.
4. **Partition ordered reductions** into contiguous key blocks, including the final partial block.
5. **Recenter each block’s weights** at its own maximum, extracting one exponential scale shared by every component.
6. **Merge block summaries** at their common maximum, rescaling both normalizers and numerators before adding them.

All 38 focused framework tests passed. An f32 probe distinguished the correct fold (`0.75`) from a missing rescale (`1`) and a dropped tail (`0.5`). The GB10 timing and off-chip traffic thresholds remain experimental hypotheses.

**Commit** `699841a6f3a8541f55886dd7fe8747abdcd534fa`
