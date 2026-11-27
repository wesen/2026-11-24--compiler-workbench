---
Title: A schedule IR between Tix and CUDA, and exact tiled contractions
Ticket: IRWB-033-H
Status: active
Topics:
    - tensor
    - gpu
    - verification
    - compiler
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/strategy/sync.ts
      Note: Synchronous executor for sequence/apply strategy plans (the interpreter is async)
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The lowering transformation now runs Tix -> schedule -> CUDA and records the schedule
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emitter; after this stage it prints a schedule and decides nothing
    - Path: repo://src/tensor/schedule.ts
      Note: |-
        The schedule IR (v6 artifact), its adapter, its passes and the accumulation-order analysis
        The schedule IR
    - Path: repo://src/tensor/strategy.ts
      Note: The rule that picks a schedule, as a Strategy IR plan plus a cost model over the schedule
ExternalSources:
    - Yang, Riasanovsky, Deng and Sarkar, Taming Bitwise Behavior in GPU Kernels with Tensor Core
Summary: A second v6 IR between Tix and CUDA holds the layout decisions; tile, bind, patch and unroll are checked passes on it that preserve each output's accumulation order; a cost model picks the schedule; contractions become exact tiled kernels.
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: Design of stage 6 (IRWB-033-H) before implementation
WhenToUse: Reviewing why the compiler has a schedule IR, what its passes check, and how a schedule is chosen
---

# A schedule IR between Tix and CUDA, and exact tiled contractions

## Goal

Two results, one structural and one numeric.

- **Structural.** A second v6 artifact, the **schedule IR**, sits between Tix and CUDA: `Tix → schedule → CUDA source`. The schedule holds every layout decision the compilation makes — which statements share a kernel, how the block domain maps to blocks and threads, where a row lives, how a contraction's reduction tiles, how much of the output one thread owns — and each such decision is made by a **pass on the schedule IR**, with legality decided from the IR before the pass runs and a correspondence to the revision before it. The CUDA emitter prints a schedule and decides nothing.
- **Numeric.** A contraction `c[i,j] = sum(k) a[i,k]*b[k,j]` keeps every output's accumulation order — terms added one at a time in ascending `k`, product rounded then sum rounded, exactly as the f32 meaning says — and becomes a tiled kernel: operands in shared memory, several outputs per thread in registers. That is the only degree of freedom the meaning leaves, and it is worth about 3× on matmul 512³.

## Supported domain

Unchanged from stage 3b, because the schedule only replaces layouts the previous lowering already handled:

- any function of the checked Tix core (affine shapes and addresses, shadowed binders, generated `blocks`/`tail` extents from `split-sum`, empty extents, shapes that are not multiples of any tile, reductions over one or over several axes);
- the same call domain: consistent shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch;
- tiled contraction kernels are produced where a **tiling legality** (below) holds; everywhere else the schedule keeps the kernel the fusion plan asked for, byte for byte as stage 3b printed it. So no program loses a lowering it had.

Not in this stage, and left as room in the IR: anything that reassociates a reduction (split-K, parallel tree folds), FMA contraction, tensor cores, reduced precision, measured autotuning.

## Why a second IR, and what I considered instead

| Alternative | Why not |
| --- | --- |
| Keep decisions in the plan and the emitter (stage 3b) | That is what the brief asks to replace. Legality was per *group* and decided once; a choice such as "64 threads, rows in shared memory, gate at launch" was a C++ string built inside `emitGroup` and could not be inspected, changed or checked separately. Nothing could show that a change of layout keeps the bits. |
| Extend `FusionPlan` with layout fields | Cheaper: no new IR, no adapter, no passes. It gives no place for the *checks*: a plan is a record produced by one function, so a step is not applied to a revision and nothing compares before and after. The stage's point is that steps are checked one at a time. |
| A loop-nest IR with explicit loop levels (LLVM/Halide-style `For`/`Let`/`Store` nodes) | The most general, and the direction later stages want. It needs a builder, a printer and an order analysis over a general nest, and its legality rules subsume what tile/bind/patch/unroll need — three times the code for the same bit argument. The IR here names the *spaces and splits* and lets the emitter print the nest. A general nest is the natural successor (Later). |
| **Schedule as an algorithm + a list of kernel layouts (chosen)** | The algorithm (the Tix function) is carried verbatim in the artifact, so the schedule stands alone and the order analysis can compare the layout against the meaning. Each kernel's layout is a small record of named decisions. Passes rewrite that record; the order analysis and the Tix algorithm both live in the same artifact, so a pass's check is local. |

