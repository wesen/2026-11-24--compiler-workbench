---
Title: Implementation diary
Ticket: IRWB-029-E
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of IRWB-029-E (checked fusion), with probes, failures and measurements.
LastUpdated: 2026-11-26T23:13:20.274273169-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

The request is the stage-3 brief (IRWB-029-E: checked fusion), given once at the start of the session; it is summarised in the report's first section and not repeated here. Scripts are in `scripts/`, numbered in the order written. Times are CUDA event times on the GB10 unless a line says wall time.

## Step 1: reading, and a record of the base

I read the stage-1 and stage-2 designs and reports, the contracts and IR READMEs, `define-pass.ts`, and all of `src/tensor/`. Two facts shaped the rest: the parser gives every binder of a function a unique id (so substitution cannot capture), and `tensor.lower-cuda` is a `defineTransformation` whose only check is the differential GPU invariant.

Before changing code I recorded the sha256 of stage 2's source for the corpus (as compiled and after `inline` + `split-sum`) and four small programs: `scripts/01-snapshot-stage2-sources.mjs` → `tests/tensor/fixtures/stage2-sources.json`. That is the evidence for "`fuse: false` is unchanged".

## Step 2: probes before the design (02 to 05)

All on softmax N = 4096, C = 1024, hand-written CUDA, median of three after a warm-up.

