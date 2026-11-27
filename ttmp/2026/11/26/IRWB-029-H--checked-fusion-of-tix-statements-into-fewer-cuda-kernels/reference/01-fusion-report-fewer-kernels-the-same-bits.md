---
Title: 'Fusion report: fewer kernels, the same bits'
Ticket: IRWB-029-H
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-contract.ts
      Note: One lowering definition per lowering, same exact invariant
    - Path: repo://src/tensor/cuda-source.ts
      Note: One scalar emitter for both lowerings, plus the block-per-row kernel
    - Path: repo://src/tensor/fusion.ts
      Note: The plan and its legality rules
    - Path: repo://tests/tensor/cuda-gpu.test.mjs
      Note: Bit-identity of the fused lowering and a fold mutant on the GB10
    - Path: repo://tests/tensor/fusion.test.mjs
      Note: |-
        Plan, kernel count and staging tests that need no GPU
        Plan and kernel-count tests
ExternalSources: []
Summary: Fusion lives in the emitter as a plan computed on the Tix IR; one kernel per corpus program at 1.0x to 3.15x stage 2's GPU time, bit-identical.
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Fusion report: fewer kernels, the same bits

Stage 2 launched one kernel per statement. Stage 3 launches one kernel per **fused group**, where a group is a
contiguous run of statements that share a row extent and are connected by a data dependency. Every corpus program
now lowers to a single kernel, the results are bit-identical to the f32 meaning, and the GPU time falls by 1.04x to
3.15x where fusion had something to remove. No framework source changed.

The short version of why the results can be bit-identical at all: the stage 2 emitter had already fixed every
rounding site, and fusion only changes *where a value lives* (a register, shared memory, global memory) and *which
thread computes it*, never the sequence of rounded operations on any output element. The one rule that could break
that is splitting a fold across threads, and this stage never does: every reduction stays one thread's serial loop
with one rounding per step, in the meaning's order.

## Where fusion lives: the emitter, from a plan computed on the Tix IR

`fusePlan(fn)` in `src/tensor/fusion.ts` is a pure function from the current Tix function to an ordered list of
kernels; for each statement it decides the kernel, the storage class and the rule that admitted it. `emitCuda(fn,
{fuse})` prints that plan. `fuse: false` bypasses the plan and prints stage 2's text. The three candidates were:

| Candidate | Why not |
| --- | --- |
| A pass on the Tix IR | Kernel boundaries, thread mappings and storage classes carry no meaning. The stage 1 meaning gate compares statement values, so it could not check such a pass, and the Tix adapter would have to advertise relations that are not about the language. |
| A second v6 artifact (a kernel IR) between Tix and CUDA | It carries exactly the missing information, but either it restates each resolved statement tree (a second copy of what `inline` and `split-sum` rewrite, to validate and keep in step) or it names statements of the Tix function, at which point it is a projection of one revision that lives for one lowering: a plan. Its other use would be a v6 correspondence record, and the artifact that has to be judged is the CUDA translation unit, which already is one. |
| **The emitter, from a named plan (chosen)** | The plan is a pure function of the current revision, the source text already exposes the grouping (a kernel's parameter list names exactly the tensors its group reads and writes), and a local test asserts the plan's kernel count equals the number of `__global__` definitions, so the plan and the text cannot drift. |

**Framework finding (probe 01).** The framework *can* express several statements becoming one kernel, but not for
this artifact. `makeCorrespondence` accepts a grouped entry `{from: [m, s], to: [k0]}` and
`validateCorrespondence` accepts it, so a many-to-one relation is expressible. Both universes must exist, though:
with no target entities, the same entry is rejected with `Unknown target entity k0`, and an entry with an empty
target list records a *removal*, not a grouping. The CUDA artifact is `{fn, source}` with no adapter, so there is
no target entity for a statement to correspond to, and stage 2's lowering has no correspondence requirement for
exactly that reason. Recording statement→kernel groups would need the kernel IR above, whose only remaining job
would be to supply that entity universe. `scripts/01-grouped-correspondence-probe.mjs` shows all four outcomes.

**Proposal, not made.** If a later stage needs the correspondence, the smallest framework change is a
`correspondence` record variant whose target side is *labels inside a payload* rather than adapter entities: for
example `defineIR` gaining an optional `groups(value): string[]`, so a many-to-one record can name `k0` without an
adapter, a rebuild callback or a second revision identity. Nothing in this stage needs it, so it is not built.

## What may change under fusion, and what may not

Reused unchanged from stage 2: explicit `__fadd_rn`/`__fsub_rn`/`__fmul_rn`/`__fdiv_rn`/`__fsqrt_rn`,
`exp`/`log`/`tanh` in double rounded once with `__double2float_rn`, a NaN-propagating min/max helper, one fold step
per iteration with a rounding after each, accumulation in increasing lexicographic index order with the first
binder outermost, and f32 at every store. Both lowerings share **one** scalar-expression emitter
(`scalarEmitter` in `cuda-source.ts`); they differ only in the address a load becomes and where the lines are
written. A second copy of the arithmetic would be a second chance to round differently.

| Rule | What it does |
| --- | --- |
| P1 pointwise substitution | A statement whose expression holds no reduction, is not the result, and has no read inside any reduction is recomputed at each read: no buffer, no kernel. Its value at a coordinate is a pure function of that coordinate, so recomputation gives the same words. This is the checked `inline` pass generalized to several reads. |
| P2 thread-local substitution | A statement that *does* hold a reduction is recomputed only where its single read sits at the reader's own coordinate, outside every reduction (`mlp`'s `h`). The recomputed fold then runs once per element, by the owner thread, in the same order. |
| P3 row kernel | Consecutive statements that share the first-axis extent and read something an earlier member writes become one kernel: `blockIdx.x` is the row, `threadIdx.x` strides the second axis. A reduction over the lane axis is a serial fold by one thread; every other reduction is a per-thread serial fold. |
| P4 staging | A value read only inside its kernel is staged in shared memory instead of global memory, and a global row that a fold reads is copied into shared memory by the whole block first, so the loads are coalesced and the fold works on chip. |

