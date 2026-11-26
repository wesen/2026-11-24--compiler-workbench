---
Title: Direct CUDA emission and batched lowering checks
Ticket: IRWB-022-E
Status: review
Topics:
    - compiler
    - ir
    - verification
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: Cross-kind typed transformation and acceptance
    - Path: repo://src/framework/contracts/differential.ts
      Note: Async batch delegation and evidence reuse
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Same-kind pass boundary considered but not extended
    - Path: repo://tools/cuda-remote.mjs
      Note: Remote transport and proposed change ledger
    - Path: repo://ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md
      Note: Stage 1 numerical semantics and rewrite rules
    - Path: repo://ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/02-report.md
      Note: Stage 1 outcomes and framework finding
ExternalSources: []
Summary: Direct emission from current Tix IR, checked against origin f64 by a batched GB10 run.
LastUpdated: 2026-11-26T15:14:00-05:00
WhatFor: Review before implementing the Tix CUDA backend.
WhenToUse: Implementing, testing, or evaluating Stage 2.
---

# Direct CUDA emission and batched lowering checks

**Proposal.** Emit CUDA C directly from the selected function in `program.current`. Use a v6 transformation with a terminal *source artifact*, not a second kernel IR. The pass executes a batch of cases on `manuel@bling` and checks against the stage-1 **origin f64** interpreter. The GB10 probe below rules out exact f32 for the chosen intrinsics and supports using the stage-1 tolerance as a sampled budget. No framework edits are proposed. The remote tool needs to separate compilation from runtime data. This revision incorporates the review in full.

## Domain and public entry points

Lower any selected function in a checked Tix module, including read-only functions returning an input and current revisions after `inline` and `split-sum`. Use the existing Tix calling domain: exactly the named inputs with finite `Float32Array` values, positive rank, consistent concrete nonnegative shapes, direct shape bindings and in-bounds reads. Shape/address arithmetic must be exactly representable as in Tix, and sizes, buffers and one-dimensional launch grids must fit the host and target. Zero extents are valid. Checked source rules do not change; consistency of concrete input shapes is checked when they are supplied. The supported execution target is a configured GB10/CUDA 13.0 host with the tool's `sm_121` build profile.

- `cudaSource(program, fn)` emits the complete, deterministic translation unit without network access.
- `runTixCuda(program, fn, inputs, {host}?)` runs that same unit with one caller-supplied case; returns `{shape, data: Float32Array, gpuMs}`. It does not run a sampled contract on each caller input.
- `checkLowering(program, fn)` runs the checked pass on a deterministic suite and returns `{accepted, relation: 'tolerance', reason?}`. Only this path claims semantic acceptance. Emitting source and running it diagnostically must remain possible before a check. Stage-1 APIs stay synchronous and unchanged.

## Lowering and execution

Tix already describes the loop bodies, ordered axes, affinities and dependencies needed here. Another editable kernel IR would duplicate the grouping and extent machinery without a target-side rewrite to run. The terminal output of the pass is a `defineIR`/`createArtifact` payload such as `{fn, source, abiVersion, buildProfile}`. It carries the exact bytes executed; it has no kernel adapter and no graph of target instructions. Keep the emitter shared between the three public APIs.

