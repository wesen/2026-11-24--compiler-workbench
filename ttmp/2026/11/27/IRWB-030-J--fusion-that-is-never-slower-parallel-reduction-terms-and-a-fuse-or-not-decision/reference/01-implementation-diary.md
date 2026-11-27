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

## Step 4: The decline sweep overturned the design's assumption; the rule comes from the data

Script 03 ran three families at a ladder of points x threads, fused (the default plan) against unfused, each rung a case of one batch. The design had assumed any block-mode group loses when points x threads cannot fill the machine. The measurements say otherwise: rows-only groups (softmax, inside layernorm) were faster fused at every rung, down to 1 point x 128 threads (softmax 0.67x, layernorm 0.30x), because stage 2's one-thread-per-row folds are memory-latency-bound at few rows while the fused kernel stages the row with the whole block. The contraction family (mlp: trailing members whose reductions stream w and v) lost below 65 536 threads (4.6x at 256 threads, 1.37x/1.24x at 32 768) and won at 65 536 (0.77x/0.73x).

I changed the rule to match: decline a group only when a member with trailing axes has a reduction reading a global tensor (the same predicate that picks the 64-thread cap), the longest row exceeds the cap, and points x threads < 65 536 - the least measured rung where the contraction family was faster fused, which also keeps mlp and attention (1024 x 64) fused. The constant is that rung, not a round number chosen in advance.

### What I did
- `node <ticket>/scripts/03-decline-sweep.mjs` twice (the first, narrower ladder agreed with the second, extended one).
- `src/tensor/fusion.ts`: `fuseThreads = 65536`; `declineReason` requires the contraction-chain predicate and records it.
- Tests updated: softmax is no longer declined at few points (it never was the loss case); mlp at few points is; the mixed-plan test program now declines through a trailing-member contraction (h reads u from global memory) while the rows-only group before it stays fused.

### What I learned
- The parallelism-loss model is incomplete: stage 2's row kernels are themselves latency-bound at few rows. What fusion loses at few rows is only the per-element fold chains of streaming contractions.
- A rule built on an unmeasured mechanism would have declined fused winners (softmax at 16 points: 2.5 ms fused against 4.7 ms unfused).

### What warrants a second pair of eyes
- 65 536 sits exactly on mlp's and attention's corpus points x threads; between 32 768 and 65 536 the boundary is only bracketed, not located. The rule takes the conservative end: below it, a declined group is stage 2 and cannot be slower.

## Step 5: The random probe caught a real emitter bug

Script 06 (the stage-3 generator extended with division-inside-reduction and nested-reduction forms) failed 5 of 40 lowerings with `identifier "v4" is undefined`: a reduction nested inside a staged reduction's body (for example `max(j) (x * 2 + sum(k) v[k] * 3)`) was itself staged, and accumulators from earlier `if (threadIdx.x == 0)` blocks were out of scope in the final combine block. My GPU test had not caught it because its nested sum had a bare-load body, refused for the wrong reason.

Two fixes: `topReduces` splits a member's reductions into those no other reduction encloses (stageable) and the nested ones, which are refused with the reason that they are computed per term by the term's thread (exactly what the phase does); and the accumulators are declared at member scope before the phases, so the final fold's combine sees them all.

### What I did
- `src/tensor/fusion.ts` `topReduces` + refusal; `src/tensor/cuda-source.ts` accumulator scope.
- Reran script 06 with seed 29 (40/40 exact, 27 staged reductions) and a new seed 101 (40/40, 25 staged): 80/80 lowerings exact, 167 statements to 111 kernels in the second set, 20 and 14 lowerings with staged terms.

### What didn't work
- The first generator run: 35/40. The five failures were all the same emitter bug, in both original and inline+split revisions.

## Step 6: Measurements

Script 02 (three rounds, medians of benchmark calls; fused and unfused outputs bit-identical in every round): matmul 0.215/0.214 (1/1), softmax 0.385/0.814 (1/4), layernorm 0.209/0.481 (1/4), attention 0.753/1.048 (1/6), mlp 0.725/0.960 (1/3), conv2d 0.166/0.166 (1/1), layernorm-inside 0.220/0.555 (1/4), attention-inside 1.413/1.515 (1/5). Inside layernorm dropped from stage 3's 0.569 to 0.220, matching outside layernorm's 0.209; attention-inside is unchanged (no staging applies to its trailing-member contractions) and keeps a 6.7% edge.

Script 04 (what the staging decisions cost): staging softmax's refused bare-load reductions (m, s) by force made no difference (0.399/0.393, then 0.387/0.387 - exp-bound, and the terms buffer is invisible); the refusal stands because staging removes no serial work. Inside layernorm staged 0.226/0.217 against unstaged 0.593/0.585. The corpus layernorm's multiply body staged vs unstaged: 0.198/0.201 against 0.198/0.192 - neutral, so the one-line rule (stage any body that rounds a value per term) keeps divisions' 2.6x win and accepts neutrality elsewhere. The block cap re-measured on staged inside layernorm: 64 lost clearly (0.253/0.256), 128 and 256 disagreed between rounds (0.207/0.196 then 0.168/0.199) - stage 3's 128 stays.

Script 05 (contract cost): case counts and elements identical to stage 3 (the recipe is unchanged); cold `checkLowering` 2.6 to 4.1 s, repeats 1 ms. Script 07 printed the per-kernel staging table for the report.

### What I did
- `node <ticket>/scripts/02-benchmark.mjs` (24 rows), `04-staging-cost.mjs` (twice), `05-contract-cost.mjs`, `06-random-programs.mjs 20 29` and `20 101`, `07-kernel-table.mjs`; outputs committed beside the scripts.

### What I learned
- Session-to-session drift is real: stage 3's fused layernorm was 0.169 ms; this session measured 0.209 for the same kernel, and stage 3's own unfused number moved from 0.491 to 0.481. Only within-session A/B comparisons are worth drawing conclusions from.

## Step 7: Final validation

`npm run build`; the six local tensor files 37/37; the three GB10 files 23/23 (fusion-gpu 5, cuda-gpu 11, parallel-terms-gpu 7); stage 2's `fuse: false` digests byte-identical (the existing digest test).

### Commit (code)
- 20956e6 (the measured decline rule), a4c1ad9 (nested-reduction refusal, accumulator scope, 80/80 random lowerings)
