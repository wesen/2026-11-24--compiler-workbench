---
Title: A schedule IR between Tix and CUDA, and exact tiled contractions
Ticket: IRWB-033-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR, its adapter, its passes and the order analysis
    - Path: repo://src/tensor/strategy.ts
      Note: The rule that picks schedules (a sequence of pass applications)
    - Path: repo://src/tensor/cuda-source.ts
      Note: Prints a schedule; the contraction kernel printer
    - Path: repo://src/framework/passes/define-pass.ts
      Note: Pass legality hook (framework change)
ExternalSources: []
Summary: "A v6 schedule IR between Tix and CUDA; contractions get register- and shared-memory-tiled variants built by checked passes, picked at launch from the shapes; every output keeps its accumulation order."
LastUpdated: 2026-11-27T10:13:35.264251255-05:00
WhatFor: Design of stage 6 before implementation
WhenToUse: Reviewing the schedule IR, its passes, the strategy and what is checked
---

# A schedule IR between Tix and CUDA, and exact tiled contractions

## Executive Summary

<!-- Provide a high-level overview of the design proposal -->

## Problem Statement

<!-- Describe the problem this design addresses -->

## Proposed Solution

<!-- Describe the proposed solution in detail -->

## Design Decisions

<!-- Document key design decisions and rationale -->

## Alternatives Considered

<!-- List alternative approaches that were considered and why they were rejected -->

## Implementation Plan

<!-- Outline the steps to implement this design -->

## Open Questions

<!-- List any unresolved questions or concerns -->

## References

<!-- Link to related documents, RFCs, or external resources -->

## Goal and domain

Make contractions fast in the fused lowering (`fuse: true`) without changing any result bit, and put a schedule IR between Tix and CUDA so that every lowering decision is a checked step. The domain is stage 3b's: any function of the checked core, called with consistent shapes, finite inputs, in-bounds reads and sizes the GB10 can allocate and launch. `fuse: false` keeps printing stage 2's bytes.

A **tileable contraction** is a statement whose expression contains exactly one reduction, which is outermost (`sum`, extents of kind `dim`), whose body is `X[...] * Y[...]` with X and Y tensors outside the kernel's members, and where X reads at least one output axis that Y does not read and vice versa. Everything else of the statement (the *epilogue*: `/ sqrt(D)`, `+ bias[j]`) is pointwise in the outputs. All five contractions of the corpus are tileable (matmul, attention's `score` and `out`, mlp's `h` and `y`, conv2d). Reductions that are not tileable (`max`, a sum of a single load, split-sum's nested sums, three-operand bodies) keep stage 3b's code.

## Baseline (probe 01, hand-written kernels in the scheme the emitter will print)

Probe 01 (`scripts/01-tile-probe/`) times one-thread-per-output against eight register- and shared-memory-tiled variants, all exact (separate `__fmul_rn` / `__fadd_rn`, k ascending per output), at the brief's contraction shapes. Every variant was bit-identical to the one-thread kernel at all eight shapes. Best per shape (ms; one warm-up + median of 3):

| M × N × K | one thread per output | best tiled | variant |
| --- | ---: | ---: | --- |
| 512³ | 0.242 | 0.044 | 32×32 tile, 4×4 per thread, 64 threads |
| 1024 × 1024 × 64 (attention score) | 0.089 | 0.023 | 32×32 / 4×4 |
| 1024 × 64 × 1024 (attention out) | 0.092 | 0.046 | 32×32 / 2×2, 256 threads |
| 1024 × 1024 × 256 (mlp h) | 0.490 | 0.072 | 64×64×16 / 4×4 |
| 1024 × 256 × 1024 (mlp y) | 0.510 | 0.086 | 32×32 / 4×4 |
| 4096³ | 213.9 | 15.7 (8.8 TFLOP/s) | 128×64 / 8×4, 256 threads |
| 256 × 256 × 1 | 0.0035 | 0.0027 | 32×32 / 4×4 |

