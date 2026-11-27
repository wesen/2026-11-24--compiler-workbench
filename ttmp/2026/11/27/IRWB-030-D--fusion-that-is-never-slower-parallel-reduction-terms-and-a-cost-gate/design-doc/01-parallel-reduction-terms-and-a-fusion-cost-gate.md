---
Title: Parallel reduction terms and a fusion cost gate
Ticket: IRWB-030-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Row-scalar reductions in block-mode kernels compute their terms with all threads and fold them in order on thread 0; a launch-time row-count gate runs stage 2 where block mode is slower.
LastUpdated: 2026-11-27T01:27:18.314730933-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing term staging, the fusion gate and their checks
---

# Parallel reduction terms and a fusion cost gate

## Goal and domain

Make the fused lowering of stage 3 (IRWB-029-D) never slower than stage 2's, without changing a result bit. The domain is stage 3's: every function of the checked Tix core, on the call domain of stages 2 and 3 (consistent shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch). The speed target is the brief's sizes, for the corpus programs and variants of them such as the "inside" placements. The relation stays exact against the current revision's f32 meaning, NaN compared as a class, and `fuse: false` stays stage 2's source byte for byte (stage 3's digest test).

## 1. Parallel terms, serial fold

**What runs serially today.** In a block-mode group, a member with no trailing axes (a *row scalar*: `m`, `s`, `mean`, `variance`, `shift`, `z`) is computed by thread 0 of the row's block, with every reduction's body evaluated inside thread 0's loop. In stage 2 the same statement also runs its whole reduction in one thread per row, but with every row in flight at once. The fused kernel has about 12 resident rows per SM (stage 3 report), so a costly body (a division, `exp`) on thread 0 becomes the kernel's critical path.

**Change.** For a staged reduction `R = sum/max(a1..an) body` of a row scalar, all threads of the block compute the terms, then thread 0 folds them:

```
acc = init                                   // 0.0f or -INFINITY, as before
for c0 in 0, C, 2C, ... < T:                 // T = product of R's extents, C = term chunk
  for e = threadIdx.x; e < min(C, T - c0); e += blockDim.x:
    decode c0 + e row-major into a1..an      // first axis outermost, as the meaning orders them
    terms[e] = body                          // stage 2's scalar code for the body
  __syncthreads()
  if threadIdx.x == 0: for e in 0 .. min(C, T - c0): acc = fold(acc, terms[e])
  __syncthreads()
```

Thread 0 then evaluates the member with `acc` in place of `R`. **Why the bits do not change:** a term does not depend on the accumulator (Tix cannot name it), so the thread that computes it does not matter; it runs the same scalar code (`kernelWriter`) on the same values, and the value travels as a bit copy through shared memory or scratch. The fold sees the terms in increasing lexicographic order of `a1..an`, one rounding per step, as in the meaning. An empty extent gives `T = 0`, no chunk, and `acc = init`.

**Which reductions, decided from the IR** (`planFusion`, recorded per reduction in the group as `terms: { statement, reduction, staged, reason }`):

- Only **row scalars of block-mode groups**. A reduction inside a member with trailing axes is already computed one thread per element, as in stage 2 (refused: "computed per element by its own thread").
- Only **outermost reductions**, those not inside another reduction's body. An inner one runs once per outer term; when the outer one is staged, its terms (inner reductions included) run in parallel. An outermost reduction's axes are `dim` or `blocks` extents of shape names, never a `tail` (split-sum puts the tail in a nested reduction), so its term space is a rectangle that a row-major decode covers.
- Only bodies whose cost exceeds the fold's. A body that is a load or a constant is refused ("the term is a load; staging would only copy it"): staging it adds two barriers and a copy per chunk and removes nothing from thread 0. Whether a body of one `+`, `-`, `*`, `min` or `max` is worth staging, or only bodies with a multi-instruction operation (`/`, `sqrt`, `exp`, `log`, `tanh`) or a nested reduction, is decided by measurement (below, M1).