### The artifact

`src/tensor/schedule.ts`, `ScheduleIR` (`tensor.schedule`, version 1):

```ts
interface Splits { block: number; thread: number }     // factors of one output axis
interface Contraction {
  reduction: string;                                   // axis id
  tile: number;                                        // reduction tile in shared memory
  rows: Splits;                                        // block-domain axis 0 (i)
  cols: Splits;                                        // block-domain axis 1 (j)
  stage: 'shared';                                     // where both operand tiles live
  peelTail: boolean;                                   // full tiles unguarded, remainder peeled
  unroll: { reduction: boolean; patch: boolean; load: boolean };
  doubleBuffer: boolean;                               // room in the IR; refused by the rule (measured)
}
interface KernelSchedule {
  kernel: string;
  statements: string[];                                 // members, from the fusion plan
  depth: number;                                        // block-domain rank
  mapping: 'thread' | 'block' | 'gemm';
  stored: string[]; buffered: string[]; staged: string[];
  terms: {...}[]; inPlace: {...}[]; heavy: string[]; gated: boolean;   // stage 3b decisions
  rowMap: 'shared' | 'scratch';                         // where a block-mode kernel's rows live
  threads: number | { heavy: number };                  // block width, as a number the emitter prints
  contraction?: Contraction;
}
interface Schedule {
  fn: string;
  algorithm: Fn;                                        // the Tix function, verbatim
  kernels: KernelSchedule[];
  steps: Step[];                                        // pass id, version, args, revision, changed
}
```

Entities: one per kernel plus one per member statement (`kernel/statement`), so a pass's correspondence can say that a step kept statement `y` in kernel `k0`. Relations: `computes` (kernel → statement).

`algorithm` is a copy of the Tix function on purpose. A schedule is only meaningful for the algorithm it was built from, and the order analysis must read both sides. The alternative, a revision reference to a Tix artifact, would make every schedule check need two artifacts and would let a schedule be applied to a different algorithm.

## The passes

Each is a `definePass` on `ScheduleIR`: `writes: { entities: ['schedule.kernel', 'schedule.statement'], relations: ['computes'] }`, applied through `applyNativePassSync` with a **semantic gate** (below). The gate is where the order argument lives, for the reason given under "Checks".