No single variant wins everywhere: big tiles lose when the grid has fewer blocks than the GPU can hold, small tiles lose arithmetic intensity at large sizes. Since `cudaSource` does not know the shapes, the tile size is chosen **at launch** among a few variants compiled into one templated kernel, as 3b's gate does.

## The pipeline

```
Tix --planFusion--> initial schedule --passes (strategy)--> final schedule --print--> CUDA source
```

1. **Initial schedule** (`initialSchedule(fn, plan)`): one schedule kernel per fusion group of `planFusion` (or `unfusedPlan` for `fuse: false`).
2. **Strategy** (`scheduleFunction`): a fixed sequence of pass applications decided from the IR (below). Each application goes through the framework's `applyNativePassSync`, with a gate that runs the order analysis on both revisions.
3. **Printing** (`emitSchedule`): pointwise and rows kernels are printed by the existing stage 2 / 3 / 3b printers; contraction kernels by a new printer that reads every number from the schedule. With no contraction kernel the printer produces exactly `emitCuda(fn, plan)`'s bytes, so `fuse: false` is unchanged.

**Fusion feeds the schedule from its plan** (the choice the brief asks for). Fusion legality is a question about Tix reads, which `planFusion` answers; re-expressing 3b's staged terms, in-place rows and gate as loop-level passes would re-implement them without adding a check, because their correctness argument (one thread per element, the same scalar code) does not change. The schedule IR keeps a rows kernel as one construct holding its `FusionGroup`, and adds one kernel-level pass (`isolate`) that changes fusion decisions.

## The schedule IR (`tensor.schedule`, version 1)

A v6 artifact (`defineIR` and a v6 adapter) holding the algorithm and its schedule, in the Halide sense:

```ts
interface Schedule { fn: Fn; kernels: SKernel[] }          // fn: the Tix function (the algorithm), unchanged
type SKernel =
  | { name; kind: 'pointwise'; group: FusionGroup }       // one thread per element, members in registers
  | { name; kind: 'rows'; group: FusionGroup }            // stage 3/3b block mode, gate included
  | { name; kind: 'contraction'; group: FusionGroup; contraction: string;
      dims: { b: string[]; m: string[]; n: string[]; r: string[] };   // axis ids, each list in order
      operands: { m: string; n: string };                  // which tensor varies with m, which with n
      variants: Variant[]; select: { variant: number; minBlocks: number }[] };
interface Variant { loops: Loop[]; stages: Stage[] }
interface Loop { id: string; dim: 'b' | 'm' | 'n' | 'r'; level: number; factor: number | null;
                 bind: 'serial' | 'thread' | 'block.x' | 'block.y' | 'block.z' | 'thread.x' | 'thread.y' | 'unroll' }
interface Stage { operand: 'm' | 'n'; at: string; scope: 'shared'; fast: 'r' | 'm' | 'n' }
```

