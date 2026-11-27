---
Title: Implementation diary
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
RelatedFiles: []
ExternalSources: []
Summary: The schedule IR, the tile pass, the tiled CUDA kernel, the config sweeps and the measurements, in the order they happened.
LastUpdated: 2026-11-27T14:30:00-05:00
WhatFor: Reviewing how stage 6 was built and what each measurement decided
WhenToUse: Tracing a decision in the stage-6 implementation back to its step
---

# Implementation diary

## Step 1: Read the stages, wrote the design

Read the stage 3b and stage 3 designs and reports (IRWB-030-E, IRWB-029-D), then stage 2's, then `src/tensor/` and the framework contracts/IR READMEs and `define-pass.ts`. Chose: fusion decisions feed the schedule IR from their plan (grouping is a Tix dataflow property; re-deriving it as an IR edit adds revisions without a new check); the schedule IR holds the algorithm (statements verbatim) plus per-kernel schedule constructs; scheduling steps are v6 passes on it; a schedule-order analysis plus a meaning-ordered property are the per-step checks. Wrote `design/01-schedule-ir-and-tiled-contractions.md` and committed.

**Learned:** `cudaSource` is a fixed synchronous API, so the pass pipeline cannot use the asynchronous `AnalysisManager`. `applyNativePassSync` existed but rejected `preserves`.

## Step 2: The framework change (the only one)

Extended `applyNativePassSync` (framework/passes/define-pass.ts) to check `preserves` by recomputing each preserved analysis on both revisions and comparing canonical values, for analyses that declare no effects and do not use the context. Reason: a fixed synchronous API must run checked passes; the claim `preserves: [tensor.schedule-order]` is the per-step order check. Updated `tests/framework/native-pass-sync.test.mjs` accordingly (the old test asserted `preserves` always throws `analysis manager`).

## Step 3: The schedule IR and the passes

`src/tensor/schedule.ts`: `ScheduleUnit` (fn, statements, params, kernels, refusals); kernels are fusion groups plus an optional `tile` schedule; `ScheduleIR` (defineIR, entities = kernel names, so the manager checks the schedule correspondence's entity lists) and a logical adapter for the pass machinery. `scheduleOrder` states each reduction's fold order as data (axes, enumeration, rounding, via); `ascendingChunks(bk)` validates the chunk partition on probe extents. First run: the tile pass silently kept the element mapping — the preservation check compared `via` (a realization detail, 'serial' vs 'tiles'), not the order. Fixed by projecting the analysis value to the order fields only; also made `lowerSchedule` record a rejected step in the schedule's refusals instead of swallowing it.

## Step 4: The tiled kernel

`emitTileKernel` in cuda-source.ts: one `template <int Mode, int Dbl, int BM, int BN, int BK, int TM, int TN>` definition; Mode 1 is stage 2's element mapping (the gate's other side), Mode 0 the tiled schedule: output tiles bound to blocks with i0 major (consecutive blocks share the A panel for L2), a TM×TN register patch per thread, the k axis in BK-sized ascending chunks (`t_kk` bounds the last), operand tiles staged in shared (A-tile stride BK+1 to spread patch rows over banks, B-tile rows 16-byte aligned and read as float4s), masked staging, k-iterations past the extent skipped (never folded with a zero), per-patch epilogue through the shared scalar writer. Three first-cut bugs found by reading the emitted source before ever running it: the staging decode order for k-first/k-last operands, the global strides (used `dim(shape[p])` instead of the product of the later extents), and `(t_c + 1 * BK)` precedence.

## Step 5: First correctness run (script 01)

Matmul on the GB10 at 8 shapes (odd, tiny, K=0, K=1, 512³) × 3 gate sides: **all equal to the interpreter, word for word**, on both sides of the gate. 4096³ compared against the stage-2 lowering (the interpreter is too slow there): equal. The untimed first run showed 0.13-0.19 ms at 512³; under the timed lock, 0.083 (the GPU machine is shared; untimed runs are noisy).

## Step 6: The config sweep (scripts 02, three rounds)

13 + 9 + 6 configurations at 512³ and 4096³, forced one at a time by mutating the exported `tile` table, each verified against the stage-2 lowering at a masked shape (all equal). Findings: **double buffering halves the resident blocks (shared memory doubles) and lost beyond the 5% noise at 512³ while costing 1.4-2.1× at 4096** — the strategy does not pick it, and the reason is recorded next to `tile.doubleBuffer`; 64×128 tiles beat 64×64 at 512; 128×128 with an 8×8 patch (fewer shared loads per multiply-add) wins at 4096; a (256,128,16) config failed to launch at all ("too many resources requested") — 1024-thread blocks are fragile, and the shipped table keeps ≤ 512 threads per block. Shipped `configs = [(64,128,32,4,4), (128,128,32,8,8)]` with the waves-2 launch rule.

## Step 7: Tests

New `tests/tensor/schedule.test.mjs` (5 tests, local: the schedule, legality refusals with reasons, the order analysis and property through the manager, a preservation liar rejected, the schedule correspondence with entity checking) and `tests/tensor/schedule-gpu.test.mjs` (3 tests, GB10: six contraction shapes × both gate sides exact, the dispatch rule's sides exact, checkLowering exact for matmul fused/unfused and for the four other corpus programs). Updated two existing tests that the stage makes different: `fuse: false` digests still hold (matmul's fused default is no longer stage 2's bytes; conv2d's is), and `native-pass-sync`. All tensor, framework, typed and workbench test files pass.

## Step 8: The final table (scripts 03, 03b, 04, 06)

- Every corpus program fused and unfused, five interleaved `benchmark` calls each: fused = unfused digests in every call; **softmax/layernorm/attention/mlp/conv2d fused sources byte-identical to the base** (script 04 esbuild-bundles the base's emitter from commit 0f45d04 and compares SHA-256 — the fused row kernels are provably untouched; attention 0.749/1.050 against the base's 0.746/1.050).
- Script 03's first attention row was wrong: the shape order is (Q, D, K, V), not (Q, K, D, V); 03b re-measured at the brief's sizes.
- The launch rule across 512/1024/2048/4096 (script 06): picks the better configuration at every size (c0 at 512 and 1024 by 2× and 14%, c1 at 4096 by 9%, a tie at 2048). Clock after a 4096 run: 2418 MHz — no thermal drift.
- Variants (bias epilogue, /sqrt(K), transposed A): all ~3× faster fused at 512³.

## What warrants a second pair of eyes

- The order property validates the chunk partition on probe extents, not symbolically; the symbolic form is checked only by construction.
- The emitter realizes the schedule; the exact differential is the only check of that realization (both gate sides, zero extents, sub-tile shapes are covered by the contract's doubled case set).
- 1024-thread blocks can fail to launch ("too many resources requested"); the shipped configs avoid them, but the SIR validator only checks threads ≤ 1024.