1. Allocate generated identifiers for tensors, shape symbols, binder IDs, temporaries and kernels. Never splice source names or literal spelling into C tokens. The host binds shapes from direct axes and checks repeated/affine axes and byte sizes; it computes concrete tensor extents and uses those in launch metadata. Keep affine shape/index calculations and linear offsets in integer types, with checked host size calculations. Preserve the IR's affine coefficients and binder identities, including separate names for shadowed indices.
2. Emit one kernel for each **current** statement. Launch in statement order on one stream, using a fixed block size of 256 and a 64-bit flat thread index. Guard padding threads, then delinearize the flat index into the LHS axes from last to first. Load by row-major offsets, store once. Unconditionally materialize intermediate tensors as f32, except that a zero-size result has no launch or allocation. A function returning a parameter has no kernels if it has no statements; return the corresponding buffer, with `gpuMs = 0` when there are no launches.
3. Recursively emit explicitly grouped scalar computations and intra-thread reduction loops. Each reduction has its own accumulator, initialized to `+0` or `-∞`. First listed index is outermost; all loops count up from zero. `dim` bounds are ordinary integer extents. Generated `blocks` bounds use width 4 with integer quotient and optional remainder; `tail` uses `min(4, dim - 4*block)` for the bound block binder. A split keeps *two* independent folds and the substituted `4*block+lane` address; flattening it silently undoes the rewrite. No reduction is distributed across threads.
4. Use little-endian binary `inputs/cases.bin` and `out/results.bin` with an ABI version and case count. In parameter order each input has its dimensions then raw f32 words; results are in case order with concrete shape, event time and raw f32 words. The generated main knows the parameter ranks. Both sides validate framing, checked lengths, and result completeness. This preserves signed zero and nonfinite **outputs** without JSON conversion. One main handles one or many shapes, with allocation lifetimes scoped to each case.
5. Before timing, initialize the CUDA context and call `cudaFuncGetAttributes` for each kernel that will launch, so CUDA 13's lazy module load is outside the event span, even in a one-case process. Allocate, transfer and create events before recording the start event. The reviewer's GB10 probe measured 0.115 ms on the first launch and 0.003 ms on the second, versus 0.004 ms on the first after `cudaFuncGetAttributes`; an event pair alone is insufficient. Record the stop in the same stream after the final launch and synchronize on it before reading elapsed time. Copy back and write files after the stop. No per-statement synchronization is necessary. Use `--timed` only in the benchmark, not in `runTixCuda` or the contract.

### Floating-point decisions

Build as `nvcc -O3 -arch=sm_121` with default IEEE denormal handling (no `--use_fast_math` and no `--ftz=true`). Emit `__fadd_rn`, `__fsub_rn`, `__fmul_rn`, `__fdiv_rn`, use the same `__fadd_rn` for accumulation, and express each intermediate separately. Explicit rounding intrinsics prevent a multiply from contracting with the next add, while keeping the tool's default flags. Use sign negation for unary minus, `__fsqrt_rn` for sqrt, and `expf`, `logf`, `tanhf` (not CUDA fast approximations). Round literals on the JS emitter with the same `Math.fround(Number(text))` as stage 1 and emit the bits via `__uint_as_float`; convert integer shape values with `__ll2float_rn`. Implement min/max by comparisons with explicit NaN propagation and signed-zero selection (OR of sign bits for min, AND for max at a zero tie). CUDA `fminf`/`fmaxf` alone may discard a NaN that JS propagates. NaN payload identity is not a requirement of the chosen relation.

## GB10 design probe and the acceptance relation

[Probe driver](../scripts/02-fp-probe.mjs) runs [hand-written CUDA](../scripts/01-fp-probe.cu) through the unmodified remote tool. `manuel@bling`, NVIDIA GB10 `sm_121`, nvcc 13.0.88, driver 580.178.04, Node v24.18.0. The input is 8,192 deterministic pairs, f32-rounded from `[-4,4]` and `[0.25,4]`; the first components also form eight softmax rows of width 1,024. Softmax runs four kernels with a sequential max and sum. The probe compares every output to the JS f32 and f64 computations on the same input bits. See the [diary](../reference/01-implementation-diary.md) for the command and edge witnesses.

| Output (8,192 values each) | Bit mismatches vs JS f32 | Largest fraction of f64 error budget |
| --- | ---: | ---: |
| Add, subtract, multiply, divide (each) | 0 | ≤0.002903 |
| Negate, min, max (each) | 0 | 0 |
| Sqrt | 0 | 0.002635 |
| Exp | 2,467 | 0.006549 |
| Log | 721 | 0.003354 |
| Tanh | 1,258 | 0.006404 |
| Softmax | 3,451 | 0.002569 |

