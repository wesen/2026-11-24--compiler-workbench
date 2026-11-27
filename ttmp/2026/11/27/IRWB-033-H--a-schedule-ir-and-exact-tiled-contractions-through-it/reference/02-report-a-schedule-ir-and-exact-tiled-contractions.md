---
Title: 'Report: a schedule IR and exact tiled contractions'
Ticket: IRWB-033-H
Status: active
Topics:
    - tensor
    - gpu
    - verification
    - compiler
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, its adapter, the five passes and the accumulation-order analysis
    - Path: repo://src/tensor/strategy.ts
      Note: The rule (a Strategy IR plan) and the layout candidates
    - Path: repo://src/tensor/cuda-source.ts
      Note: emitGemm and the rest of the printer, which now reads every decision from the schedule
    - Path: repo://src/framework/strategy/sync.ts
      Note: The synchronous plan executor the lowering needs, and its refusals
    - Path: repo://tests/tensor/schedule.test.mjs
      Note: The IR, the passes, the order analysis and the two mutant passes it rejects
    - Path: repo://tests/tensor/tiled-gpu.test.mjs
      Note: GB10 checks at 512^3 and at the edges
ExternalSources:
    - 'Yang, Riasanovsky, Deng and Sarkar, Taming Bitwise Behavior in GPU Kernels with Tensor Core'
