All work is committed on `t3b-ds-x/irwb-030-h`. Summary below.

## Ticket, design, report

- Ticket: `ttmp/2026/11/27/IRWB-030-H--fusion-that-is-never-slower-parallel-terms-serial-fold-a-cost-gate/` (`index.md`, `tasks.md`, `changelog.md`)
- Design: `design-doc/01-fusion-that-is-never-slower-parallel-terms-serial-fold-a-cost-gate.md` (committed first, at `9e3e78a`; "As built" section added later)
- Report: `reference/02-report-fusion-that-is-never-slower.md`; diary: `reference/01-implementation-diary.md`; every probe/benchmark and its output in `scripts/01`…`12`

## How terms are staged

In block mode a row-scalar member's `reduce` moves out of thread 0's loop: the whole block computes one term per lane-and-stride into a term region of the row buffer (shared memory or the scratch area), a barrier, then the folding thread runs `for (t = 0; t < n; ++t) acc = __fadd_rn(acc, terms[t])` (start `+0`/`−∞`, `max_nan` for max). Term `t` is decoded in the meaning's lexicographic order with the same scalar code, so each term is the same rounded word and the fold keeps the same order — bit-identical by construction. `stageTerms(body)` decides from the IR: stage when a term has a division, a square root, a double transcendental, or a global read; keep serial otherwise. Refused with reasons in the plan: per-element reductions (rank above the block depth — attention's `score`/`out`), nested reductions, split (`blocks`/`tail`) bounds, thread-mode groups, and bodies no dearer than the staging. Price list (script 06, same program staged vs serial): load 1.00×, product 0.98×, div 1.96×, exp 31.6×, global read 1.03×, max fold 1.01×, two divides 43.5×.

## The fuse gate

Rule: a block-mode group whose longest row `L < 32` (one warp) keeps stage 2's lowering. Justified by script 03: at `L = 8` fusion loses 2.1–2.6×, at `L = 16` it is program-dependent (0.91× exp-bound, 1.53× traffic-bound), from `L = 32` on it wins 1.8–3.0×. It is deliberately conservative at `L = 16` (cost shown: `layernorm-short-rows` 0.410 gated vs 0.301 ungated). It is decided with the launch's shapes (`runTixCuda` derives them; `cudaSource({shapes})` too; `loweredTix` exposes the decision) and only ever selects one of the two exact, contract-checked lowerings.

## Kernel counts and GPU ms (median of 3 `benchmark` calls each, GB10)

| Program | Kernels fused/unfused | Fused | Unfused | Unfused÷fused |
|---|---:|---:|---:|---:|
| matmul | 1 / 1 | 0.218 | 0.213 | 0.98 † |
| softmax | 1 / 4 | 0.387 | 0.822 | 2.12 |
| layernorm | 1 / 4 | 0.198 | 0.474 | 2.39 |
| attention | 1 / 6 | 0.753 | 1.186 | 1.58 |
| mlp | 1 / 3 | 0.727 | 0.956 | 1.31 |
| conv2d | 1 / 1 | 0.166 | 0.182 | 1.10 † |
| **layernorm-inside** | 1 / 4 | **0.216** | 0.561 | 2.59 (was 0.573/0.569) |
| **attention-inside** | 1 / 5 | **1.413** | 1.486 | 1.05 |

† same bytes both ways — the gap is this shared machine's noise (repeat calls of one source: 0.165–0.182 for conv2d). All fused/unfused output digests equal. Only `layernorm-inside` stages terms (`mean`, `variance`); the four other fused corpus kernels are instruction-identical to before (`12-kernel-code-digests-base-vs-stage.json`), and the six `fuse: false` digests are unchanged.

## Framework and tool changes

**None** to `src/framework/` or `tools/cuda-remote.mjs` — nothing was needed (cross-kind output, typed scalar port, required correspondence and revision-keyed differential evidence all existed; the runner already keys builds by source content). Domain changes: `CudaKernel.terms` + `tensor.cuda-source`/`tensor.lower-cuda` at version 3, `LoweringOptions.shapes`, `loweredTix`, `stageTerms`/`fusionGate`/`groupRow`/`warpSize` in `src/tensor/fusion.ts`, staged-term emission in `cuda-source.ts`. Finding: a profitability decision has no place in a semantic contract — and a differential checks one subject artifact per case set, while a launch-dependent lowering is a family; both are reported, neither is patched.

Tests: 7 new local (`tests/tensor/fusion-terms.test.mjs`), 4 new GPU (`tests/tensor/fusion-terms-gpu.test.mjs`, incl. two reversed-term mutants rejected with coordinates), 12 random staged programs accepted as exact; existing `fusion-gpu` (5) and `cuda-gpu` (11) suites re-run green. Contract cost unchanged: 32–40 cases, ~2.5–3 s cold, 1–3 ms repeated.

**Last commit: `d2b8ab9`**