For example, `expf(0.10959365218877792)` yields `0x3f8ed356`; `Math.fround(Math.exp(...))` yields `0x3f8ed357`. Exact would require a different libm strategy and evidence of equivalence to JS, not just disabling FMA or testing reductions. The less costly alternative is the stage-1 budget: for every finite origin f64 output `r`, require finite `g` and `abs(g-r) <= 2e-6 + 2e-5 * abs(r)`. Absolute slack handles cancellation around zero. The scalar and 1,024-term softmax probes use less than 0.66% of their budget; this supports adopting the existing budget for sampled checks, not a guarantee about all inputs or deep compositions. Report measured corpus errors after implementation rather than adjusting the budget to make a particular program pass. The probe also witnessed `expf(89)` overflow while f64 `exp(89)` is finite; a sampled case producing that output must reject even when it is a faithful f32 lowering. If `r` is nonfinite, require the same infinity sign or NaN class, not a numerical tolerance on that cell. Exercise signed zero, nonfinite propagation and subnormal bits independently in GPU regression tests.

The reference is `program.origin`, so a split cannot spend the tolerance once at the rewrite and again at lowering. Evaluate with the existing f64 evaluator on the exact finite f32 inputs shipped to the GPU. For optimized targeted tests also compare to the **current f32** interpreter or an independent oracle: the seven-element split witness distinguishes flattening by bits even though both answers are within tolerance of the origin. A pass verdict is sampled evidence, not universal semantic equivalence.

## Checked pass, batching, and reuse

**Use existing v6 contracts.** Define `tensor.lower-cuda` as a versioned `defineTransformation`: Tix current and origin artifacts plus function and target/configuration inputs; output is the CUDA source artifact. The body only emits; an `ensures` invariant checks the emitted candidate. `AnalysisManager.execute` validates both artifact kinds, awaits the invariant and only accepts after verification. Use `cache: 'never'` for the transformation; no implicit pure network dependency or computational cache. Use `differential` with a delegated `decide` callback and the existing baseline/subject memo for semantic evidence. The [local framework probe](../scripts/03-contract-probe.mjs) accepted a cross-kind result, replayed the evidence in a fresh manager without a second batch, and rejected a changed result by running another batch.

| Framework location | Finding and proposed change |
| --- | --- |
| `passes/define-pass.ts` | **None.** `applyPass` is for same-representation revisions, eagerly opens an edit, and uses one adapter to prepare both artifacts; `applyNativePassSync` also assumes one adapter and cannot await a GPU. Widening either API or adding a CUDA adapter just to compute a diff would add structure that the terminal lowering does not consume. `defineTransformation` already represents this checked pass at the typed artifact boundary. This path does not promise graph writes or correspondence. |
| `contracts/differential.ts`, `contracts/analysis-manager.ts` | **None.** Async batch delegation plus revision/version keys and typed prepublication checks already work. Target identification, tensor observations, sampling bounds and in-flight coalescing are domain policy. |
| `core`, `ir`, `dataflow`, `strategy` | **None.** No new scheduling, analysis or graph-edit machinery is needed. |

- Generate cases from the selected origin signature, not the candidate. Reuse the stage-1 deterministic shape and data stream approach (seed 20; singleton, 3, 4, 7, mixed 3/5/7; signed, positive, half-ULP and signed-zero streams). Add feasible zero-extent assignments. Retain bounds of 4,096 elements per tensor and one million origin scalar/loop visits per case. Skip origin shapes outside the domain; reject if there is no eligible case. Count complete shape checks for empty results; report when these are the only observations. A candidate cannot reduce the set of cases. Case descriptors contain function, named bindings, stream and seed.
- `decide(inputs, cases, todo)` packs the missing cases in order into **one** remote program invocation for the function. Calling `runTixCuda` per case would be simpler but would pay for upload, process and CUDA startup per case. Compare reported shape, length and every element for each case. Report coordinate, values, allowance, and a replayable case on disagreement. A transport, compiler, CUDA or protocol failure aborts the batch without producing reusable verdicts or an accepted result; return a reason distinct from numerical disagreement. Do not mark failed runs inconclusive: the existing differential summary can report agreement with *some* inconclusive cases.
- The baseline key binds origin revision and selected function; the differential spec identity binds case generator, relation, seed, budget and baseline policy. Cases can carry precomputed origin f64 references, so this cache avoids redoing the CPU work as well. The subject key binds the emitted source artifact revision (including ABI and build profile) and configured host/compiler path, without querying the GPU. The existing memo retains a small process-local LRU of baseline groups. Assume a stable configured target for the life of a process; no persistent evidence or additional in-flight coalescing. A warm check needs no network request. The compile cache below is independent: reuse of an executable does not imply semantic agreement.

