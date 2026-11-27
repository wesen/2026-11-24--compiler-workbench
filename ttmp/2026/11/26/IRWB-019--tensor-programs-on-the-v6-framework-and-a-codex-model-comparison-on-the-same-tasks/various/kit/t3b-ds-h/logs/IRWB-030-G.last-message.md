Stage 3b is implemented, checked on the GB10, measured, and written up. Summary:

## Ticket, design, report
- Ticket: `ttmp/2026/11/27/IRWB-030-G--fusion-that-is-never-slower-parallel-terms-and-a-cost-gate/` (index, changelog, tasks, `scripts/01`–`14` with their outputs)
- Design: `design-doc/01-fusion-that-is-never-slower-parallel-terms-and-a-cost-gate.md`
- Report: `reference/02-report-fusion-that-is-never-slower.md`; diary: `reference/01-implementation-diary.md`

## How terms are staged
`planFusion` decides from the Tix IR (`planTerms`) which reductions of a **row-scalar member in a block-mode group** stage their terms: the block writes one term per thread into a term array appended to the same row buffer (`a0 = r_last + n_last` in shared memory, or the per-block global scratch), a barrier, then **thread 0 folds the array in the meaning's order** via a counter. Same body code, same rounding, fold order preserved → bit-identical. Staged when the member has no axes beyond the block domain, the reduction is not inside another, its axes give a flat position (one axis of any kind, or several plain dims — `sum(j) x/D` becomes `ceil(D/4)` terms after `split-sum`), and the body has a division, a transcendental or an inner reduction. Refused with reasons: reductions of row members (per-element arrays), bodies with no costly op (13% slower on layernorm when forced), multi-axis with a generated axis.

## The rule
A block-mode group stays fused only if its block puts **≥ one warp (32 lanes)** to work, measured as the wider of its rows and its staged term arrays. Below that it becomes stage 2's kernels, one per statement (`FusionPlan.gate` records the width and reason). Justified by the measured crossover: stage 3's fused 4/8/16/32/64-element rows = 1.469/0.736/0.372/0.188/0.189 ms against stage 2's 0.298/0.282/0.330/0.329/0.296 — the crossover is between 16 and 32 and 32 is the warp. Not too conservative: ungated is 7.5×/1.9× worse than stage 2 on 4/16-element rows. Width must include term arrays (rows of 8 with 1024 staged terms: fused 0.047 vs 0.117 ms). Values come from `runTixCuda`'s inputs; without values (as in `checkLowering`) the plan is stage 3's.

## Kernels and times (5 `benchmark` calls, medians, fused / unfused)
matmul 1/1 0.2136/0.2138 · softmax 1/4 0.3866/0.8200 · layernorm 1/4 0.1977/0.4777 · attention 1/6 0.7531/1.0500 · mlp 1/3 0.7256/0.9502 · conv2d 1/1 0.1659/0.1662 · **layernorm-inside 1/4 0.2623/0.5716** (was 0.578/0.542) · **attention-inside 1/5 1.4123/1.4866**; also `s = sum(j) exp(...)` 1/3 0.7479/1.6308 (was 12.41/1.62). All 28 cases fused ≡ unfused word for word. Parallel terms per block-mode kernel: layernorm-inside `mean:sum(D)`, `variance:sum(D)`; exp-in-sum `s:sum(C)`; longterm `s:sum(D)`; everything else stays serial (bodies are loads/products).

## Framework/tool changes
None to `src/framework/` and none to `tools/cuda-remote.mjs`; the report records one framework observation (a shape-values port would let the contract check the gated lowering) as Later. Domain changes: `fusion.ts` (planTerms, termArrays, blockWidth, warp, `planFusion(fn, sizes?)`, `gate`), `cuda-source.ts` (term arrays, staged fold, index naming fixed from `indices.size` to a counter), `index.ts` (`sizes`, planned from inputs). Tests: 39 local, 21 on the GB10 (incl. 4 mutants, 48 random lowerings, gated source as a supplied candidate); `fuse: false` still byte-identical to stage 2.

Last commit: **801343e**