| Pass | Args | Legality, decided from the schedule IR before it runs | Changes |
| --- | --- | --- | --- |
| `schedule.tile-reduction` | `{ tile }` | The kernel is `thread`, computes exactly one statement; that statement's rank is 2; its expression's outermost reduction is `sum` over exactly one axis; the reduction body is a product of exactly two loads `a[i,k]` and `b[k,j]` where the indices are the plain output axes and the plain reduction axis, the first at (axis0, k) and the second at (k, axis1); both read tensors are not members of the kernel; both extents are the meaning's (any affine form); `tile ≥ 2`; the two tiles fit the device's shared memory at the block tile the pass also sets. | `mapping: thread → gemm`, sets `contraction` with `rows/cols = {block: 32, thread: 1}`, `stage: shared`, `peelTail: true` |
| `schedule.bind-block-tile` | `{ rows, cols }` | `mapping: gemm`; `rows, cols ≥ 1`; `rows % rows.thread == 0`, `cols % cols.thread == 0`; `(rows/rows.thread) * (cols/cols.thread) ≤ 1024` and a multiple of 32; `(rows + cols) * tile * 4 ≤ 48 KiB` (CUDA's default dynamic shared memory, so no opt-in) | `rows.block = rows`, `cols.block = cols` |
| `schedule.bind-thread-patch` | `{ rows, cols }` | `mapping: gemm`; `rows, cols ≥ 1`; the products divide the block tile; `rows*cols ≤ 64` accumulators; `threads = (block.rows/rows)*(block.cols/cols)` is ≥ 32 and ≤ 1024; `(rows+cols+rows*cols) ≤ 96` (the register budget argument below) | `rows.thread = rows`, `cols.thread = cols` |
| `schedule.unroll` | `{ reduction, patch, load }` | `mapping: gemm`; the reduction loop's trip is a tile constant on the peeled path, so unrolling it changes no order; a `reduction: false` request is always legal (it is the status quo) | flags |
| `schedule.double-buffer` | — | `mapping: gemm`; shared memory for two buffers of both operands fits 48 KiB | sets `doubleBuffer` |

The order of the four is the order in the brief's example, and it matters: the tile pass establishes the shape the others argue about. The rule emits them in that order (`strategy.ts`).

Legality refusals are ordinary errors thrown from the pass, so the rule sees them as "this candidate does not apply" rather than as a compiler bug. The rule asks for a pass only after checking the same conditions itself, so a refusal means the rule and the pass disagree — a bug worth a test.

## Checks: the accumulation order, from the IR

The meaning of a sum fixes the order of an output's terms and nothing else about it. So the property a layout pass must keep is exactly: **for every output element of every reduction, the sequence of term indices, in the order the terms are added.** It is an analysis on the schedule IR (`orderOf(schedule)`), and every pass is applied with a gate that recomputes it before and after and requires equality together with an unchanged algorithm and an unchanged set of (kernel, statement) pairs.

The analysis reads both halves of the artifact:

- from `algorithm`, each statement's outermost reductions, in the meaning's order (axes in source order, first outermost), each with its extent expression and step 1;
- from the kernel's `contraction`, how the reduction's index is composed: the outer loop over the tile index `k0` ascending, then the inner loop over `kk` ascending, with index `k0 * tile + kk`; `peelTail` makes the last tile's trip `min(tile, K - k0*tile)`.

It normalises the composition and returns, per statement and per reduction axis, `{ axis, from: '0', step: '1', count: extent }` — the meaning's own description. A composition `k0*tile + kk` with `k0` ascending, `kk` ascending `0..min(tile, K - k0*tile)-1` normalises to the same thing, so `tile-reduction`, `bind-block-tile`, `bind-thread-patch` and `unroll` leave the analysis value unchanged *by construction of the rule*, and a pass that changed it would be rejected. Two mutants in `tests/tensor/schedule.test.mjs` show the gate catching what it claims: a pass that reverses the reduction tile (index `k0*tile + (tile-1-kk)`, normalises to `step: 1` only after re-sorting — it does not) and one that splits the reduction into two halves accumulated one after the other (`k = kk` for the first half then `k = half + kk`, which normalises to two segments, not one).

What this covers and what it does not:

- **Covered, no GPU needed:** the order of every output's terms is the meaning's; the algorithm is the same Tix function; the same statements are computed; the block/thread mapping only decides *which* thread evaluates an element, never the order within one.
- **Still needs the GPU check:** that a term's *value* is the same — that a staged operand word equals the parameter word, that the multiply and the add round separately and nothing contracts them into an FMA, that guards at the edges do not add or drop a term, that the store writes the accumulator. Those are properties of the printed code, not of the IR, and `checkLowering` under the exact relation covers them on the sampled shapes.

This is the split the brief asks to state. It is also why the analysis is written as an analysis and not as a comment in the pass: the same function is what the gate calls.

### Where the framework does not fit, and the change made

`cudaSource(program, fn, options)` is synchronous by the fixed API, so the schedule must exist without awaiting anything. The framework's pass drivers are `applyNativePassSync` (synchronous, but it rejects a pass that declares `needs`, `preserves` or `contract`) and `applyPass` (asynchronous, runs `preserves` through the analysis manager). A schedule step needs a claim, not just a gate.

Two changes, both small and in `src/framework/`:

1. **`applyNativePassSync` gains an optional `claims` list** (`{ analysis, version }[]`): when given, it evaluates each declared analysis on the input and the output and rejects the pass with `PassError('preserveViolated')` when the canonical values differ, before the gate runs. Same rule as `applyPass`'s recompute path (`preserves` with no transfer rule), reduced to what a synchronous pass can do, so that a synchronous lowering can state and check a claim.
2. **`src/framework/strategy/sync.ts`**: `runPlanSync(plan, registry, input, context)` executes a `StrategyNode` restricted to `sequence` and `apply` nodes (with `args` and `input` templates resolved by the framework's own reference resolver), returning the final value and one record per step. The existing interpreter is asynchronous and the lowering cannot await; the plan *format*, registry and validation are shared. Node kinds the sync executor refuses (`fork`, `chooseBest`, `parallel`, …) throw `strategySyncUnsupported`, and a test pins that list. So the rule's plan is data in the framework's format, executed by a second driver rather than a second format.

## Fusion: fed from the plan, not re-expressed

Stage 3's groups, stage 3b's staged terms, in-place rows and gate stay exactly where they are (`planFusion`), and the schedule takes them as its starting point: one `KernelSchedule` per group, with `mapping`, `statements`, `depth`, `stored`, `buffered`, `staged`, `terms`, `inPlace`, `heavy`, `gated` copied from the group.

Why not make them schedule constructs and passes:

- Their legality is about *statements* (does `s` read a member at its own block indices; is a body's work above the staging threshold; is a row dead afterwards), which is Tix-level reasoning. In the schedule IR the statements would have to be re-derived from the algorithm half, so the check would be the same code against the same data, one artifact later.
- The gate is a host condition over shape values, checked on both sides by the contract today; as a schedule construct it would still be emitted as that C++ condition.
- Stage 3's design already argued that fusion cannot be a *Tix* pass (Tix materializes every statement). The schedule IR is not the place that changes: a `fuse` pass on the schedule would need the same legality rule, and the artifact would gain a second, derived notion of "which statements share a kernel" that the emitter would have to prefer over its own input.

What fusion *does* give the schedule is the thing the schedule needs: a kernel with one statement and a contraction in it, which is the precondition of `tile-reduction`. Matmul and a two-statement contraction epilogue are thread-mode groups of that shape. Attention's and mlp's contractions are inside block-mode groups, whose rows are already in shared memory; tiling those is a separate legality (rows are the block domain, the reduction is a row) and I did not build it (Later). The schedule records them as `mapping: block` with their stage-3b fields, so their emission is unchanged and cannot regress.

## The rule that picks a schedule

`strategy.ts`: for a program it builds a **Strategy IR plan** of `apply` steps over the passes above (one candidate per tile configuration) and ranks the candidates with a **cost model over the schedule IR and the shape values**. Nothing is timed.

The rule:

1. Start from the fusion plan → initial schedule (no passes) → this is the fallback and always legal.
2. For each kernel whose `mapping` is `thread` with one statement that `tile-reduction` accepts (matmul, and any rank-2 contraction form), enumerate candidates: `tile ∈ {16, 32}` × block ∈ `{32×32, 64×32, 64×64, 128×64}` × patch ∈ `{4×4, 8×4, 4×8, 8×8}` × `unroll.reduction ∈ {true}`. Each candidate is a plan `[tile-reduction, bind-block-tile, bind-thread-patch, unroll]`.
3. Drop candidates whose pass would refuse (threads not a multiple of 32, shared memory over 48 KiB, accumulators over 64).
4. Score each with `costOf(schedule, shapes)` and take the smallest.

`costOf` is arithmetic over the schedule plus the device's measured ceilings:

```
blocks      = ceil(M/rows.block) * ceil(N/cols.block)
threads     = (rows.block/rows.thread) * (cols.block/cols.thread)
resident    = min(24, 1536/threads, 102400 / sharedBytes)
waves       = ceil(blocks / (48 * resident))
issue       = 2*RI*CJ / (2*RI*CJ + RI + CJ)           // mul and add vs the shared loads feeding them
fill        = min(1, blocks / (48 * 4))               // 4 resident blocks per SM enough to saturate
predicted   = waves * 2*M*N*K / (FLOPs_per_SM * issue) / max(fill, 1/4)
              with FLOPs_per_SM = 14.39e12 / 48
```

`14.39e12` is the measured FMUL+FADD ceiling of this GPU (given in the brief). `4` and the `1/4` floor are the model's one fitted knob; they are checked against measurements (a table of predicted against measured for the candidate set, and the ranking agreement over the corpus and the sweep). The model is the reason the rule picks 32×32 tiles at 512³ (256 blocks: 1.33 waves of a 24-block SM budget) and 64×64 at 4096³ (4096 blocks: 4 waves, no quantization loss), which the sweep below confirmed.

Thresholds and their justification:

- **`tile ≥ 2` and `tile ∈ {16, 32}`:** 8 measured slower (0.134 ms against 0.070 at 512³, 32.4 against 16.1 at 4096³) because shared traffic per term doubles; 64 with the same block tile is over the 48 KiB default at 64×64 (64×64×2×4 = 32 KiB, fine) but loses to 32 at 4096³ (measured 16.09 against 16.34; within noise, so the model prefers the larger tile for fewer barriers).
- **`rows*cols ≤ 64` accumulators and `rows+cols+rows*cols ≤ 96` registers:** 8×8 = 64 accumulators plus 16 operand values plus indices exceeds 96 and spills; measured 8×8 slower than 8×4 at both sizes (0.109 against 0.072, 24.7 against 16.3).
- **`(rows + cols) * tile * 4 ≤ 48 KiB`:** CUDA's default dynamic shared memory; staying under it means a launch never needs `cudaFuncSetAttribute`, one fewer launch-time decision.
- **`threads` a multiple of 32 and ≤ 1024:** warps do not idle in the inner tile, and 1024 is the hardware's block limit.

Candidates are only *counted*, never timed, so this stays inside the brief.

## The emitter prints

`emitCuda(schedule)`. Every choice it used to make is now a field:

| Was decided in the emitter | Now |
| --- | --- |
| `blockThreads.contraction / rows / heavy` cap | `KernelSchedule.threads` (the rule sets it from the same constants) |
| shared memory or scratch (`shared_k` from the row bytes) | `KernelSchedule.rowMap` — still a **runtime** choice, because it depends on the row length only known at launch; the rule sets `rowMap: 'auto'` with the threshold, and the emitter prints the same host condition |
| `fuse`/gate condition text | `KernelSchedule.gate` holds the rule's constants; the emitter prints the condition |
| one statement → stage 2 kernel or group emitter | `mapping` |
| — | `contraction`: a new printer, `emitGemm`, for tiled contractions |

The tiled kernel it prints for matmul (probe 01 measured this shape, and it was bit-identical on all six probe shapes including `K = 0` and `1×1`):

```
template <int BI, int BJ, int RI, int CJ, int TK>   // all compile-time literals from the schedule
__global__ void k0(...) {
  __shared__ float sa[BI*TK], sb[TK*BJ];
  float acc[RI*CJ] = {0};
  for (k0 = 0; k0 + TK <= K; k0 += TK) {           // peeled: no bound in the inner loop
    load sa, sb (coalesced, zero outside the operand); __syncthreads();
    #pragma unroll for (kk = 0; kk < TK; ++kk) {
      av[RI] = sa[(ti+r)*TK + kk]; bv[CJ] = sb[kk*BJ + tj + c];
      #pragma unroll acc[r*CJ+c] = __fadd_rn(acc[r*CJ+c], __fmul_rn(av[r], bv[c]));
    }
    __syncthreads();
  }
  if (k0 < K) { ... same with trip = K - k0 ... }   // the remainder, still ascending k
  guarded store
}
```

`__fmul_rn` and `__fadd_rn` are the two rounding steps the meaning asks for and nvcc cannot contract them, which is what makes the kernel exact (and costs the second instruction per term: the ceiling above).

## Measurements planned

Following the brief's protocol (5 interleaved `benchmark: true` calls per side, differences under 5% are noise):

1. matmul 512³ and 4096³, fused and unfused, against cuBLAS and against the base lowering;
2. the contractions inside attention and mlp (whole programs), conv2d, and the schedule chosen for each;
3. every corpus program, fused and unfused, against the base;
4. the cost model's ranking against measured rankings over the candidate set, from script 02's sweep and from the compiler's own candidates;
5. `checkLowering` exact acceptance on the corpus, on tiled variants at edge shapes, and the contract's cost; kernel count;
6. the two order-mutant passes rejected by the gate with no GPU run.

## Refused

- **Double buffering in this stage.** The construct is in the IR and a pass sets it, but the rule does not use it; the measured gain of the register-tile plus shared-tile form already meets the target and double buffering needs a second shared buffer (over 48 KiB at 64×64×k32). Recorded with its measurement if I get to it.
- **Vectorised (`float4`) loads.** They would need the shared layout and the alignment to be argued per tile; the coalesced scalar loads in probe 01 already give 8.5 TFLOP/s at 4096³. Later.
- **Transposed operand tiles.** For `b[k,j]` the tile is already read along `j` contiguously; a transposed copy helps a `k`-major access I do not have. Not built.
- **Tiling a contraction that is a member of a block-mode group** (attention's `score` and `out`, mlp's `h` and `y`): the rows are the block domain, so a tile of the reduction is a shared-memory layout of a row that is already there, and the legality is different (the block's threads own the row, not a patch of the output plane). Later; those programs keep stage 3b's kernel.
- **A general loop-nest IR**; **measured autotuning**; **split-K**; **FMA** — the brief's exclusions or Later.

## Later

- Loop-nest schedule IR with explicit levels, so that steps compose without a fixed catalogue of layouts.
- Tiled contractions inside block-mode groups (attention, mlp).
- Double buffering, `float4` loads, transposed tiles, and the measured sweep that would justify them.
- Split-K and parallel folds (they leave the bit-equivalence class; the IR has room via `Contraction`).
- The cost model with per-term costs from the IR and the SM's limits read from the device, in place of two fitted constants.
- Emitting the schedule IR as the artifact the contract checks, and a correspondence that follows one output element's accumulation through every step (started here: `orderOf` per statement; per element is a refinement).

## As built (differences from the design above, and why)

Five points where the implementation settled differently. Each is measured or forced by a measurement.

1. **The pass order is tile → patch → block tile → unroll → variants,** not tile → block → patch. `bind-block-tile`
   divides by the thread patch to get the block's thread count, so with the block tile bound first (64×64) and the
   patch still 1×1, the pass refused "4096 threads are outside 32..1024". The patch is the divisor, so it is bound
   first.
2. **The tile sizes are a launch-time choice, not a compile-time one.** `cudaSource(program, fn)` has no shape
   values, so a compile-time tile would be wrong at one of 512³ and 4096³ (script 02: 32×32 is 11% better at 512³,
   64×64 with an 8×4 patch is 25% better at 4096³). `Contraction.variants` lists the layouts, the kernel is a
   `template <int V>` with one body per layout (so the kernel count stays 1), and the host picks with the cost
   model over the shape values. This is the brief's "a rule or a strategy that picks schedules from the shapes,
   without timing candidates".
3. **`Contraction.fallback` was added.** The first measurement of the tiled lowering was *slower* than stage 2 at
   three small shapes (300×200×100, 128³, 17×4096×33): the tiled grid has 1 to 16 blocks for 48 SMs. The kernel
   therefore also holds the statement's stage-2 form as one more instantiation, and the launch runs it when the
   chosen layout's grid is below one block per SM. The threshold is that comparison, and the measurements behind it
   are in the field's comment: tiled wins by 3 to 8 times from 512³ (64 blocks) up, and loses below.
4. **`steps` is not a field of the artifact.** A pass does not own the pass chain's revisions, so `scheduleOf`
   returns `{ schedule, steps }` and the CUDA unit carries the schedule and (in `tensor.lower-cuda`) the steps.
   The schedule artifacts themselves form the revision chain; each step's artifact revision is in `steps`.
5. **`emitUnfused` exists** so that `fuse: false` prints from the same printer with a schedule built from
   `unfusedPlan`, and the rule is told `{ tile: false }`. That keeps stage 2's bytes exactly (the digest test in
   `tests/tensor/fusion.test.mjs`), which a rule that tiles any thread-mode contraction would otherwise break.

The framework changes are the two named above (`SyncClaim` in `applyNativePassSync`, `runPlanSync` in
`src/framework/strategy/sync.ts`) plus `syncPassAlgorithm` in `src/framework/passes/bridge.ts`, the synchronous twin
of the existing `passAlgorithm`.
