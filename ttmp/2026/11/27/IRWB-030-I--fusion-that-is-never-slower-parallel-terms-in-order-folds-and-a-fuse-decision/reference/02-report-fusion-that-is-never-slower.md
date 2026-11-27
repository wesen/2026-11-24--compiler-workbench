---
Title: 'Report: fusion that is never slower'
Ticket: IRWB-030-I
Status: active
Topics:
    - tensor
    - gpu
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Staging decisions (S0-S4) and the launch gate in planFusion
    - Path: repo://src/tensor/cuda-source.ts
      Note: Term phase and in-order fold in emitGroup; stage 2 path untouched
    - Path: repo://tests/tensor/fusion-gpu.test.mjs
      Note: GB10 exactness of staged folds, reversed-fold mutant, launch gate
    - Path: repo://ttmp/2026/11/27/IRWB-030-I--fusion-that-is-never-slower-parallel-terms-in-order-folds-and-a-fuse-decision/scripts/05-staging-vs-inline.mjs
      Note: The three-way measurement (staged / inline folds / unfused)
ExternalSources: []
Summary: Reductions compute their terms block-wide and fold them in order; layernorm inside drops from 0.491 ms (stage 3) to 0.198 ms, 2.0x under unfused; a measured launch gate keeps row-phase groups unfused below 64 rows; every corpus program fused is never slower.
LastUpdated: 2026-11-27T13:30:00-05:00
WhatFor: Final report of stage 3b (IRWB-030-I)
WhenToUse: Reviewing what the staged lowering does, what it measured, and what it refused
---

# Report: fusion that is never slower

Stage 3's block mode computed each row-scalar member — and so each of its reductions — on thread 0 of the
row's block, with every term inlined into the serial fold. A term such as `x[i,d] / D` does not depend on the
accumulator, so this stage computes the terms block-wide into a buffer and folds them in the meaning's order
afterwards. The fused lowering of the "inside" placements, where stage 3 was at best at parity with stage 2,
now wins clearly: layernorm inside runs 0.198 ms against 0.491 ms for stage 3's own fused lowering and
0.391 ms unfused. A launch gate, decided from the IR and the shape values at launch, keeps the one family
where fusion loses — heavy elementwise row phases with no row-length fold below 64 rows — on stage 2's
kernels. Every corpus program, at the brief's sizes, fused and unfused, produces identical bits, and fused is
never slower.

## How the terms are staged

For a staged reduction of a row-scalar member in a block-mode kernel, the emitter produces two phases. The
**term phase** runs block-wide before the member's element loop: the reduction's index space is flattened in
the meaning's order (first listed axis outermost), thread `t` computes term `t`, `t += blockDim.x`, into a
slice of one term pool in shared memory (or the global scratch area, same code path, same values). After a
barrier, the member's element loop runs as stage 3 emitted it — for a row-scalar member, thread 0 — and the
reduce node **folds the slice in order**: `acc = init; for (t = 0; t < count; ++t) acc = op(acc, q[t])`, with
`__fadd_rn` for sum and `max_nan` for max. The pool is one buffer per kernel, sized to the largest member's
total staged term count, reused by the members in turn (a member's staged terms are dead after its fold,
which completes before the barrier that precedes the next member's term phase; per-reduce offsets keep a
member's reductions apart).

**Why the bits cannot change (argued, with measured samples).** A term is the scalar code the emitter always
produced for the reduction body, with the reduction's indices bound to the flattened position; its value
depends only on tensor contents, shape values and its own indices — not on the computing thread, and not on
the accumulator, which appears only in the fold. The fold applies the same instruction to the same values in
the same order from the same init; an empty extent gives count 0 and the untouched init, as before. Everything
else in the kernel is stage 3's code, whose exactness argument carries over. Measured samples: every contract
case of six staged-feature programs, the corpus and the inside variants at reduced sizes (interpreter,
fused, unfused word-equal), full-size digests equal between fused and unfused, and a reversed-fold mutant of a
staged sum rejected by the exact check with a coordinate.

## Which reductions stage (decided from the IR, refusals recorded)

- **S0 (where).** Only row-scalar members (rank = block depth) of multi-statement block-mode groups. A
  reduction inside a row member already has its terms spread one output element per thread, as stage 2 spread
  them; a thread-mode group is stage 2's mapping; a singleton is stage 2's own kernel. Refusal reason recorded
  per reduction.
- **S3 (no nesting).** A reduction inside another reduction's body keeps the inline fold (cooperation would
  need a barrier per enclosing term). The enclosing reduction stages; its terms run the inner fold inline.