- **dims** flatten axes row-major: `m` is the output axes only the m-operand reads, `n` those only the n-operand reads, `b` the other output axes, `r` the reduction axes in the order the reduction lists them. So increasing `r` is the meaning's lexicographic order (first axis outermost). For conv2d, m = (n, y, xpos), n = (o), r = (c, dy, dx).
- **Loops** are the nest, outermost first. A dim split into levels has value Σ index_l · Π_{l' > l} factor_{l'}; level 0 has `factor: null` (the rest, ceil-divided). Variant 0 is the plain nest `b, m, n` bound to `thread` (one thread per output, printed with stage 3's thread-mode code) and `r` serial.
- **Stages** copy an operand's tile into shared memory at loop `at`, covering every point of the loops inside `at` and the block's thread loops; `fast` names the dim whose consecutive elements are adjacent in global memory, which the copy assigns to consecutive threads (coalescing).
- **select** is the launch rule: the first entry whose grid has at least `minBlocks` blocks (as a multiple of the device's SM count) wins; the last entry has `minBlocks: 0`.

The adapter's entities are the kernels, variants (`k0/v1`), loops (`k0/v1/m.1`) and stages; `entities(value)` on `defineIR` lists the kernels, so the contracts manager checks correspondence lists against the artifact (F23).

**Printable form.** The printer accepts variant 0 and variants whose nest is exactly `b(block.z) m.0(block.x) n.0(block.y) m.1(thread.y) n.1(thread.x) r.0(serial) r.1(unroll) m.2(unroll) n.2(unroll)` with both operands staged at `r.0`. Anything else is valid IR that the printer rejects with "schedule not printable: <loop>". Intermediate revisions of the strategy are therefore checked at the IR level only; the final one is checked on the GPU. *Simplest alternative:* no loop nest, a contraction kernel with five tile numbers. It needs no passes, which is the point the brief rejects; the nest also gives the order analysis something to check that a tile-number record could not violate.

## Passes (each a `definePass` on the schedule IR)

| Pass | Parameters | Legality (decided from the IR before `run`) | Correspondence |
| --- | --- | --- | --- |
| `isolate` | — | re-plans with `planFusion(fn, { noBlock })`, `noBlock` = tileable contractions: such a statement never joins an earlier group and its group stays thread mode | old kernel → new kernels, by statements |
| `contraction` | kernel | the kernel is pointwise, exactly one member has a reduction and it is tileable | kernel retained; variant 0 and its loops inserted |
| `variant` | kernel | — | variant 0 → new variant (copy) |
| `split` | loop, factor | loop serial, factor ≥ 1, divides the loop's factor when fixed | loop → two loops (split) |
| `reorder` | order | a permutation; `r` loops keep their relative order | retained |
| `bind` | loop, target | `r` loops only `serial` or `unroll`; each hardware target once per variant; `thread.*` / `unroll` need fixed factors | retained |
| `stage` | operand, at, fast | `at` is an `r` loop; every loop inside it is fixed; tile ≤ 48 KiB | stage inserted |
| `select` | rule | variants exist; the last entry has `minBlocks: 0` | retained |

**Framework change (planned): legality as part of a pass.** `PassSpec` gains `legal?(ctx): CheckResult`, run by `applyPass` and `applyNativePassSync` before `run`; a refusal is `PassError('illegal', reason)`, distinct from a rejected contract. Reason: the brief asks for legality decided from the IR before the step is applied, and today a pass can only throw from `run`, which the framework cannot tell apart from a bug.

## What is checked, and how

**Every pass application** is gated by the **order analysis** (`tensor.schedule.order`), computed on the revision before and after; the gate requires equal values. For every statement with a reduction it gives the accumulation order of each output:

- rows and pointwise kernels: `lexicographic(<axes>)` by construction (stage 2's scalar code, argued in stages 3 and 3b);
- a contraction kernel: for **every variant**, the analysis (a) requires `r` loops to be `serial` or `unroll` (a parallel `r` loop is a reassociation: refused), (b) **simulates the nest** at small extents (m = 5, n = 3, r = 11 and r = 1; b = 2), and for each output collects the sequence of in-range `r` values it receives, and (c) requires that sequence to be 0, 1, …, R − 1 with one accumulator per output. Then the value is `lexicographic(<r axes>)`, else `reordered(<first failing output>)`.

The simulation is the "correspondence that follows each output's accumulation through every step", at small extents: it covers every split, reorder and bind, the tail (extents that are not multiples of the factors) and the register-tile mapping. It does not cover the printer: whether the CUDA source does what the nest says is the GPU check's job.

**Padding is exact (argued).** Tiles are zero-filled where `r ≥ R` (and where m or n is out of range, for outputs that are not stored). A padded term is `__fmul_rn(0, 0) = +0`, and `acc + (+0) = acc` for every acc except −0; acc starts at +0 and `x + y = −0` in round-to-nearest only when both are −0, so acc is never −0. So the zero products of the padding do not change any accumulator. Loads and stores through shared memory move words unchanged.

**The lowering** is still checked by `tensor.lower-cuda` under the exact relation. Every sample is run in every **mode**: for a program with contraction kernels, each variant forced in turn (`--variant=v`), paired with the two gate sides when there is a gate; the case list grows by the number of variants, from one compilation. The cases (sizes up to 11) exercise tails and padding in every tiled variant.

## The strategy

`scheduleFunction(fn, plan)` applies, in order: `isolate` (fused lowering only); for each pointwise kernel with a tileable contraction, `contraction`, then for each tile configuration `variant`, `split` ×5, `reorder`, `bind` ×7, `stage` ×2 (with `fast` from the operand's last index: the dim whose innermost axis appears there with coefficient 1), and finally `select`. The configurations and the rule come from probe 01 and a probe of the printed kernels (script 03), and are fixed as constants with their measurements:

| Variant | Tile m × n × r | Per thread | Threads |
| --- | --- | --- | ---: |
| 1 | 128 × 64 × 8 | 8 × 4 | 256 |
| 2 | 32 × 32 × 8 | 4 × 4 | 64 |
| 3 | 32 × 32 × 8 | 2 × 2 | 256 |

Rule (to be confirmed by script 03): variant 1 when its grid is large, else variant 2 when its grid fills the GPU, else variant 3. Variant 0 is compiled for the contract and as the fallback when a grid dimension exceeds CUDA's limits.

**`src/framework/strategy` does not fit**, and the strategy is a TypeScript function: `cudaSource` is synchronous by the fixed API, and the strategy interpreter's `execute` is asynchronous. *Proposal (not made):* a synchronous `executeSync` for plans whose algorithms are synchronous. With it, the function above becomes a plan of `apply` and `forEach` nodes over the same passes.

**Isolation is always applied to tileable contractions in block groups** (attention, mlp). Block mode computes a contraction with one block per output row, so every block re-reads the whole other operand; the tiled kernel reads each operand tile once per tile of outputs. The cost is kernel count: attention becomes 3 kernels (`score`; `shift, e, z, weight`; `out`), mlp 2 (`h, g`; `y`). *Simplest alternative:* keep the block groups and tile nothing inside them; it leaves 85% of attention's time in place. *Alternative considered and refused:* tiling inside block mode (several query rows per block) — the row phase then needs all of a row's scores in shared memory and the kernel would need a second, multi-row form of 3b's emitter.

## Refused

- Split-K, tree reductions, FMA, tensor cores (the brief).
- Vector loads from global memory: they need alignment and divisibility known at launch, i.e. another variant axis; the shared-memory reads are vectorized (float4 when the per-thread extent is a multiple of 4), which needs nothing at launch.
- Double buffering: not in this session unless time remains; it would be a `stage` parameter.

## API

Unchanged. `planFusion(fn, options?)` gains `{ noBlock?: Set<string> }`. `CudaIR` version 3: a kernel's mapping may be `tiled`. `runCudaBatch(..., { variant })`.

## Measurements

Script 02 (later number) times every corpus program fused and unfused with the brief's protocol (median of 5 alternating `benchmark` calls), and the contractions at their sizes, with TFLOP/s and the ratio to cuBLAS.

## Later

- `executeSync` in the framework strategy, and the strategy as a plan.
- Vector global loads and double buffering as variants.
- Tiling inside block groups (attention without the score round trip).
- A cost model in place of the block-count rule.

## As built

The implementation follows this design. Differences:

- **The order analysis simulates per dim**, not the whole nest: the accumulator is indexed by the output point, so other dims' loops cannot change one output's term sequence (the whole-nest simulation took seconds per step). An empty reduction (r = 0) is among the simulated extents.
- **The printer reads two more choices from the schedule:** which grid axis numbers the m tiles (the strategy binds n.0 to `block.x`, probe 04) and the launch bound per variant (from the thread loops; probe 04).
- **The stage limit** is half of 48 KiB per operand tile (room for the other tile and the padding).
- **`CudaIR` kernels** take the mapping `tiled`; the case list's baseline key is the list of modes.
- `planFusion(fn, { noBlock })` refuses with a reason in `plan.refusals` ("it is a tileable contraction, which starts its own kernel"; "it would put the tileable contraction h in block mode").