Summary: Matmul's contraction is now a tiled kernel that keeps every output's accumulation order — 0.0628 ms at 512^3 (3.4x the base, 1.9x cuBLAS) and 17.2 ms at 4096^3 (7.8x the base, 0.42x cuBLAS's rate) — and the layout decisions that produce it are checked passes on a new schedule IR between Tix and CUDA, with an order analysis that rejects a reordering pass without a GPU. Fusion, staged terms and the gate are unchanged, so no program got slower. One framework change was needed (a synchronous pass claim) plus a sync strategy executor.
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: Final report of stage 6 (IRWB-033-H)
WhenToUse: Reviewing what the schedule IR is, what its passes check, what was measured, and what was refused
---

# Report: a schedule IR and exact tiled contractions

Stage 6 has two results.

**The contraction is fast and exact.** `c[i,j] = sum(k) a[i,k]*b[k,j]` lowers to one kernel with 64×64 outputs per
block, 8×4 per thread in registers, both operands staged in shared memory in tiles of 16, the complete tiles run
without a bound and the remainder peeled — and every output still adds its terms one at a time in ascending `k`,
`__fmul_rn` then `__fadd_rn`, which nvcc cannot contract. At 512³ that is **0.0628 ms**, 3.4 times faster than the
base lowering (0.2122 ms) and 1.9 times cuBLAS's time; at 4096³ **17.19 ms**, 7.8 times the base and 0.42 times
cuBLAS's rate. The output words equal the base lowering's at every shape I measured, and the packed f32 meaning's at
every shape the contract samples.

**The compiler has a schedule IR.** `Tix → schedule IR → CUDA source`. The schedule is a v6 artifact
(`tensor.schedule`, `src/tensor/schedule.ts`) holding the Tix algorithm and one record per kernel; the layout
decisions are five passes on it, each with its own legality decided from the IR before it runs, a correspondence to
the revision before it, and a claim checked by recomputing an **accumulation-order analysis** that reads the layout
and the algorithm together. The emitter prints a schedule and decides nothing. The rule that picks the schedule is
a Strategy IR plan over those passes, ranked by a cost model over the shape values; the shape-dependent part of the
choice (which tile) happens at launch, because `cudaSource` has no shapes.

Fusion, staged terms, in-place rows and the launch-time gate are unchanged, so the six corpus programs keep their
kernels and their times (attention 0.7447, mlp 0.625, conv2d 0.1662, softmax 0.3844, layernorm 0.1785 ms fused).

## Results: the contractions

`runTixCuda(..., { benchmark: true })` returns the median of three timed launches after a warm-up, under the
runner's `--timed` lock. Each row is the **median of five such calls**, alternating fused and unfused
(script `04-bench.mjs`; every value in `scripts/04-final-table.out.jsonl`). Inputs are seed 20, f32 in [−0.1, 0.1],
eps = 1e-5. The two output digests were equal in every call.

| Contraction | Fused ms | Unfused ms | Fused / unfused | Fused TFLOP/s | cuBLAS ms | Fused / cuBLAS time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| matmul 512³ | **0.0628** (0.0637, 0.0628, 0.0623, 0.0626, 0.0638) | 0.2122 | **0.296** | 4.28 | 0.0329 | 1.91 |
| matmul 4096³ | **17.19** (17.28, 17.15, 17.25, 16.84, 17.19) | 134.46 | **0.128** | 7.99 | 38.0 (at 19.2 TFLOP/s) | 2.40 |
| matmul 1024³ | **0.3180** | 2.0082 | **0.158** | 6.75 | — | — |
| matmul 300×200×100 | 0.0135 | 0.0128 | 1.05 | 0.89 | — | — |
| matmul 128³ | 0.0106 | 0.0107 | 0.99 | 0.40 | — | — |
| matmul 17×4096×33 | 0.1671 | 0.1690 | 0.99 | 0.03 | — | — |
| conv2d (whole program) | 0.1662 | 0.1662 | 1.00 | 1.71 | — | — |
| attention (whole program) | 0.7447 | 1.0505 | 0.71 | — | 0.0393 (its two GEMMs) | — |
| mlp (whole program) | 0.6250 | 0.9427 | 0.66 | — | 0.0898 (its two GEMMs) | — |

Reading it:

- **512³: the base was 0.2122 ms and the ceiling is 0.0186.** Two instructions per multiply-add (FMUL then FADD,
  which the meaning forces) at the measured 14.39 TFLOP/s put 512³ at 0.0186 ms and 4096³ at 9.55 ms. The tiled
  kernel is 3.4× the base and 3.0× the ceiling at 512³, 4.4× at 4096³.
- **cuBLAS is not reachable exactly, and the gap is the second instruction.** cuBLAS uses FFMA (26.98 TFLOP/s
  ceiling, 8.15 TFLOP/s at 512³); the exact form issues two instructions per term, so 8.15/... ≈ 0.53 of cuBLAS's
  rate at 512³ is close to the arithmetic maximum (14.39/26.98 = 0.53). At 512³ we are at 4.28 TFLOP/s: 0.30 of the
  FMUL+FADD ceiling. At 4096³ 7.99 TFLOP/s is 0.56 of it.
- **The three small shapes run the stage-2 fallback** (ratio 0.99 to 1.05, i.e. the same kernel), because their
  tiled grids are 1 to 16 blocks for 48 SMs. Before the fallback they were 2.0 to 2.7 times *slower* than the base
  (300×200×100: 0.0310; 128³: 0.0210; 17×4096×33: 0.4530 — script 04's first run), which is the measurement that
  produced `Contraction.fallback`.
- **conv2d is not tiled** and its fused source is byte-identical to its unfused one, as before. Its reduction is
  over three axes with a stencil read (`x[n,c,y+dy,xpos+dx]`), which the tiling legality does not accept; it stays
  the thread-mode kernel of stage 2 with 1.71 TFLOP/s.
- **attention and mlp are unchanged.** Their contractions are members of block-mode groups whose rows are already
  in shared memory, and tiling them is a different legality (see Refused). Their fused times are stage 3b's
  (attention 0.7447 against 0.746, mlp 0.6250 against 0.627), so nothing regressed; the inside contractions run at
  0.18 and 0.86 TFLOP/s, which is what a row-per-thread form gives. Their cuBLAS columns are the two GEMMs each
  contains; the whole programs include the softmax, the `tanh`, and the row reductions, so the ratios are not
  comparable and I do not give one.

## Results: every corpus program, against the base

Fused is this stage; unfused is `fuse: false`, stage 2's lowering, unchanged. The "base" column is stage 3b's
report (its own five-call medians, same protocol, same sizes).

| Program | Kernels fused / unfused | Fused ms | Unfused ms | Fused / unfused | Fused vs base |
| --- | ---: | ---: | ---: | ---: | ---: |
| matmul 512³ | 1 / 1 | **0.0628** | 0.2122 | 0.30 | base 0.217 → 0.29× |
| softmax N=4096, C=1024 | 1 / 4 | 0.3844 | 0.8092 | 0.48 | base 0.385 → 1.00× |
| layernorm N=4096, D=1024 | 1 / 4 | 0.1785 | 0.4770 | 0.37 | base 0.170 → 1.05× (noise) |
| attention Q=K=1024, D=V=64 | 1 / 6 | 0.7447 | 1.0505 | 0.71 | base 0.746 → 1.00× |
| mlp N=1024, D=256, H=1024, O=256 | 1 / 3 | 0.6250 | 0.9427 | 0.66 | base 0.627 → 1.00× |
| conv2d N=8, C=16, H=W=64, O=32 | 1 / 1 | 0.1662 | 0.1662 | 1.00 | base 0.165 → 1.01× (noise) |

No program is slower than the base: the two rows above 1.00 are within the protocol's 5% noise, and layernorm's
fused source is unchanged from stage 3b's (the printer's output for a block-mode kernel is the same text). The only
source that changed for the corpus is matmul's fused source, which is now the tiled kernel.

## The schedule IR

`src/tensor/schedule.ts`. `ScheduleIR` id `tensor.schedule`, version 1, validated: the algorithm must be the named
function, every statement must be in exactly one kernel, a tiled kernel must compute exactly one rank-2 statement
with a one-axis sum reduction whose layout is legal (patch divides block tile, 32..1024 threads, ≤ 64 accumulators,
operands ≤ 48 KiB of shared memory).

```ts
Schedule    = { fn, algorithm: Fn, kernels: KernelSchedule[] }
KernelSchedule = { kernel, statements[], depth, mapping: 'thread'|'block'|'gemm',
                   stored[], buffered[], staged[], terms[], inPlace[], heavy[], gated,
                   threads: {kind:'cap'|'heavy', cap}, rowMap: 'auto',
                   gate: {fullRow, smallGrid, heavyLanes} | null, reasons[], contraction? }
Contraction = { axis, order: {outer, inner}, stage: 'shared', peelTail,
                unroll: {reduction, patch}, doubleBuffer,
                variants: Variant[], choice: 'cost', fallback }
Variant     = { tile, blockRows, blockCols, patchRows, patchCols }
```

Entities are `k0` (kernel) and `k0/y` (statement) with a `computes` relation, so a pass's correspondence can say
"this step kept statement `y` in kernel `k0`" — every pass here reports the identity correspondence, because a
layout change moves no statement between kernels.

The artifact carries the **algorithm verbatim** so that a schedule stands alone and the order analysis can compare
the layout against the meaning inside one artifact. The alternative (a revision reference to a Tix artifact) would
have made every schedule check a two-artifact check and allowed a schedule to be applied to a different algorithm.

### The passes

Each is a `definePass` on `ScheduleIR` (`writes: entities ['kernel','statement'], relations ['computes']`), applied
through `applyNativePassSync` with the order analysis as both the claim and the gate. Legality is decided from the
artifact before the mutation; a refusal is a `PassError('passFailed')` with the reason ("the patch does not divide
the block tile", "4096 threads are outside 32..1024"), so the rule and the pass disagree loudly instead of silently
skipping.

| Pass | Args | Legality | Effect |
| --- | --- | --- | --- |
| `schedule.tile-reduction` | `{tile}` | a `thread` kernel with one statement; rank 2; one outermost `sum` over one axis; body is `a[i,k] * b[k,j]` with those exact plain indices; operands not members; `tile ≥ 2`; the smallest block tile fits 48 KiB | `mapping` → `gemm`, layout with `order` ascending/ascending, `peelTail`, both operands staged, one 32×32 variant |
| `schedule.bind-thread-patch` | `{rows, cols}` | patch divides the block tile; `rows*cols ≤ 64`; `rows+cols+rows*cols ≤ 96` live registers; threads 32..1024 and a multiple of 32 | `variants[0].patchRows/Cols` |
| `schedule.bind-block-tile` | `{rows, cols}` | patch divides it; threads 32..1024 and a multiple of 32; `(rows+cols)*tile*4 ≤ 48 KiB` | `variants[0].blockRows/Cols` |
| `schedule.unroll` | `{reduction, patch}` | `peelTail` must hold before the reduction tile can be unrolled (otherwise there is no complete-tile loop) | unroll flags |
| `schedule.launch-variants` | `{variants, fallback}` | ≥ 2 variants, each legal; the primary layout must be among them; a different tile is refused when the reduction is unrolled | the printed layouts and the fallback |
| `schedule.double-buffer` | — | two tiles of both operands fit 48 KiB | `doubleBuffer` (and the printer refuses to print it: see Refused) |

The order the rule emits them in is tile → patch → block tile → unroll → variants. The design had block tile before
patch; that is impossible, because `bind-block-tile` divides by the patch to get its thread count, so with 64×64
bound first and the patch still 1×1 it refuses 4096 threads. The patch is the divisor, so it is bound first.

### The order analysis, and what it covers

`orderOf(schedule)` returns, for every statement of every kernel and every outermost reduction, the sequence of
term indices in the order they are added:

```ts
{ kernel: 'k0', statement: 'y',
  reductions: [{ axis: 'i2', shape: 'contiguous', from: '0', step: 1, count: 'K' }],
  unrecognized: [] }
```

It is derived from both halves: the meaning gives the axes and their extents in source order; the layout gives how
the reduction index is composed — `k0 * tile + kk` with `k0` ascending over the tile levels and `kk` ascending to
`min(tile, K - k0*tile)`. Ascending/ascending normalises to the meaning's contiguous run, which is why tiling,
patching, block-binding and unrolling leave the value unchanged. Any other pair of orders normalises to a `split`
value that differs, and any layout key the analysis does not know is listed in `unrecognized` (so a pass cannot add
a third loop level and be certified by a check that does not read it).

**What this covers without a GPU:** the algorithm is the same Tix function; the same statements are in the same
kernels; every output's terms are added in the meaning's order. A pass that changed any of those is rejected by the
framework (`PassError('preserveViolated')`) with a message naming the statement, before any code is printed.

**What the GPU check still covers:** that a *term's value* is the same. A staged operand word equals the parameter
word; the multiply and the add really round separately and are not contracted into an FMA; the guards at the edges
neither add nor drop a term; the peeled remainder adds exactly the terms `K` asks for; the store writes the
accumulator. Those are properties of the printed code, and `checkLowering` judges them under the exact relation.

Two mutant passes in `tests/tensor/schedule.test.mjs` show the gate is not vacuous: one sets the inner level to
`descending` (the same output element, different bits) and one adds a `split` key (a split reduction, which this
stage refuses). Both are rejected with `preserveViolated` and no GPU run. A control mutant that only changes the
patch is accepted, so the gate is not refusing everything.

### Fusion: fed from the plan, not re-expressed

Stage 3's groups, stage 3b's staged terms, in-place rows and the gate are unchanged and the schedule copies them
(`mapping`, `statements`, `depth`, `stored/buffered/staged`, `terms`, `inPlace`, `heavy`, `gated`, and now
`threads.cap` and the gate's constants, which used to be decided inside the emitter). Three reasons:

- their legality is statement-level Tix reasoning (does `s` read a member at its own block indices; is a body's work
  over the staging threshold; is a row dead afterwards), so a schedule pass would re-derive the same check from the
  algorithm half of the same artifact — the same code one artifact later;
- stage 3 already established that fusion cannot be a *Tix* pass (Tix materialises every statement), and nothing
  about a schedule IR changes that;
- the gate is a host condition over shape values that the contract checks on both sides today; as a schedule
  construct it would still be printed as that C++ condition.

What fusion gives the schedule is the precondition of tiling: a `thread`-mapping kernel with one statement and a
contraction in it. Matmul is exactly that; a two-statement contraction epilogue (`y[i,j] = sum(k)…; z[i,j] =
tanh(y+c)*y`) is not, and is left alone rather than split.

## The rule

`src/tensor/strategy.ts`. The rule emits a **Strategy IR plan** (framework format, validated): a `sequence` of five
`apply` nodes naming the passes by id and version with their arguments. It is executed by `runPlanSync` — a new
synchronous executor in `src/framework/strategy/sync.ts` — because the framework's interpreter is asynchronous and
`cudaSource` is not.

Where the shape values enter is the last step. `cudaSource(program, fn, {fuse})` has no shapes, so a compile-time
tile can only be a constant, and script 02 shows no constant is right at both 512³ and 4096³ (32×32 is 11% better at
512³; 64×64 with an 8×4 patch is 25% better at 4096³). So the kernel is printed as a `template <int V>` with one body
per `Variant` and the host picks with the **cost model**:

```
blocks   = ceil(M/BI) * ceil(N/BJ)
resident = min(24, 1536/threads, 102400/sharedBytes)
waves    = ceil(blocks / (SM * resident))
issue    = 2*RI*CJ / (2*RI*CJ + RI + CJ)              // multiply-adds against the shared loads feeding them
fill     = clamp(blocks / (4 * SM), 1/4, 1)
cost     = waves * 2*M*N*K / (14.39e12/48 * issue * fill)
```

`14.39e12` is the GPU's measured FMUL+FADD ceiling (the brief's number) and `24/1536/102400` are the SM's block,
thread and shared-memory limits (stage 3b's probe 16). Two knobs are fitted: `4` blocks per SM as the point at which
an SM is saturated, and a floor of `1/4` on `fill`. No candidate is timed.

The three variants: 64×64 with an 8×4 patch (128 threads), 32×32 with a 4×4 patch (64 threads), 64×64 with a 4×4
patch (256 threads). All keep the reduction tile at 16.

**How well the model does.** It is a *ranking* function, not a predictor of milliseconds: its absolute value is
`waves * 2MNK / (rate * issue * fill)`, which ignores instruction-issue efficiency, and it sits 1.6 to 3 times below
the measured time. What it has to get right is which variant is fastest. Printed for the three variants and computed
for the shapes the sweep covers:

| Shape | 32×32 / 4×4 | 64×64 / 8×4 | 64×64 / 4×4 | Model picks | Measured best |
| --- | ---: | ---: | ---: | --- | --- |
| 512³ | **1119** | 3190 | 3358 | 32×32 / 4×4 | 32×32 / 4×4 (0.0637) |
| 4096³ | 8596 | **4355** | 8596 | 64×64 / 8×4 | 64×64 / 8×4 (16.34) |
| 1024³ | 8954 | **8506** | 8954 | 64×64 / 8×4 | not swept |
| 128³ | **66.5** | 66.5 | 70.0 | 64×64 / 8×4 | all equal (fallback) |
| 300×200×100 | 190 | **190** | 200 | 64×64 / 8×4 | all equal (fallback) |

(cost in the model's arbitrary unit, lower is better; the first is an exact tie, so the primary variant wins.) It
ranks correctly at both sizes where the sweep measured all three variants, and the reason is visible in the terms:
at 512³ only 64 blocks exist for 48 SMs, so `fill` keeps the 128-thread variant from filling the machine while 256
blocks of 64 threads do fill it; at 4096³ there are 4096 and 16384 blocks, `fill` saturates, and the wider patch's
better instruction mix (`issue` 0.842 against 0.800) wins.

Its one clear failure is 8×8: `issue` says 8×8 (0.889) has the best mix of all and it measured worst (24.65 against
16.34 ms at 4096³), because 64 accumulators plus 16 operand values plus indices spill. The register budget
(`rows+cols+rows*cols ≤ 96`) does not exclude it (80), so only keeping it out of the variant list does. A model with
a register-pressure term is Later.

**What the model does control: the fallback.** `tiled = blocks(chosen variant) ≥ SM count`. That single comparison
separates 512³ (64 blocks for the 64×64 variants, 256 for 32×32: tiled, 3.4× the base) from 300×200×100 (10 blocks),
128³ (4) and 17×4096×33 (1), which all measured *slower* tiled. It is fitted to shapes on each side of it (16 blocks
loses, 64 wins), so the honest reading is that the boundary lies between 16 and 64 blocks, and the unmeasured class is
a problem of 20 to 60 blocks.

## New approaches tried, and what they gave

1. **The order analysis as the pass's claim, not a comment** (built, and it is what makes the passes checkable): it
   separates "the order is unchanged" (proved from the IR, no GPU) from "the values are unchanged" (still needs the
   GPU). Two mutants are rejected without a GPU. This is the stage's main answer to "make that argument part of the
   check".
2. **A launch-time cost model instead of a compile-time constant** (built): the same source is fast at 512³ and at
   4096³, and the small shapes take the fallback. What it gave: 0.0628 against a compile-time best of 0.0719 at
   512³ (12%: the model picks 32×32/4×4 there, the compile-time primary is 64×64/8×4), and the "never slower"
   property at shapes a compile-time choice would have lost on (the three small shapes below).
3. **The stage-2 form as one more instantiation of the tiled kernel** (built, and it was necessary): without it the
   tiled lowering lost by up to 2.7× at three small shapes. It costs one more `V` body and one host branch; the
   kernel count stays 1.
4. **Peeling the reduction tile's remainder** (built, and measured indirectly): the prototype sweep with a guarded
   inner loop only (probe 01, `trip` inside the loop) reached 3.73 TFLOP/s at 512³ for 64×64/8×4; the peeled form in
   the compiler reaches 4.28. Some of that is the edge guards and some the peel; I did not isolate them, so I claim
   only that the peeled form is what is shipped and that it is exact at `K = 0`, `K = 37` and `K = 4096`.
5. **Timing the candidate set instead of modelling it** (not done, by the brief): the model's 11% miss at 512³ is
   what timing would fix; the brief leaves that to a later stage.
6. **A per-output-element correspondence through the steps** (not done; `orderOf` is per statement and reduction).
   It would name, for each output, the term sequence before and after each pass — the same information, made
   inspectable. Listed under Later.

## Schedule choices refused

- **Double buffering.** The construct is in the IR and `schedule.double-buffer` sets it, but the printer refuses to
  print a double-buffered contraction (it throws) instead of silently ignoring the flag, and the rule never emits
  it: two copies of both operands at 64×64×k16 are 16 KiB and fit, but the register-tile plus peel form already
  reaches 0.56 of the FMUL+FADD ceiling at 4096³ and I had no measurement showing prefetch would beat that within
  the session's budget. Not built, deliberately, and not silently.
- **`float4` loads and transposed operand tiles.** The `b` tile is already read along `j` contiguously and the `a`
  tile along `k`; a vector load would need the shared layout and alignment argued per tile, and the measured
  8.0 TFLOP/s at 4096³ is within 2.1× of the arithmetic ceiling. Refused for this stage.
- **A tile of 8 and a tile of 32 in the rule's variant list.** k8 measured 2× slower at both sizes (32.4 ms against
  16.1 at 4096³); k32 was 1.5% better at 4096³ and worse at 512³ — inside noise, so I kept k16 and fewer variants.
- **8×8 patches.** Measured worst at both sizes (24.65 against 16.34 at 4096³) despite the best instruction mix:
  register pressure. Refused by no legality rule (80 registers is under the 96 budget) but kept out of the variant
  list.
- **Tiling a contraction that is a member of a block-mode group** (attention's `score` and `out`, mlp's `h` and
  `y`). There the block's threads own a row, not a patch of an output plane, so tiling needs a different legality
  and a different printer; those programs keep stage 3b's kernel, which is not slower than before.
- **Tiling conv2d's stencil contraction** (three reduction axes, reads at `y+dy`). Refused by the tiling legality;
  it keeps stage 2's kernel at 1.71 TFLOP/s.
- **Reordering a reduction in any way** — split-K, a parallel tree fold, two accumulators. The order analysis would
  reject them, which is the point: they are a later stage's problem, and the IR has room for them (`order` is data,
  and `unrecognized` says plainly that the check cannot certify what it does not model).

## Framework and tool changes

Three, each with its reason.

1. **`applyNativePassSync` gained an optional `claims` list** (`src/framework/passes/define-pass.ts`,
   `SyncClaim`). `applyPass` runs a pass's `preserves` through the analysis manager, which is asynchronous; a
   synchronous lowering could not state a claim at all. The new argument evaluates each declared analysis on the
   input and the output and rejects the pass with `preserveViolated` when their canonical values differ, before the
   semantic gate — `applyPass`'s recompute path, reduced to what a synchronous driver can do. Without it the
   schedule passes would have had their order argument inside the pass's own code, unchecked.
2. **`src/framework/strategy/sync.ts`: `runPlanSync`.** The framework's interpreter is asynchronous and `cudaSource`
   is synchronous by the fixed API, so the rule could not use it. The new executor shares the plan format, the exact
   version registry and the validation, runs `sequence` and `apply` nodes with `args`/`input` templates over
   `input`, `current` and `binding`, and refuses every other node kind with `strategySyncUnsupported` so the
   difference is visible. A test pins the plan's shape and the refusals (`fork`, `checkpoint`).
3. **`syncPassAlgorithm`** (`src/framework/passes/bridge.ts`), the synchronous twin of the existing
   `passAlgorithm`: it wraps a pass as a `transform` algorithm through `applyNativePassSync`, keeping the
   framework's declared-writes enforcement, correspondence and claims.

No change to `tools/cuda-remote.mjs`; `--link`, `--timed` and the build cache did what the stage needed.

One finding that did **not** become a change: the CUDA unit's IR version moved from 2 to 3 so that a kernel's
`mapping` may be `gemm` and the unit may carry the schedule it was printed from. The contracts manager's
entity-list checks (`IRWB-031`) accepted the new version unchanged, and `tests/tensor/cuda.test.mjs`'s
"kernel inventories reject invented and omitted CUDA kernels" passes unmodified.

What did **not** fit, and cost nothing because it was avoided: a transformation with two IR outputs (`schedule` and
`subject`). It would have modelled the pipeline as two ports with two correspondences, but `checkCudaLowering`'s
existing signature takes a single candidate artifact, and the schedule's value has to travel with the source anyway
for the report and for a reviewer. Recorded as a Later item rather than forced.

## What the contract checks, and what it costs

`checkLowering(program, fn, {fuse})` runs `tensor.lower-cuda` (version 3): Tix → schedule (five checked passes) →
CUDA source, then the differential invariant `tensor.cuda-meaning` compares every case's GPU output with the current
revision's f32 meaning, word for word, NaN as a class. The cases are stage 2's recipe (shape assignments 1, 3, 4, 7,
a mixed one where every symbol differs, all zeros and one zero at a time; four input streams; at most 4,096 elements
per tensor). For a program with a gated kernel every sample is two cases, one per gate side (stage 3b).

Wall time, script `06-contract-cost.mjs`, with the binary already in the remote build cache (so without the one
nvcc run a new source needs), on the GB10:

| Program | Fused cold / repeat | Unfused cold / repeat |
| --- | ---: | ---: |
| matmul | 4686 / 184 ms | 4086 / 67 ms |
| softmax | 4404 / 57 | 3813 / 89 |
| layernorm | 4173 / 89 | 3827 / 34 |
| attention | 4585 / 97 | 3512 / 73 |
| mlp | 4122 / 79 | 3341 / 60 |
| conv2d | 5425 / 1883 | 1538 / 2559 |

Every check was accepted as `exact` on both sides. The cold time is dominated by ssh, upload and process start (the
same 3–5 s stage 3b measured); the repeats are cached verdicts except where the cache cannot help (conv2d's 1.9 s and
2.6 s are its 28 cases' interpreter references, which are computed per case).

Beyond the corpus, `tests/tensor/cuda-gpu.test.mjs` (unchanged) checks the six corpus programs fused and unfused,
before and after `inline`+`split-sum`, plus split rounding, shadowing, empty reductions and intrinsic edges;
`tests/tensor/tiled-gpu.test.mjs` checks the tiled lowering at 512³ and at `97×37×131`, `1×1×1`, `1×4096×1`,
`64×0×64`, `0×8×8`, `33×17×5` against stage 2's kernel and, where cheap, against the interpreter; a 40-term
reduction over a tile of 16 against a JavaScript computation in the meaning's order, with a proof that the reversed
order differs on that input (so the comparison proves something); and a swapped-operand contraction that must stay
untiled and still be exact.

## Measured, and only argued

**Measured on the GB10:**

- the tables above: five `benchmark` calls per program and side, alternated, with equal output digests everywhere;
- the tiled lowering's exactness at nine shapes against stage 2 and the interpreter (`tiled-gpu.test.mjs`), and the
  contract's exact acceptance of the corpus and of the tiled matmul;
- the order analysis's rejection of the two mutants (no GPU involved);
- the cost model against script 02's sweep (the comparison table above);
- the contract's case counts and wall times;
- three probes: the hand-written exact tiled GEMM on six shapes across five tile configurations (30/30 bitwise
  equal, `K = 0` and `1×1×1` included), a 16-configuration tile sweep at two sizes, and
  `cudaFuncGetAttributes` on an explicitly instantiated template kernel (it is the `dim3` z-dimension bug that made
  the first generated source fail, not the template).

**Argued, not measured:**

- that the tiled form is exact at *every* shape and every legal program, not only the sampled ones. The argument:
  within an output element, the terms are visited in ascending `k` because the outer tile index ascends and the
  inner index ascends from 0 to `min(tile, K - k0*tile)`; the padding of a partial tile is never visited (the peeled
  loop's bound is `trip`), so no term is added that the meaning does not have and none is dropped; each term is
  `__fadd_rn(acc, __fmul_rn(a, b))` with the operand words copied exactly through shared memory; the accumulator
  starts at `0.0f`, as `sum` does. The order analysis certifies the first and the third of those from the IR; the
  rest is a property of the printed code and is sampled by the GPU checks.
- the cost model's boundary between 16 and 64 blocks, and its `4`-and-`1/4` knobs. Four shapes were measured on
  each side of the boundary and nothing in between.
- the 11% a per-shape tile would gain at 512³, and the 25% at 4096³ (both are script 02's numbers for other
  variants, not of the compiler's own source).

## Later

- Tiled contractions inside block-mode groups (attention's `score` and `out`, mlp's `h` and `y`): a row is owned by
  the block's threads, so the legality and the printer differ.
- Double buffering, `float4` loads, transposed operand tiles, and the sweep that would justify them.
- A general loop-nest schedule IR with explicit levels, so that steps compose without a catalogue of layouts.
- A correspondence that follows each output element's accumulation through every step, and the transformation's
  schedule as a second IR output port.
- Split-K and parallel folds, FMA, tensor cores: each leaves the bit-equivalence class the meaning fixes, and each
  needs a schedule construct the IR has room for (`Contraction.order` is data).
- A cost model in place of two fitted constants: per-term costs from the IR and the SM's limits read from the device,
  checked against measurements at more shapes.
- Tile choice by measured search (the brief leaves this to a later stage; the model's 11% miss is what it would fix).