- **S4 (no split bounds).** Reductions with `blocks`/`tail` extents (split-sum) keep the inline fold; the
  ragged term space is unmeasured. Optimized programs stay exact.
- **S1 (no pure addressing).** The body is not a single load. Measured with the fused kernel on both sides
  (script 03): staging a copy of a staged row (softmax's `m`) ran 3% slower; staging single loads of a global
  tensor measured neutral; everything that computes — a division per term, a multiply of loads (1.12×), and a
  20 000-term fold whose pool pushed the row set into the scratch fallback (2.8×) — staged faster. An earlier
  draft restricted staging to bodies with a division or a transcendental; the probes refuted that and the rule
  was widened.

**Refused fusions** (unchanged from stage 3, still recorded): reads of a member at another row or shifted
leading index, different leading extents, statements that read no member (no horizontal fusion), staging
attention's `k` (uncoalesced; tiling is a later stage), recomputation, reordering.

## The rule that decides fusing

`planFusion(fn, shapeValues?)`. Thread-mode groups always fuse (stage 2's mapping, strictly less traffic).
For block-mode groups, `runTixCuda` derives the shape values from the inputs' parameter shapes and passes
them; `cudaSource` and `checkLowering` have no values and plan without the gate, as stage 3 did. With values,
a block-mode group stays unfused when **both**:

1. no member folds a serial chain as long as the row (every reduction's flattened count below the longest
   member row), and
2. the row count is below **64** — the measured crossover.

The measurements behind it (script 02, one batch per lowering, ten row counts each):

- **Fold-dominated groups never lose.** Softmax and layernorm shapes, N = 1…4096, C = 1024, 4096, 16 384 and
  1 048 576: fused/unfused ratios 0.14–0.64 — stage 2's row-scalar kernel folds on one thread per row over
  uncoalesced global loads, and the fused kernel's staged (or shared) fold wins at every row count, including
  softmax over a single row of 1 048 576 (40.1 ms against 111.8 ms). Stage 3's feared few-rows case does not
  exist for these groups.
- **Row-phase groups lose below the crossover.** A group whose work is `tanh·exp` per element with a trivial
  fold and nothing fusion can save at row scale (`z` read through `z[i+0,j]`, so nothing is staged): fused
  9.6× slower at one row, 5.1× at 4, parity (0.93) at 32, ahead from 64 (0.77) and clearly ahead at 96+
  (0.52). The same group **with the row staged** lost identically (9.6× at one row) — staging is not the
  discriminator, the fold is. The crossover was about 32 rows at C = 1024, 4096 and 16384 alike; the
  threshold 64 is the next measured grid point, above the parity zone with the 2–5% run-to-run noise in mind.
  Below the threshold the gate's cost is a missed win of at most about 1.3×, never a loss: the gated program
  plans stage 2's singleton kernels, exact by stage 2's own check, and the fused-vs-unfused comparison is a tie.

At the brief's sizes the gate never fires (rows ≥ 1024, folds as long as rows in softmax and layernorm), so
the corpus programs lower and run exactly as stage 3 planned them, now with staged terms where the rules
allow. The gate is a performance heuristic outside the checked transformation: the contracts layer checks one
subject artifact per transformation against a whole case set with different shapes, so a shape-parameterized
plan cannot live inside the checked lowering; both outcomes of the gate are lowerings the contract already
checks on their own.

## Results

GPU time is `runTixCuda(..., { benchmark: true })` (one warm-up launch, median of three CUDA-event intervals,
under the `--timed` lock); the table gives the median of three such calls (scripts 04 and 05). Inputs are seed
20, f32 in [−0.1, 0.1], layernorm eps = 1e-5. "Parallel terms" lists the reductions of each block-mode kernel
whose terms the block computes and one thread folds.

| Program | Kernels fused / unfused | Parallel terms (fused) | Fused ms (3 calls) | Unfused ms (3 calls) |
| --- | --- | --- | --- | --- |
| matmul, M = K = N = 512 | 1 / 1 | — (singleton, stage 2's kernel) | 0.217 | 0.208 |
| softmax, N = 4096, C = 1024 | 1 / 4 | none (both folds read row buffers) | **0.386** | 0.809 |
| layernorm, N = 4096, D = 1024 | 1 / 4 | `variance` | **0.202** | 0.494 |
| attention, Q = K = 1024, D = V = 64 | 1 / 6 | none (folds over buffered rows or row members) | **0.754** | 1.046 |
| mlp, N = 1024, D = 256, H = 1024, O = 256 | 1 / 3 | none (the contractions are row members) | **0.725** | 0.939 |
| conv2d, N = 8, C = 16, H = W = 64, O = 32 | 1 / 1 | — (singleton, stage 2's kernel) | 0.165 | 0.164 |
| layernorm inside (no `centered` statement) | 1 / 3 | `mean`, `variance` | **0.194** | 0.391 |
| attention inside (with `l`, no `weight`) | 1 / 5 | none (see below) | **1.412** | 1.525 |

Matmul and conv2d have one statement each: their fused and unfused sources are byte-identical (asserted in
`fusion.test.mjs`), so the 0.217/0.208 and 0.165/0.164 differences are run noise.

### Staged against stage 3's own fused lowering (script 05, three calls each)

| Program | Staged terms | Inline folds (stage 3 lowering) | Unfused (stage 2) |
| --- | ---: | ---: | ---: |
| layernorm | **0.200** | 0.207 | 0.487 |
| layernorm inside | **0.198** | 0.491 | 0.391 |
| softmax | 0.388 | 0.388 | 0.829 |
| attention inside | 1.413 | 1.412 | 1.504 |
| mlp | 0.726 | 0.725 | 0.941 |

The inline-folds column is the plan with the staging entries cleared — the stage-3 lowering of the same
program (its kernel bodies byte-for-byte apart from the comment line). Layernorm inside is the case the brief
described: stage 3's fused kernel (0.491) was 1.26× slower than unfused (0.391); with the terms staged, the
fused kernel runs 0.198 — 2.5× faster than stage 3's and 2.0× faster than unfused. Softmax, attention inside
and mlp stage nothing, and their staged and inline columns are equal as they must be. All fifteen digests in
the two tables agree; at reduced sizes the interpreter agrees too (script 04, `exactSmall`).

**Attention inside, and what was refused there.** Its divisions live in `score` and `out` — row members whose
terms already run one output element per thread (S0) — and its row-scalars `shift` and `l` fold over buffered
rows (S1). So nothing stages, fused stays at stage 3's 1.412, and the win over unfused remains the traffic
saving (1.412 against 1.504). Parallelizing the row members' terms would need cross-thread cooperation per
output element (the row has 64 elements, the fold 1024 terms); that is a different mapping, recorded as
refused, not a staging.

## Framework and tool changes

**None to `src/framework/` or `tools/cuda-remote.mjs`.** The framework expressed everything this stage
needed: the transformation gained only a version bump and an optional field; the differential, the
correspondence, the pass machinery and the meaning gate were reused as they are. The known gap —
correspondence entity lists are not compared with the artifacts' entities — is being fixed in
`src/framework/ir/` by another ticket; this stage did not touch the correspondence code, as instructed.

Tensor-side changes, each with its reason:

- `FusionPlan`/`FusionGroup` carry `terms`, `termRefusals` and `unfused` (the gate's decisions): the plan
  decides, the emitter follows — the stage-3 design's division of labour, now covering term staging.
- `planFusion(fn, shapeValues?)` and `runTixCuda` deriving the values from the inputs: the gate's second
  condition needs the row count, which exists only at launch (see the framework note above).
- `CudaIR` and `tensor.lower-cuda` at version 3, kernels carrying an optional `terms` count, and the
  correspondence evidence listing staged-term counts per kernel: the artifact records what the lowering now
  does, and the version bump keeps old cached evidence from being mistaken for the new lowering's.
- `cudaSource` and `checkLowering` are unchanged in signature; `fuse: false` still emits stage 2's bytes
  (the digest test passes).

**Framework finding (argued, not changed):** the contracts layer cannot express a lowering whose plan depends
on the subject's runtime shapes — one artifact is checked against a case set of many shape assignments. The
launch gate therefore lives in `runTixCuda`, outside the checked transformation. This is safe because both
outcomes are independently checked lowerings, but a framework extension — a per-case subject projection, or a
declared performance port the manager records without checking — would let the gate itself be carried in the
artifact. Not built here; the report of the entity-universe ticket may want it.

## What the contract checks and what it costs

`checkLowering(program, fn, { fuse })` runs `tensor.lower-cuda` (version 3) through the manager: the plan
(staging decisions and refusals included), the source, and the `kernels` correspondence; the `ensures`
invariant `tensor.cuda-meaning` compares every case's GPU output with the current revision's f32 meaning word
for word, NaN as a class, over stage 2's case recipe (shape assignments 1/3/4/7, every symbol distinct, all
zeros and one zero at a time — so empty extents and empty grids are exercised, including staged reductions
with count 0 — and four input streams). The staged term phase and fold run inside every case that has a
block-mode group; the reversed-fold mutant shows the check catches a wrong fold order.

Cost (script 06, cold `checkLowering` including nvcc and the GPU batch, then the memoized repeat):

| Program | Fused cold | Fused repeat | Unfused cold |
| --- | ---: | ---: | ---: |
| softmax | 2.55 s | 3 ms | 2.20 s |
| layernorm | 2.34 s | 3 ms | 2.22 s |
| layernorm inside | 2.22 s | 3 ms | 2.25 s |
| attention inside | 2.34 s | 1 ms | 2.22 s |

All accepted as `exact`. The staged lowering costs no more than stage 2's check (stage 3 reported 2.2–3.7 s);
the staged kernels compile in the same batch.

## Measured, and only argued

**Measured on the GB10:** every number in the three tables; the grid and crossover (script 02, four shape
families); the staging probes (script 03); the contract costs (script 06); the feature battery (script 07:
exp-terms, a two-axis staged fold, a staged max, a staged reduction with an inline nested one, two staged
reductions in one member, a staged max feeding a row member — all `exact`, all word-equal to the interpreter);
the GPU tests, including the reversed-fold mutant, the split-sum refusal and the gated launch.

**Argued, not measured:** that staging keeps the bits for every program in the domain (the construction in
"How the terms are staged"; the measurements are samples); the term pool's reuse safety across members
(barrier argument); the explanation of why stage 2's row-scalar kernels lose at any row count when the fold
dominates (uncoalesced per-row loads — consistent with every ratio in the grids, not profiled); the missed
wins below the gate threshold (bounded by the measured ratios at the crossover); softmax's remaining time
being bound by the exactly rounded `exp` (stage 3's measurement, unchanged here).

## Later

- Cooperative term staging for row members (per-element folding with threads above the row length) — would
  attack attention-inside's serial divides; a different element mapping, not a staging.
- An exact and cheaper f32 `exp` (softmax's floor, stage 3's number, unchanged).
- Carrying the launch gate inside the framework (see the finding above); reusing dead row buffers; several
  rows per block; reordering, horizontal fusion, tiling — as in stage 3's list.