## Tool change ledger (proposed)

Keep all GPU work behind `tools/cuda-remote.mjs`. The tensor module awaits a child Node process running it and owns its local temp directory; the helper can keep its current synchronous internal subprocess model. No SSH in TypeScript. Keep legacy flags/JSON and the default `nvcc -O3 -arch=sm_121` behavior.

| Proposed tool change | Why it is needed; simplest alternative |
| --- | --- |
| Add an opt-in runtime-data directory excluded from the compile key (Tix uses `inputs/`). Hash framed compile paths/bytes, architecture/flags and compiler path/version; non-opted-in directories keep all their source/input files in the key. | Batch contents and benchmark inputs must not trigger recompilation of identical source. Keeping the old hash alone only reuses identical full input sets. Explicit opt-in avoids assuming an arbitrary file is not a compile input. |
| Use an isolated remote working directory per invocation, plus a versioned shared executable cache, a per-key build lock and atomic executable publication. Fetch from the exact run directory and clean up; report failed/missing fetches instead of permitting stale output. | Today's shared hash directory races on `prog` and `out/` even for identical invocations; excluding data from the key would expand that race. A lock across the whole copy/compile/run/fetch sequence would serialize independent cases and data transfer. |

No `--describe` query or untimed locking; preserve the tool's existing `--timed` behavior.

## Verification and measurements after review

1. Build the emitter, data codec and runner. Offline `tests/tensor/` exercises deterministic emission, identifiers, binder scopes and split bounds, output decoding, and a fake batch runner for case mapping, cold/warm counts and incomplete-result rejection. Do not change the stage-1 evaluator's behavior.
2. Put real GPU tests in a separate file; run it explicitly. Check all six small corpus cases; include rectangular and affine indexing, nested shadowing, multi-binder order, returning a parameter, zero output extent and empty sum/max, subnormals, signed zero, and exp/log/sqrt/tanh/min/max. Exercise both optimized revisions with targeted witnesses. Run a deliberately wrong CUDA candidate (e.g. wrong affine stride or omitted sum tail) through the same invariant and require rejection. Check warm reuse, batch count and changed-candidate invalidation; assert that changing only runtime files reuses compilation and yields different output. Validate with `npm run build` and explicit tensor test files. Do not run the full suite.
3. Benchmark the **unoptimized** corpus, with a deterministic seed, parameter-specific inputs (including positive epsilon for layernorm) and identical bits/order on both machines. Use one small untimed correctness run first. Time full-size f32 `runTix` with `performance.now()` around the call, excluding generation and compilation; use a small warm-up locally and keep the number of full-size interpreter runs low. On the GPU, preallocate and upload, run one warm-up, then a short group of repetitions of the entire function under `--timed`; record CUDA-event median and range, excluding transfers, warm-up and compile/start-up. Keep remote lock duration short. Record host versions, exact sizes, repetitions, and interpreter/GPU time side by side. Check correctness and the tolerance on the sampled cases; do not add full-size interpreter validation runs.

| Corpus function | Shape bindings for timing |
| --- | --- |
| matmul | `M=K=N=512` |
| softmax | `N=4096, C=1024` |
| layernorm | `N=4096, D=1024` |
| attention | `Q=K=1024, D=V=64` |
| mlp | `N=1024, D=O=256, H=1024` |
| conv2d | `N=8, C=16, H=W=64, O=32`, kernel `3×3` |

The reviewer also reported that on the stage-1 tolerance cases the original and optimized f32 corpus computations used at most 25% of the existing budget. Later-stage optimization work is out of scope.
