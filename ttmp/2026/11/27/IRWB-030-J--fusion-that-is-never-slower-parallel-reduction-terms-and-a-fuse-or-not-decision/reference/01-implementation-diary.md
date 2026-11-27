---
Title: Implementation diary
Ticket: IRWB-030-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of stage 3b: design, staged terms, the decline rule, measurements.
LastUpdated: 2026-11-27T02:10:00-05:00
WhatFor: Resuming or reviewing this stage
WhenToUse: Tracing why a decision was made or which command produced a number
---

# Implementation diary

## Step 1: Read stages 2-3, confirmed the diagnosis, wrote the design

I read the stage 3 and stage 2 designs, reports and diaries (IRWB-029-D, IRWB-022-I), the framework contracts and IR READMEs, `define-pass.ts`, the tensor sources and tests, then the merged code. The emitted fused kernel for the inside placement of layernorm shows the cause the brief names: the row-scalar member's element loop degenerates to thread 0 (`n = 1`), and the reduction's body — a division per term — sits inside the serial fold. I created the ticket, wrote the design (parallel terms staged by the block and folded in order by thread 0; a decline rule from the IR plus launch shapes), and committed it.

### What I did
- Read `src/tensor/` and `tests/tensor/` in full; printed `cudaSource` of an inside-layernorm variant and located the thread-0 fold (`for (I i4 = 0; i4 < end_i4; ++i4) { float v1 = __fdiv_rn(...); v0 = __fadd_rn(v0, v1); }`).
- `docmgr ticket create-ticket --ticket IRWB-030-J ...`; wrote `design-doc/01-parallel-reduction-terms-and-a-fuse-or-not-decision.md`.

### Why
- The design fixes the two deliverables before touching code: which bodies get parallel terms (rank == depth, `dim` extents, body with an op/call/nested reduce), and when a group is left unfused (cap binds and `points × T` below a measured constant).

### What I learned
- `docmgr doc add` templates the doc it creates; the design must be written into the path it makes.

### What warrants a second pair of eyes
- The claim that a mixed plan (some groups fused, some declined) is exact by composition: each kernel is either a legality-checked fused kernel or stage 2's own; only the `stored` sets differ, and storing more never changes values.

## Step 2: Implementation - the plan decides, the emitter obeys

I implemented the design: `planFusion(fn, shapes?)` in `src/tensor/fusion.ts` now decides, in order, the legal groups (unchanged rule), which of a block-mode group's reductions get parallel terms (`terms`, with `termRefusals` for every refusal), the group's thread cap (moved here from the emitter so the decision and the launch share one formula), and - only when shape values are supplied - which block-mode groups are declined (`declined`, split back into singletons, with the reason). `emitGroup` in `cuda-source.ts` emits the term phase (grid-stride over the block, indices decoded last axis fastest), the barrier, and thread 0's fold in increasing linear index, with the terms buffer appended to the row layout so the existing `Shared`/scratch machinery covers it. `runTixCuda` passes `caseShapeValues` (extracted from `encodeCudaCases`) to the planner; `cudaSource` and the checked transformation keep the default plan. The CUDA artifact went to version 3 with `parallel` per kernel; `tensor.lower-cuda` to version 3.

### What I did
- `src/tensor/fusion.ts`: `StagedTerms`, `TermRefusal`, `FusionDecline`, `fuseThreads` (provisional 32 768, to be set by the sweep), `blockThreadsFor`, `termPlan`, `declineReason`.
- `src/tensor/cuda-source.ts`: `reduceValue` hook on `kernelWriter`, `temp`, `reducesOf`, the terms buffer/phase/fold emission, host sizing with clamped products.
- `src/tensor/index.ts`, `src/tensor/cuda-runtime.ts`, `src/tensor/cuda-contract.ts` as above.
- `node --test` on the six local tensor files: 36/36, including stage 3's `fuse: false` digest test (stage 2's bytes unchanged).

### Why
- The plan is pure and recorded; the emitter never re-derives a decision, so the reasons in the plan are the only reasons.

### What I learned
- `nterm` must clamp each extent factor at 0: a negative extent would otherwise wrap to a huge `U` and the phase would write out of bounds, where the serial loop simply runs zero iterations.
- The decline preview needs the group's own `buffered` set and staged terms (for the terms length in `longest`), so the term decision runs before the decline, both in the preview and in the final groups.

### Commit (code)
- 1dd1ef9 "IRWB-030-J: parallel reduction terms (phase + ordered fold) and the decline rule, in plan and emitter"

## Step 3: Tests, local and on the GB10

`tests/tensor/parallel-terms.test.mjs` (no GPU) covers the staging decisions and refusals (costly body staged; bare load, split bounds, trailing axes, thread mode refused), the decline rule (few points + long row declined; corpus size, short rows, empty grid, thread mode not), the mixed plan's stored sets, byte equality of a fully declined plan with `fuse: false`, the emitted kernel's structure, and the artifact's `parallel` record. `tests/tensor/parallel-terms-gpu.test.mjs` runs on the GB10: the inside placements at full size bit-identical to the interpreter and accepted exactly by the contract (both fuse settings), the half-ulp fold-order witness, empty extents, a nested sum inside a staged max, split-sum refusing staging, declined groups and a mixed plan exact at their shapes, terms through the scratch path (D = 30 000), a reversed-fold mutant rejected with a coordinate, and benchmark mode.

### What worked
- Local 36/36; GB10: parallel-terms-gpu 7/7, stage 3's fusion-gpu 5/5 and cuda-gpu 11/11 unchanged.
- The reversed-fold mutant (`rterm[nterm0 - 1 - t]`) is rejected on the half-ulp stream: forward 2, reversed 2.0000002 (the terms double exactly, so only the order can differ).

### What didn't work
- Two test programs were invalid Tix, as stage 3's diary warned: a statement reading two tensors with different leading extent symbols (`e[i,j] + q[i,j]` over `[A,B]` and `[C,D]`) fails with `Inconsistent extent`; a plain read of `w[i,j]` in an `[N-1]` statement unifies `N-1` with `N`. I annotated the statement and gave `w` the extent `[N-1,C]`, keeping `e[i+1,j]` (a shifted read unifies nothing) as the reason the group splits.
- My first nested-reduction program put `t` and `y` at the same rank, so the group was thread mode and staged nothing; adding the trailing member `z[i,j]` made it block mode.

### Commit (code)
- fc0192d (local tests), 420373d (GB10 tests)
