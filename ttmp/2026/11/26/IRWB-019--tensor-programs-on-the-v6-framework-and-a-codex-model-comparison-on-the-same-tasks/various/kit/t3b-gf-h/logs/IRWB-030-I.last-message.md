Stage IRWB-030-I is complete. Final summary:

## Paths
- **Ticket:** `ttmp/2026/11/27/IRWB-030-I--fusion-that-is-never-slower-parallel-terms-in-order-folds-and-a-fuse-decision/`
- **Design:** `design-doc/01-parallel-terms-in-order-folds-and-a-fuse-decision.md`
- **Report:** `reference/02-report-fusion-that-is-never-slower.md` (diary: `reference/01-implementation-diary.md`)
- **Scripts:** `scripts/01-baseline.mjs` … `07-staged-features.mjs`, all with outputs, all committed.

## How terms are staged
A staged reduction of a row-scalar member in a block-mode kernel runs a **term phase** block-wide before the member's element loop (the reduction's index space flattened in the meaning's order, thread `t` computes term `t` into a slice of one shared term pool — or the scratch fallback), then one barrier, then the reduce node **folds the slice in order** (`__fadd_rn`/`max_nan`, same ops, same order, same init as the inlined fold), so the bits cannot change. Decided from the IR: stage only in row-scalar members of multi-statement block groups, not nested in another reduction, all-`dim` extents, and **not a single-load body** — measured: staging a row-buffer copy is 3% slower, a global single load neutral, everything computed 1.1–2.8× faster (even through scratch). Refusals recorded per reduction. `fuse: false` is still stage 2 byte-for-byte.

## The fuse rule
`planFusion(fn, shapeValues?)`; `runTixCuda` passes the shape values derived from the inputs, `cudaSource`/`checkLowering` plan without them (stage 3 behaviour). A block-mode group stays unfused iff **no member folds a chain as long as the row** and **rows < 64**. Measured (script 02): fold-dominated groups (softmax, layernorm) never lose at any row count 1–4096 or row length 1K–1M — stage 3's feared few-rows case wins 2.8× for the fused kernel; row-phase groups (`tanh·exp` per element, trivial fold) lose 9.6× at 1 row, parity at ~32, win from 64 — with or without staged rows. Crossover 64 = one grid point above the measured parity zone.

## Kernel counts and times (median of 3 `benchmark` calls)
| Program | kernels fused/unfused | fused ms | unfused ms |
|---|---|---|---|
| matmul | 1/1 (same bytes) | 0.217 | 0.208 |
| softmax | 1/4 | **0.386** | 0.809 |
| layernorm | 1/4 (staged: `variance`) | **0.202** | 0.494 |
| attention | 1/6 | **0.754** | 1.046 |
| mlp | 1/3 | **0.725** | 0.939 |
| conv2d | 1/1 (same bytes) | 0.165 | 0.164 |
| layernorm-inside | 1/3 (staged: `mean`, `variance`) | **0.194** | 0.391 |
| attention-inside | 1/5 (nothing stages) | **1.412** | 1.525 |

Three-way (script 05): layernorm-inside — staged **0.198** / stage-3 inline folds 0.491 / unfused 0.391; layernorm 0.200/0.207/0.487; softmax, attention-inside, mlp staged == inline. All digests equal; fused, unfused, and the f32 interpreter word-equal at reduced sizes; reversed-fold mutant rejected.

## Framework and tool changes
**None** to `src/framework/` or `tools/cuda-remote.mjs`. Tensor-side: plan carries `terms`/`termRefusals`/`unfused`; `planFusion(fn, shapeValues?)`; `CudaIR` + `tensor.lower-cuda` version 3 with a per-kernel `terms` count. Finding (argued, not changed): the contracts layer can't carry a shape-parameterized plan (one artifact vs a multi-shape case set), so the gate lives in `runTixCuda` — both outcomes are independently checked exact lowerings.

## Commits
`196ed44` design → `e3300f0` staging + gate + tests → `2832f23` measured rules + scripts 02–05 → `62c211c` scripts 06–07 → `ba69878` report → **last commit `13013ed`**. Not pushed.
