---
Title: 'Report: a schedule IR and exact tiled contractions'
Ticket: IRWB-033-F
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, the tile and double-buffer passes, the order analysis and property, the strategy
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter prints schedules; adds the tiled contraction kernel
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The lowering transformation v3, with the schedule output port and its correspondence
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyNativePassSync checks preserves by synchronous recomputation
ExternalSources: []
Summary: Tix -> schedule IR -> CUDA; tile-contraction and double-buffer as checked v6 passes; matmul exact and 2.9x faster at 512^3 (0.076 ms), 7x at 4096^3 (19.0 ms); every other corpus program byte-identical to the base; one framework change (sync preservation).
LastUpdated: 2026-11-27T15:00:00-05:00
WhatFor: Final report of stage 6 (IRWB-033-F)
WhenToUse: Reviewing the schedule IR, its passes and checks, what was measured, and what the framework needed
---

# Report: a schedule IR and exact tiled contractions

Stage 3's lowering computed a contraction with one thread per output element, two global loads per multiply-add. Stage 6 makes the lowering a compiler — Tix → schedule IR → CUDA, the schedule edited only by checked passes, the emitter printing it — and runs contractions through tiles, shared-memory staging and register patches without changing a single result bit. Matmul at 512³ goes from 0.217 to **0.076 ms** (2.9×, 3.5 TFLOP/s against cuBLAS's 8.15, whose 0.0329 ms it now trails by 2.3× instead of 6.6×); at 4096³ from 134 to **19.0 ms** (7×, 7.2 TFLOP/s against cuBLAS's 19.2). Every other corpus program keeps its stage-3b kernel byte for byte (proven by digest against the base's emitter, script 04) and its time. The outputs are bit-identical to the f32 meaning everywhere measured, on both sides of every gate.

The code is at the last commit of branch `t6-g-h/irwb-033-f`.

## Results

Kernel count is `__global__` definitions in `cudaSource`. GPU time is the median of five interleaved `benchmark` calls per lowering (each already the median of three timed launches), under the runner's `--timed` lock, seed 20, inputs ±0.1. Base = commit `0f45d04` (the T3b merge); its numbers are IRWB-030-E script 13's table, measured with this protocol.

| Program (the brief's sizes) | Kernels fused / unfused | GPU ms fused | GPU ms unfused | Base fused | Fused / base |
| --- | ---: | ---: | ---: | ---: | ---: |
| matmul, M = K = N = 512 | 1 / 1 | **0.076** (0.075…0.076) | 0.214 | 0.217 | 0.35 |
| softmax, N = 4096, C = 1024 | 1 / 4 | **0.384** | 0.801 | 0.385 | 1.00 |
| layernorm, N = 4096, D = 1024 | 1 / 4 | **0.151** | 0.473 | 0.170 | 0.89 |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | **0.749** | 1.050 | 0.746 | 1.00 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | **0.625** | 0.945 | 0.627 | 1.00 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | **0.165** | 0.166 | 0.165 | 1.00 |
| matmul, M = K = N = 4096 | 1 / 1 | **19.03** | 133.8 | 133.8¹ | 0.14 |

¹ the base's fused and unfused matmul are the same kernel. In every call the fused and unfused outputs had the same SHA-256; at 512³ and at masked shapes they also equal the interpreter, word for word (scripts 01, 03; the GPU tests).

The fused sources of softmax, layernorm, attention, mlp and conv2d are **byte-identical to the base's** (script 04 bundles the base's emitter from `0f45d04` and compares SHA-256): the layernorm 0.89 is session variance on identical bytes, in the safe direction. The clock read after a 4096³ run was 2418 MHz — no thermal drift.

### The contractions

| Contraction | Fused / unfused (ms) | FLOPs | TFLOP/s fused² | cuBLAS (the two GEMMs) | cuBLAS / fused |
| --- | --- | ---: | ---: | ---: | ---: |
| matmul 512³ | 0.076 / 0.214 | 2·512³ | **3.5** | 0.0329 ms, 8.15 | 2.3× |
| matmul 4096³ | 19.03 / 133.8 | 2·4096³ | **7.2** | 19.2 TFLOP/s | 2.7× |
| attention's `score` + `out` (inside the fused kernel) | 0.749 / 1.050 (whole program) | 2·(2·Q·K·D) = 268 M | ≥ 0.36 (program-bound) | 0.0393 ms | — |
| mlp's `h` + `y` (inside the fused kernel) | 0.625 / 0.945 (whole program) | 2·(2·N·D·H + 2·N·H·O) = 1.07 G | ≥ 1.7 (program-bound) | 0.0898 ms | — |
| conv2d's `out` (the whole kernel) | 0.165 / 0.166 | 2·8·32·62²·16·9 = 282 M | **1.7** | not given | — |