A run of one statement has nothing fused, so it keeps stage 2's mapping and its text byte for byte
(`matmul` and `conv2d` differ in no character). `tests/tensor/fusion.test.mjs` asserts that. Compared against the
committed stage 2 emitter, `fuse: false` differs by one line of shared preamble — the `#include <string>` the fused
launch's error message needs — and in no kernel, argument list, address or rounded operation.

### Legal-looking fusions that are refused

| Refusal | Legal? | Why it is not applied |
| --- | --- | --- |
| P1 on a value read inside a reduction (softmax's `e` into the sum) | Yes: the recomputation is the same expression at the same coordinate. | It would put a double-precision `exp` into one thread's serial fold, once per row element instead of once per lane. This is why `e` is staged in shared memory instead. Refused by rule; the cost is argued, not measured. |
| Folding a reduction into a read that a reduction encloses (attention's `score` into `shift` and `z`) | Yes: each copy is the same fold in the same order. | It multiplies the producer's global reads by the enclosing iteration count: a 64-term contraction recomputed once per column of a 1024-wide row. Argued. |
| Grouping statements whose first-axis extents differ, or ranks above two | Yes. | The block-per-row mapping needs one row extent per kernel, and this stage has no second mapping. These stay flat, one kernel per statement. |
| Staging a value that a different kernel reads, or that a reader indexes at another coordinate (`t[i,j] = s[j,i]`) | Yes, the words are identical either way. | The shared copy is per block; a reader in another block, or reading another row's element, would read the wrong words. It stays global and the reader goes to global memory. |
| Reassociating a fold: parallel trees, warp shuffles, split-K | Faster. | It moves where the roundings happen, so it changes the meaning. Out of stage scope, and the reason it cannot be done here is not effort but the contract. |

## What the plan does per corpus program

`s` = staged in shared memory, `g` = global memory. From `scripts/04-bytes.mjs`.

| Program | Stage 2 | Fused kernel | Why |
| --- | --- | --- | --- |
| matmul | 1 flat kernel | 1 flat kernel, byte-identical | One statement: nothing to fuse. |
| conv2d | 1 flat kernel | 1 flat kernel, byte-identical | One rank four statement: nothing to fuse, and rank four keeps the flat mapping. |
| softmax | `m g, e g, s g, y g` / 4 kernels | `m s, e s, s s, y g` / 1 kernel | `x`'s row is copied in once; the max, the exponential row, the sum and the divide all live on chip. |
| layernorm | `mean g, centered g, variance g, y g` / 4 kernels | `mean s, centered s, variance s, y g` / 1 kernel | Same shape of fusion; `centered` is read by both the variance fold and the output, so it is staged rather than recomputed. |
| attention | 6 kernels | `score s, shift s, e s, z s, weight s, out g` / 1 kernel | The score contraction runs per lane inside the row kernel, so `score` never reaches global memory; `out`'s reduction over the row reads `weight` from shared memory. |
| mlp | `h g, g g, y g` / 3 kernels | `h s, g s, y g` / 1 kernel | The contraction stages one row of `h`, the GELU epilogue runs over that row, and the second contraction consumes the staged `g`. |

## Kernel counts, GPU time

Three `runTixCuda(..., {benchmark: true})` calls per cell (each one warm-up and the median of three CUDA-event
intervals), median of the three shown with the three in brackets. GB10, CUDA 13.0.88, `nvcc -O3 -arch=sm_121`,
`sizes` as in the brief. `scripts/05-benchmark.mjs`, one run of it.

| Program (sizes) | Kernels fused / unfused | Fused ms | Unfused ms | Speed-up | Bytes floor (fused) |
| --- | --- | ---: | ---: | ---: | ---: |
| matmul (M=K=N=512) | 1 / 1 | 0.2143 [0.2141 0.2143 0.2148] | 0.2175 [0.2132 0.2175 0.2182] | 1.02x | 0.013 ms |
| softmax (N=4096, C=1024) | 1 / 4 | 0.4245 [0.4200 0.4245 0.4251] | 0.8111 [0.8013 0.8111 0.8150] | **1.91x** | 0.138 ms |
| layernorm (N=4096, D=1024) | 1 / 4 | 0.1541 [0.1538 0.1541 0.1572] | 0.4857 [0.4835 0.4857 0.4933] | **3.15x** | 0.138 ms |
| attention (Q=K=1024, D=V=64) | 1 / 6 | 0.7876 [0.7827 0.7876 0.7938] | 1.0478 [1.0458 1.0478 1.0484] | **1.33x** | 0.004 ms |
| mlp (N=1024, D=256, H=1024, O=256) | 1 / 3 | 1.0119 [1.0078 1.0119 1.0152] | 1.0559 [1.0530 1.0559 1.0683] | 1.04x | 0.017 ms |
| conv2d (N=8, C=16, H=W=64, O=32) | 1 / 1 | 0.1662 [0.1661 0.1662 0.1672] | 0.1650 [0.1643 0.1650 0.1661] | 0.99x | 0.025 ms |

`matmul` and `conv2d` emit the same translation unit either way, so their ratio measures this machine's noise,
about 2%, and not the lowering. The unfused column reproduces the brief's stage 2 numbers within their stated
variation (softmax 0.785 reported, 0.811 here; layernorm 0.563, 0.486; attention 1.81, 1.048; mlp 1.05, 1.056;
conv2d 0.341, 0.165; matmul 0.197, 0.218).

Where the remaining time goes, argued from the byte counts and one measurement each:

- **layernorm** is at 1.1x its compulsory-traffic floor (0.154 ms against 0.138 ms). The fusion removed almost all
  of the avoidable traffic; what is left is one read and one write of 16 MB.
- **softmax** is at 3.1x its floor. It is not memory bound: it computes 4.2 M double-precision `exp`s, which stage 2
  pays too, plus two 1024-step serial folds per row. Its fusion removed 100 MB of traffic and 3 kernels.
- **attention** is bound by re-reading `k` and `v` once per query row (805 MB of issued loads for 1.05 MB of
  compulsory traffic). Removing that needs tiling for data reuse, which is a later stage. Fusion still removed
  5 kernels and 306 MB.
- **mlp** is bound by its `tanh` (one per hidden element) and its two contractions: 8 kernels' worth of traffic
  collapsed into one, and the time barely moved, which is the measurement that says the epilogue fusion was not
  where mlp's cost was.
- **matmul** and **conv2d** have one statement each, so there is nothing to fuse and no change. Their issued-load
  counts (1.07 GB and 1.14 GB against 3.15 MB and 6.05 MB of compulsory traffic) say their time comes from
  uncoalesced or repeated reads that only tiling could fix.

## Bytes read and written, and the time they would take at 244 GB/s

Two counts, because one number cannot say what the memory system does (`scripts/04-bytes.mjs`):

- **issued** — every load and store instruction × 4 bytes, summed over the threads that execute it. What L1 and L2
  must serve; an upper bound on DRAM traffic.
- **distinct** — per kernel and tensor, `min(issued, tensor size)`. The compulsory traffic; a lower bound on DRAM
  traffic (exact when a kernel reads a whole tensor, an over-estimate when it reads a slice).

| Program | Issued fused / unfused | Distinct fused / unfused | At 244 GB/s: issued f / u | distinct f / u |
| --- | --- | --- | --- | --- |
| matmul | 1074.79 / 1074.79 MB | 3.15 / 3.15 MB | 4.405 / 4.405 ms | 0.013 / 0.013 ms |
| softmax | 33.55 / 134.25 MB | 33.55 / 100.73 MB | 0.138 / 0.550 ms | 0.138 / 0.413 ms |
| layernorm | 83.89 / 201.36 MB | 33.56 / 100.74 MB | 0.344 / 0.825 ms | 0.138 / 0.413 ms |
| attention | 805.57 / 1111.76 MB | 1.05 / 34.62 MB | 3.302 / 4.556 ms | 0.004 / 0.142 ms |
| mlp | 3227.52 / 4330.62 MB | 4.20 / 20.98 MB | 13.228 / 17.748 ms | 0.017 / 0.086 ms |
| conv2d | 1137.58 / 1137.58 MB | 6.05 / 6.05 MB | 4.662 / 4.662 ms | 0.025 / 0.025 ms |

The fused softmax and layernorm figures agree with the brief's independent estimate (one read and one write of the
16 MB input, about 0.14 ms), which is a check on the counting rather than on the lowering.

Reading the table: where the two counts are far apart the kernel re-reads addresses that the cache serves, so 244
GB/s says nothing about the time — matmul's 4.4 ms bound against 0.21 ms measured, and mlp's 13.2 ms bound against
1.01 ms. Where they coincide, the kernel is stream-bound, and layernorm's 0.138 ms bound against 0.154 ms measured
says the fusion removed essentially all the traffic it could.

## What the contract checks, and what it costs

`checkLowering(program, fn, {fuse})` runs the same invariant as stage 2 — `tensor.cuda-meaning` version 2, the
**exact** relation: equal output shape and length, then every f32 word equal, signed zeros and infinities included,
NaN compared as a class — against the current revision's f32 meaning. One definition per lowering
(`tensor.lower-cuda-fused`, and stage 2's `tensor.lower-cuda` for `fuse: false`), one artifact kind, no framework
change. A rejected candidate reports its first counterexample.

From `scripts/07-contract-cost.mjs`:

| Program | Cases | Elements compared | Cold check | Replay of the same verdict |
| --- | ---: | ---: | ---: | ---: |
| matmul | 36 | 476 | 2.4 s | 1 ms |
| softmax | 32 | 360 | 2.2 s | 1 ms |
| layernorm | 32 | 360 | 3.9 s | 1 ms |
| attention | 40 | 428 | 4.1 s | 1 ms |
| mlp | 40 | 428 | 2.2 s | 1 ms |
| conv2d | 28 | 5900 | 2.8 s | 0 ms |

A cold check is dominated by `nvcc` on the GB10 (compiling one translation unit) and by the run; generating the
cases and their f32 references locally takes 2 ms to 277 ms. A repeat check of the same candidate revision replays
the recorded verdicts in about a millisecond, which is why `fuse: false` on matmul or conv2d shows 1 ms: their
lowering is the same artifact revision, so the verdict is the same evidence.

Samples, not proofs: 28 to 40 shape assignments, the f32 references of the current revision, tensors of at most
4096 elements. What makes the exact relation meaningful here is the base's own evidence — explicit round-to-nearest
arithmetic, and `exp`/`log`/`tanh` in double rounded once, which the stage 2 ticket checked against all 2^32 f32
inputs — plus the direct bit-identity tests: `tests/tensor/cuda-gpu.test.mjs` compares fused against unfused and
against `runTix` word for word on the corpus and on six edge programs, so the fused result is pinned independently
of the case list.

The contract also catches what fusion might have broken. One test mutates a fused kernel to drop the last lane of the
sum fold (`end_r1 = (d1) - 1`); `checkLowering` rejects it with a counterexample at a named coordinate, and accepts
the unmutated lowering.

## Thread mapping changes, and their reasons

| Change | Reason |
| --- | --- |
| Block per row instead of one thread per element | A fold over the lane axis has to stay in one thread. With a block per row, the row can be staged on chip and the fold reads shared memory instead of issuing strided global loads from a single thread. |
| `threadIdx.x` strides the lane axis (`for (l = threadIdx.x; l < lanes; l += blockDim.x)`) | Keeps the loads coalesced for any lane extent while the block size stays a compile-time constant. |
| One `__syncthreads()` after each statement | A staged value has to be visible to the other lanes and to the single fold. One barrier per statement is uniform across the block, so no thread waits where another has already left. |
| Copy a global row into shared memory before a fold reads it | The alternative is 1024 dependent loads issued by one thread with a 4 KiB stride. This is what turns softmax from "one thread per row with uncoalesced reads" into a stream. |
| 128 threads per block, from 256 | A fold is one thread's serial work, so the number of *resident blocks* sets how many rows are folded at once. Measured (`scripts/06-block-size.mjs`, two runs, spread under 1%): softmax 0.414 ms at 128 against 0.609 at 256 and 0.492 at 64; layernorm 0.152 against 0.180 and 0.168. The flat mapping keeps 256, so `fuse: false` is untouched. |
| The shared-memory requirement is checked at launch, not assumed | A row footprint larger than the device allows makes the launch throw `k0 needs N bytes of shared memory per block; the device allows M`. This is the one boundary the fused lowering adds to stage 2's input domain; 12 KiB is the largest the corpus needs. |

## Framework and tool changes

- **`src/framework/`: none.** The heterogeneous transformation, the differential invariant with an asynchronous
  `decide`, the exact-relation comparison, the memo and the in-flight batch sharing were all sufficient. Two
  lowering definitions were enough to carry `fuse`; each candidate is identified by its own artifact revision, so
  the existing subject key already tells a fused verdict from an unfused one. The one place the framework does not
  fit is the correspondence of statements to kernels, described above and proposed rather than patched.
- **`tools/cuda-remote.mjs`: none.** Its `--runtime-input`, per-job directories, per-key compile lock, `--timed`
  GPU lock and `--link` were already what this stage needed; the fused lowering emits one translation unit per case
  exactly as stage 2 did.
- **`src/tensor/`:** `fusion.ts` is new (the plan); `cuda-source.ts` gained the block-per-row kernel and one shared
  scalar emitter; `cuda-contract.ts` gained a second lowering definition; `index.ts` gained `fuse` on
  `cudaSource`/`runTixCuda`/`checkLowering` and `benchmark` on `runTixCuda`.

## What I measured, and what I only argued

Measured on the GB10:

- the exact-relation verdict for both lowerings on the corpus before and after `inline` + `split-sum`, and on 17
  small edge programs: 58 checks, all accepted (`scripts/03-exactness-probe.mjs`);
- fused vs unfused bit-identity, and fused vs `runTix` f32 bit-identity, on the corpus at small sizes and on six
  edge programs (`tests/tensor/cuda-gpu.test.mjs`);
- kernel counts, per-kernel decisions, issued and distinct global bytes (`scripts/04-bytes.mjs`);
- benchmark GPU time per corpus program, both lowerings, three calls each (`scripts/05-benchmark.mjs`);
- 32/64/128/256 threads per block for the two fold-heavy programs (`scripts/06-block-size.mjs`);
- case counts, compared elements, cold and replay check cost (`scripts/07-contract-cost.mjs`);
- that the framework accepts a grouped correspondence and rejects one with no target universe
  (`scripts/01-grouped-correspondence-probe.mjs`).

Argued, not measured:

- the cost of the *refused* fusions (P1 inside a reduction, folding attention's `score`): the rule states why they
  are worse, and no build produced them;
- that a row footprint above the device's shared-memory limit is the only new boundary: it is enforced by an
  explicit check, and no test reaches it;
- where the residual time in softmax, attention, matmul and conv2d goes: the byte counts bound it, but nothing here
  profiles instruction-level stalls.

## What I would do differently, and what is left

- **Several rows per block.** A fold is serial per row, so putting four rows in one block — one warp each — would
  let four folds run concurrently per block at 128 threads, and would cut the wave count by about four on softmax
  and attention. It touches every shared access (a per-row base offset) and was left out for time, not for legality:
  the fold would still be one thread's serial loop.
- **A measurement for each refusal.** Two of the refused fusions are argued from arithmetic on the byte counts. A
  variant build that applies one of them would turn each argument into a number.
- **The kernel IR.** If a later stage needs the statement→kernel correspondence in a v6 record, the plan is the
  natural place to publish it, and the framework change above is the missing piece.
- Anything that reassociates a fold — parallel trees, split-K — tiling for data reuse, tensor cores, streaming
  attention, autotuning: later stages, and the last one is what attention's 805 MB of issued loads actually needs.