| Alternative | Why not |
| --- | --- |
| Do nothing to the terms; send costly row scalars to their own stage-2 kernel (the gate alone) | It keeps stage 2's concurrency but gives back stage 3's traffic savings: the row is read twice more and the scalar stored. It is the fallback the gate uses, not the main mechanism. |
| One term buffer per staged reduction, sized to its whole term count | Simplest, but the scratch fallback allocates rows × terms: `s[i] = sum(j,k) ...` with 4,096 rows and 10^6 terms would need 16 GB, and stage 3 ran it. A fixed chunk bounds the buffer, and one buffer serves every staged reduction of the kernel (they run one after another, separated by barriers). |
| Overlap the fold of chunk c with the terms of chunk c + 1 (double buffering) | Saves at most the fold time per chunk; not needed unless M2 shows the chunk barriers matter. Later. |

The term buffer is one more row buffer: it counts in the row size that decides shared memory against global scratch, so the stage-3 fallback covers it unchanged. **Chunk C** is chosen by measurement (M2), not a round number.

## 2. The gate: fuse only where it is not slower

After term staging, a block-mode kernel is still slower than stage 2 when it has **too few rows to fill the GPU**: with one row of 10^6 elements a single block does all the parallel work that stage 2 spreads over 4,000 blocks. Whether anything else is slower at the brief's sizes is measured (M3) before deciding the rule's form; the design commits to the mechanism, not the threshold.

**Mechanism.** The decision needs the shape values, which only `runTixCuda` has; `cudaSource` and `checkLowering` take no shapes. So the gate chooses between two **whole-program sources that are each checked**: the fused source (`cudaSource(..., { fuse: true })`) and stage 2's (`fuse: false`). `runTixCuda(..., { fuse: true })` evaluates the rule on its inputs' shape values and runs stage 2's source when some block-mode group has fewer rows than the threshold R*; the rule and R* are exported with the plan so that a test and the report can state them.

| Alternative | Why not |
| --- | --- |
| No gate (stage 3) | Slower than stage 2 for few long rows (measured in M3). |
| Choose per kernel at launch inside the CUDA host code | Needs the unfused kernels in the same translation unit, which raises the kernel count of every fused program (softmax would have 5 `__global__` definitions), and a mixed source that no check covers. |
| Gate per group (split only the slow group into stage-2 kernels) | The mixed plan is a third source per program that `checkLowering` does not check. It matters only for programs with several block groups of different row counts; none is in the corpus. Later. |
| A cost model with occupancy and bandwidth | Needs per-kernel estimates nothing else uses; a row-count threshold read from one measurement covers the case that occurs. |

`cudaSource` and `checkLowering` with `fuse: true` keep giving and checking the fused source; the cases are small, so a gate applied to the check would check stage 2 only and never the fused kernel.

## Measurements that fix the open choices

All with `benchmark: true` (warm-up plus median of three launches under `--timed`), several shape cases per GPU call, scripts numbered in the ticket.

- **M1, which bodies:** layernorm (outside: `variance`'s body is one multiply) and layernorm-inside, with term staging off, on for multi-instruction bodies only, and on for every operation.
- **M2, chunk C:** layernorm-inside and softmax-inside at the brief's sizes, C ∈ {128, 256, 512, 1024, 2048}; take the smallest C within the 2% run-to-run noise of the best.
- **M3, the gate:** softmax and layernorm-inside, fused and unfused, C = D = 1024 with N from 1 to 4,096, and a fixed 2^22 elements with N from 1 to 2^20; R* is the smallest row count at which fused is not slower in every series.
- **Results:** kernel counts, GPU times (median of three `benchmark` calls), and which reductions use parallel terms, for the six corpus programs and the two "inside" variants, fused and unfused, with fused and unfused outputs compared bit for bit.

## Contract

Unchanged in kind: `tensor.lower-cuda` checks the fused source on stage 2's cases (`cudaCases`), exactly. The CUDA artifact's kernel list gains nothing; the plan's `terms` entries appear in the kernel comment. A local test checks the planner's staging decisions and refusals; a GPU test checks staged kernels exactly, including empty reductions, multi-axis and split-sum reductions, nested reductions in a term, several staged reductions in one member, a term count larger than C (several chunks) and the scratch fallback; a mutant that folds the chunk out of order is rejected.

## Framework

No framework change is planned; stage 3's transformation, port and correspondence carry over. A change found necessary goes in the report with its reason.

## Left out

- Reassociating reductions, tiling, FMA, fast `exp`, streaming attention, autotuning (not this stage).
- Term staging for thread-mode kernels and for members with trailing axes: each element already has its own thread.

## Later

- Double-buffered term chunks (fold one chunk while computing the next).
- A per-group gate with its own check of the mixed plan.
- Correspondence entity checks (another ticket).