² over the whole program's time where the contraction cannot be isolated (the reason the rates are lower bounds for attention and mlp: their kernels are dominated by the `exp` rows and the row phases, not the multiply-adds — stage 3's finding stands).

The contraction inside attention, mlp and conv2d is **the same code as stage 3b**: the tile pass refuses them, with the reason recorded (attention and mlp: a multi-statement group — tiling would restructure the fused kernel's block domain, kept for a later stage; conv2d: three reduction axes and affine reads, not a two-operand GEMM). What keeps them fast is that stages 3 and 3b are untouched. The measured headroom is real — mlp re-reads `w` and `v` (1 MiB each) once per row, 1 GiB of L2 traffic in total; several rows per block would divide it — and it is listed under Later with this number.

Variants the tile pass does cover, at 512³ (script 06): a bias epilogue 0.076/0.217, a `/ sqrt(K)` epilogue 0.080/0.216, a transposed first operand 0.078/0.263 — all ~3× faster fused, all exact.

## The schedule IR

**Value** (`src/tensor/schedule.ts`): `{ fn, statements, params, kernels, refusals }`. The statements are the algorithm, copied verbatim from the Tix IR and never edited; each kernel is a fusion group (stage 3's and 3b's constructs: mapping, rows, staged terms, in-place rows, the gate) plus an optional `tile` schedule. `ScheduleIR` is a `defineIR` (id `tensor.schedule`, v1) with a validator (config positivity, threads ≤ 1024, shared sizes within the opt-in limit, dispatch constants) and `entities(value)` = kernel names, so the manager checks the Tix→schedule correspondence's entity lists against both artifacts (the F23 machinery). A logical adapter (kernels, tensors, contains/computes/reads) serves the pass machinery's diffing and `writes` enforcement.

**Fusion feeds the schedule; it does not become passes.** `planFusion` stays a legality analysis on the Tix IR and its result is the initial schedule. *Alternative:* re-derive grouping as a pass on the schedule IR — it would duplicate a dataflow analysis that is a property of the Tix program, adding revisions without a check; the grouped schedule is still fully visible in the IR and still checked (the order property covers its reductions). The same argument keeps each stage-3b decision a construct rather than a pass.

**The tile schedule** names the reduction (axis and op), the two operand loads with their index patterns and classes (`i`, `j`, or `k`-only — covering matmul, transposed operands, and a k-vector operand), the configuration table, staging, unrolling, double buffering, and the launch rule's constants. Everything the emitter needs, and nothing it may choose.

## The passes

Scheduling steps are v6 passes on the schedule IR, applied with `applyNativePassSync`: each decides its legality from the IR before it is applied, declares `writes: { entities: ['kernel'] }`, returns the new native value, and preserves the schedule-order analysis. A rejected step keeps the previous revision and is recorded in the schedule's `refusals`.

1. **`tensor.tile-contraction`** (v1). Legality: a singleton kernel; exactly one reduction, one `dim` extent; the body exactly two plain-indexed loads multiplied; each load reading the reduction axis once and at most one output axis; rank-2 output. Refusals record the first failure (multi-statement groups, split-sum's nested extents, three factors, two reductions, affine reads, rank-1 outputs).
2. **`tensor.double-buffer`** (v1). Legal for a tiled kernel whose doubled operand tiles fit the opt-in shared limit. **The strategy does not pick it** (below).

Unrolling and the tile sizes are data of the tile schedule, not passes: unrolling a straight-line loop in order cannot change the fold order, and the sizes are picked per launch shape by the dispatch rule, not per program.

## What each step is checked against

- **`tensor.schedule-order`** (analysis): the canonical fold-order signature per kernel member statement and reduction — axes in fold order, the enumeration (`ascending`, or the chunk partition validated as an exact ascending cover of `[0, K)` on probe extents: empty, short, aligned, unaligned, multiple-chunk), one rounded product and one rounded fold per term. Each pass declares it under `preserves`; the machinery recomputes it before and after and rejects any change. A tile whose fold op or axis does not match the reduction it replaces is invalid outright.
- **`tensor.schedule-ordered`** (property): on the final schedule, every reduction of every member statement has exactly one record matching the algorithm's axes and op, and every enumeration is ascending. The lowering transformation ensures this property on its schedule output.
- **What this covers:** the order and rounding of every output element's accumulation, given one thread folds an element start to finish and staging copies bits. **What only the GPU check covers:** the emitter's realization — address arithmetic, masks, barriers, the dispatch rule, the epilogue — which is why `checkLowering` stays, and runs every case on both sides of every gate (`--gate=fused` forces tiles, `--gate=unfused` stage 2's mapping), including zero extents and shapes below one tile. Both the pass gates and the property are pure functions; the whole `cudaSource` pipeline (fusion plan, schedule artifact, two pass applications with their artifacts, hashes, diffing and correspondences, then emission) costs 1.4 to 1.7 ms per emit on the corpus (measured, 20 emits each), a few tenths of a millisecond more than the plan-plus-emit it replaced — the schedule artifact is `cache: 'never'` like the CUDA one, and the contract's cost is unchanged (its cases are the same; a gated matmul doubles to 72 runs in the same two batches as before).

## The emitter

`emitCuda` prints a schedule and decides nothing: singleton element kernels print stage 2's kernel (the `fuse: false` digests still hold), fused groups print stage 3/3b's kernel, and a tile kernel prints one `template <int Mode, int Dbl, int BM, int BN, int BK, int TM, int TN>` definition — Mode 1 is stage 2's element mapping, Mode 0 the tiled schedule, one instantiation per configuration, each launched with its own block shape and shared size. Per output element the fold is unchanged: k ascending, `__fmul_rn` then `__fadd_rn` (or `max.NaN.f32`), initial +0 or −∞, terms past the extent skipped, never folded with a zero. The layout around it: 64×128 (small grids) or 128×128 (large) output tiles per block with the i-tile axis major so consecutive blocks share the A panel in L2; a 4×4 or 8×8 register patch per thread (≤ 512 threads per block); the k axis in 32-wide ascending chunks; A-tiles staged row-major with stride BK+1 (patch rows spread over banks), B-tiles with 16-byte rows read as one `float4` per patch column; masked staging for shapes that are not tile multiples. The host picks at launch: below 32,768 output elements stage 2's mapping; otherwise the last configuration whose grid covers two device waves (script 06: this picks the better configuration at 512, 1024 and 4096, a tie at 2048; `runTixCuda` reports the side taken in `gates`).

## The strategy

`scheduleStrategy` is a pure function of the schedule: tile every legal contraction, and (in v1, no) double-buffer. Each step carries its reason; refusals land in the schedule artifact and its correspondence evidence. **`src/framework/strategy` does not fit, for three concrete reasons:** its interpreter is asynchronous while `cudaSource` is a fixed synchronous API; its plans are static JSON, so the per-program decision would be built by code before any plan exists, adding serialization and trace records to a pure function called on every emit; and its algorithms exchange JSON values, not artifacts and manager contexts, so the checked passes could not run as plan steps. What would make it fit — a synchronous, traceless execution mode over local algorithms — is under Later. The sequenced rule with recorded reasons is the part of a strategy plan that decides.

## New approaches tried, and what they gave

- **Order preservation proven from the IR, checked per step** (the `preserves` mechanism, above): every scheduling step is rejected the moment it would change a fold's order — tested with a lying pass (`preserveViolated`) and an op-swapped schedule (the property fails, the gate rejects).
- **A correspondence that follows the statements into the schedule** (`statements-to-schedule`, entity-checked against both artifacts): the schedule artifact names exactly the kernels the correspondence claims, and an invented kernel is rejected (tested).
- **Double buffering** (the second pass): measured across three sweep rounds — it doubles the block's shared memory, halves residency, and lost beyond noise at 512³ (0.0725 vs 0.0749) while costing 1.4-2.1× at 4096³ on every configuration. The pass stays legal and checked; the strategy does not pick it. A negative result, reported with its numbers.
- **Wide j-tiles at small sizes** (64×128 with a 4×4 patch): 8% over 64×64 at 512³; **an 8×8 patch at large sizes** (fewer shared loads per multiply-add): 9% at 4096³. These two are the shipped configuration table.
- **One wave per grid** (64×96 tiles = 48 blocks at 512): no gain beyond noise against 64×128 — the wider B-tile row, not wave quantization, is what mattered.

## Schedule choices refused

- **Tiling contractions inside fused row-mode kernels** (attention, mlp): the block's threads already cover the member's row; a tile would restructure the group's block domain. Kept at stage 3b's speed; the measured headroom (mlp's 1 GiB of L2 operand re-reads) is quantified above and listed for a later stage.
- **conv2d**: three reduction axes and affine reads — not a two-operand GEMM shape.
- **Rank-1 outputs** (matvec): the register patch is two-dimensional; the element mapping already reads two floats per multiply-add there.
- **1024-thread blocks** (256×128 tiles): one (256,128,16) configuration failed to launch outright ("too many resources requested"); the shipped table keeps ≤ 512 threads.
- **Vectorized global staging loads (float4 from DRAM)**: the A-tile's alignment depends on the runtime K; the staging loads are already coalesced. The `float4` that is shipped is the shared-memory read, whose alignment the schedule guarantees by construction (stride BN+4).
- **Double buffering**, by measurement (above). **Split-K, FMA contraction, tensor cores, autotuning**: not this stage's, and the tile schedule leaves room (the fold stays per element in one thread).

## Framework and tool changes

**One framework change.** `applyNativePassSync` (src/framework/passes/define-pass.ts) now checks `preserves` by recomputing each preserved analysis — required to declare no effects and not use the context — on both revisions and comparing canonical values, instead of rejecting any pass that declares preservation. Reason: `cudaSource` is a fixed synchronous API, so checked passes cannot go through the asynchronous `AnalysisManager`; the preservation claim is exactly the per-step order check this stage needs. `tests/framework/native-pass-sync.test.mjs` gained the three cases (a violated claim, a kept one, an effect-declaring analysis still refused). No other framework or tool file changed; everything else the stage needed — a second IR kind between transformations, an entity-enumerating `defineIR` for correspondence checking, native passes with gates, the differential's gate-aware case doubling — already existed.

Tensor-domain API: unchanged signatures. `tensor.lower-cuda` is v3 (a `schedule` output port, the order property on it, the `schedule` correspondence); `CudaIR` is v3 (mapping `'tile'`, tile configuration evidence); `planFusion` and stage 2's bytes are untouched.

## Measured, and only argued

**Measured on the GB10:** the results table and the contraction table (five interleaved `benchmark` calls each, digests compared in every call); the config sweep (three rounds, 28 configurations, each verified against the stage-2 lowering at a masked shape); the dispatch rule across four sizes with both configurations forced; the variants; the clock (2418 MHz after 4096³); exactness of the tiled matmul and five contraction variants at odd, tiny, empty and sub-tile shapes on both gate sides (scripts 01 and 06, `schedule-gpu.test.mjs`); `checkLowering` exact for matmul fused and unfused and for the other corpus programs; all existing GPU test files pass.

**Argued, not measured:** that the fold order holds for every program in the domain (the order argument plus the contract's samples — including every zero-extent and sub-tile shape on both gate sides, but samples nonetheless); that the fused row kernels are unchanged for every program (proven byte-identical on the corpus, argued elsewhere); the L2-traffic explanation of mlp's and attention's headroom (a count, not a profiler measurement).

## Later

- Several rows per block for fused row-mode contractions (attention, mlp): divides the L2 operand re-reads by the row count; needs row-scalar leadership and gate re-fitting.
- Batched and rank-1 contractions; conv2d's three-axis affine contraction.
- A synchronous, traceless execution mode for `src/framework/strategy`, so the schedule choice can be a framework strategy plan.
- An IR-level cost model: the launch rule's two constants are its first, fitted instance; a model would replace the fitted thresholds (the stage-3b finding, again).
- `cp.async` staging, split-K and tensor cores — all compatible with the tile schedule, all changing bits and so needing their own exactness argument.