- **02, one row per block, row staged in shared memory.** Bit-identical to stage 2's four kernels in all 24 configurations. Stage 2: 0.81 ms. Fused: best 0.43 ms (64 threads, `e` written over `x`); two buffers at 64 threads: 0.61 ms; 256 threads: 0.94 ms; 1024 threads: 3.4 ms. Spilling the staged rows to global memory: 0.52 ms at 64 threads.
- **Wrong expectation.** I expected the brief's 4.25×. The time grew with threads per block, so I guessed the single-lane folds were the bound and tried several rows per block, lane `r` of the first warp folding row `r`.
- **03, R rows per block.** No gain: best per R is 0.46 (R=1), 0.45 (2), 0.44 (4), 0.44 (8), 0.50 (11) ms. A row pitch of 1 mod 32 (no bank conflicts in the fold) changes nothing measurable at R ≤ 4 and gives 5 to 8% at R = 8 and 11. Also: a launch accepts 49152 bytes of dynamic shared memory and refuses 49156 (with no static `__shared__` variables; probe 02's two static floats made 49152 fail).
- **04, phase costs.** Stage 2's kernels alone: m 0.113, e 0.369, s 0.115, y 0.139 ms. In the fused kernel (R=1, 64 threads) cut off after each phase: stage 0.025, +max fold 0.27, +exp 0.41, +sum fold 0.42, +divide 0.46. The max fold cost ten times the sum fold.
- **05, the max fold.** `minmax` has `isnan(a) || isnan(b)` branches. The same step written with selects (and a variant with a NaN flag) gives the same bits on rows with NaN, ±0 ties and infinities, and 0.49 → 0.41 ms at 128 threads, 0.465 → 0.427 at 64.

Conclusion: one row per block, small blocks, a select-form max step in row kernels, and the floor is the double-precision `exp` (about 0.2 ms of compute beside 0.14 ms of traffic), not the folds.

## Step 3: design

`design-doc/01-…`: fusion is a kernel plan artifact whose validator is the legality check; two fusions (inline at an injective top-level read; rows). Committed as 840c36d with the probes.

Decision worth recording: I first planned a windowed scheme for rows longer than shared memory (stage a window, fold it, move on), then a hard error, and settled on one pointer: the staged area is shared memory or the row's slice of a global scratch buffer. One kernel, one code path, no size refused.

## Step 4: implementation

- `src/tensor/kernels.ts`: `KernelPlan`, `KernelIR` (validator = legality), `planKernels`, `unfusedPlan`, `expandStatements`.
- `src/tensor/cuda-source.ts`: `emitPlan` prints a plan; `emitCuda(fn)` is the unfused plan's text. The expression emitter is shared by both mappings; it takes an index environment and a `place` hook that says where a load reads from.
- `src/tensor/cuda-contract.ts`: `tensor.lower-cuda` gets a `fuse` input, a `plan` output and a correspondence requirement; the invariant runs a second batch with `--spill` when the source has the switch.
- `src/tensor/contract.ts`: long-row cases for the GPU check. `src/tensor/cuda-runtime.ts`: `spill` option. `src/tensor/index.ts`: `fuse`, `benchmark`, `kernelPlan`.

What went wrong:
- **Stage-2 text differed** after the rewrite: stage 2 names the statement axes from the last to the first (`i0` is the last axis). Found by diffing against a build of the base in the scratch directory; fixed by naming in that order. The hash test then passed.
- `TixIR.validate` is typed as an assertion function and cannot be called through a destructured name (TS2775); bound it to a typed local.
- First GPU run: softmax fused accepted exact at the first attempt, then all six corpus programs, as compiled and optimized, fused and unfused (`scripts/07`). Commit 289e03c.

## Step 5: benchmarks, threads per block, and where the time is

`scripts/08-benchmark-fusion.mjs --threads 32,64,256,512` (default then 128), ms:

| | unfused | 32 | 64 | 128 | 256 | 512 |
|---|---|---|---|---|---|---|
| softmax | 0.80 | 0.444 | 0.388, 0.387, 0.391 | 0.419, 0.417, 0.421 | 0.628, 0.631, 0.623 | 1.09 |
| layernorm | 0.47 | 0.213 | 0.211, 0.212, 0.203 | 0.196, 0.200, 0.193 | 0.229, 0.217, 0.223 | 0.346 |
| attention | 1.05 | 0.833 | 0.762, 0.761, 0.766 | 0.776, 0.778, 0.775 | 0.775, 0.815, 0.775 | 1.04 |
| mlp | 0.91 to 0.95 | 0.994 | 0.855, 0.869, 0.839 | 0.988, 1.134, 0.984 | 0.834, 0.861, 0.824 | 0.806, 0.804, 0.802 |

64 chosen. The fused and unfused outputs have the same sha256 at full size for all six programs.

`scripts/12-prefix-times.mjs` (the program cut after each statement): attention through `score` alone is 0.62 ms unfused and 0.65 ms fused, of 1.05 and 0.76 for the whole function. `score[i,j] = sum(d) q[i,d] * k[j,d]` has each thread walk its own row of `k`, so a warp's loads are 256 bytes apart. Fusion does not touch that. mlp: `h` 0.44 ms, through `g` 0.55 (unfused) and 0.46 (fused), whole 0.99 and 0.87: two contractions of 268 M multiply-adds each, at matmul's rate.

## Step 6: tests

`tests/tensor/fusion.test.mjs` (no GPU) and `tests/tensor/fusion-gpu.test.mjs`. `tests/tensor/cuda.test.mjs` asserted two kernels for a two-statement chain by default; it now passes `fuse: false` for that, and the fused count is in the new file.

What went wrong:
- The random generator seeded an LCG with the seed itself; seeds 1 to 200 all gave three statements. Seed is now multiplied by 2654435761 first.
- `Error: 1:56 Inconsistent extent` for a stencil `y[i]:f32[N-1] = z[i] + z[i+1]`: both reads must infer the same extent. Replaced the example with a broadcast.
- My expectation for `m; e; y[i,j] = e[j,i] * m[i]` was a row kernel `{m, e}`. The planner inlines `e` into `y` first (a transposed read is one element per element), after which `y` reads `m` in another row. Two kernels either way; the test now states what happens.
- The "stride" mutant (a `break` after a thread's first element) was reported on `shapeValues [67,2]`, which I read as N = 67. `scripts/09` showed the mutant is right on N=67, C=2 and wrong on all 134 elements of N=2, C=67: shape values are in the symbols' sorted order (C, N). The test's pattern was wrong, not the contract.
- Six concurrent `checkLowering` calls: `kex_exchange_identification: read: Connection reset by peer`. Each check opens several ssh connections and the fused one runs two batches. Three at a time passes.
- **Planner change:** "every statement reads an earlier one" was in the legality function. It is a choice, not legality, and it refused `a[i] = sum…; b[i] = sum…; y[i,j] = … a[i] … b[i]`. The validator now has the two legality rules; the planner requires the run to be connected by reads and drops a tail until it is.

## Step 7: a race found by reading the emitted code

The emitter wrote `__syncthreads()` only after a step that stored a value in the block. A step that only writes global memory can still read a staged row at another position, and the next step may reuse that slot: a fast thread would overwrite what a slow thread still reads. No test had failed. Now every step but the last ends with a barrier; `fusion-gpu.test.mjs` has the program (`p[i,j] = x[i,j+1] - m[i]` read only outside the kernel, then `q` taking `x`'s slot) and asserts the barrier count and the bits at M = 500.

## Step 8: sweep and final measurements

- `scripts/10-random-sweep.mjs 100 60`: 60 random programs, as compiled and after `inline` + `split-sum`: 120 checks, 0 rejected; 246 kernels unfused, 137 fused. (Run before the barrier change; the GPU test's 24 programs ran after it.)
- `scripts/08-results.jsonl`: three benchmark runs of the corpus, and one with the f32 meaning computed in JS for softmax and layernorm (same sha256 as both lowerings).
- `scripts/11-global-bytes.mjs`: bytes per kernel. `scripts/13-results.jsonl`: contract cost.
- Final test runs: the five non-GPU tensor test files, 29 pass; `fusion-gpu` and `cuda-gpu`, see the report.

## Review notes

- Start with `src/tensor/kernels.ts` (`inlineRefusal`, `rowRefusal`, `validatePlan`): that is the whole legality argument.
- Then `emitRow` in `src/tensor/cuda-source.ts`: staging, slot reuse, barriers.
- `node ttmp/…/scripts/06-show-plan.mjs softmax --source` prints a plan and its kernel.
