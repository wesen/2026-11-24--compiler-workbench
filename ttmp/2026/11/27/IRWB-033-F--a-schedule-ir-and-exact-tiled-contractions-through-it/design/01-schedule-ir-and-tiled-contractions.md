---
Title: A schedule IR between Tix and CUDA, with checked scheduling passes and exact tiled contractions
Ticket: IRWB-033-F
Status: active
Topics:
    - tensor
    - gpu
    - compiler
    - verification
DocType: design
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/schedule.ts
      Note: The schedule IR (value, IR type, adapter), the schedule-order analysis and property, the scheduling passes and the strategy that sequences them
    - Path: repo://src/tensor/cuda-source.ts
      Note: The emitter becomes a printer of schedules; adds the tiled-contraction kernel
    - Path: repo://src/tensor/cuda-contract.ts
      Note: The lowering transformation gains the schedule output port, the schedule correspondence and the order property
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyNativePassSync learns to check `preserves` by synchronous recomputation
ExternalSources:
    - Name: Yang, Riasanovsky, Deng and Sarkar, "Taming Bitwise Behavior in GPU Kernels with Tensor Core", arXiv 2609.11356 (2026)
      Note: Reconstructs cuBLAS's GEMM reduction order; restricts autotuning to one bit-equivalence class. Stage 6 instead fixes the order (the meaning's) and changes only the layout around it
Summary: A schedule IR as a v6 artifact between Tix and CUDA; fusion decisions feed it from their plan; tile and double-buffer are checked passes on it; a strategy sequences the passes; a tiled, masked, launch-dispatched contraction kernel makes matmul exact and fast without reassociating any reduction.
LastUpdated: 2026-11-27T11:00:00-05:00
WhatFor: Design of stage 6 before implementation
WhenToUse: Reviewing the schedule IR, its passes, their legality and order checks, and the tiled contraction kernel
---

# A schedule IR between Tix and CUDA

## Goal and domain

Make contractions fast without changing any result bit, and make the lowering a compiler: a schedule IR as a v6 artifact between Tix and CUDA, edited only by checked passes, printed by an emitter that decides nothing. The domain is unchanged: any function of the checked core, any consistent shapes, finite inputs, in-bounds reads, sizes the GB10 can allocate and launch — including shapes that are not multiples of a tile size and contractions over a short or empty index. `fuse: false` keeps printing stage 2's bytes. Not in scope: reassociating a reduction (split-K, tree folds), FMA contraction, tensor cores, autotuning by measured search; the schedule IR must leave room for them.

## The schedule IR

**Value.** `ScheduleUnit = { fn, statements, kernels, refusals }` in a new `src/tensor/schedule.ts`:

- `statements`: the function's Tix statements — the algorithm, copied verbatim from the Tix IR. A schedule never edits them.
- `kernels`: one record per kernel. A kernel record is a fusion group (`FusionGroup` from `fusion.ts`) extended with an optional `tile` schedule for its contraction. A kernel without `tile` is exactly what stages 3 and 3b emit; a kernel with `tile` runs its contraction through tiles.
- `refusals`: scheduling steps refused, with reasons (the analogue of the fusion plan's refusals).

**Fusion feeds the schedule; it does not become passes (chosen, with the alternative).** `planFusion` stays a legality analysis on the Tix IR and its result becomes the initial schedule: groups become kernels, and its per-kernel decisions (thread caps, staged terms, in-place rows, the gate) become schedule constructs the emitter prints. *Alternative:* re-derive grouping as a pass on the schedule IR. It would duplicate a dataflow analysis that is a property of the Tix program (who reads whom at which indices), with no new check gained; the grouped schedule is still fully visible in the IR and still checked (the order property below covers its reductions). *Alternative rejected for the same reason:* making each stage-3b decision its own pass (a `stage-terms` pass, an `in-place` pass); the decisions are already legality analyses with recorded reasons, and re-running them as IR edits would add revisions without adding checks.

**IR type, adapter, entities.** `ScheduleIR` is a `defineIR` (id `tensor.schedule`, v1) with a validator (kernel records well-formed, statements exist, tile configs positive, threads ≤ 1024, shared sizes within the device's opt-in limit) and `entities(value)` = the kernel names, so the manager can check a Tix→schedule correspondence's entity lists against both artifacts (the F23 machinery). A `defineAdapter` projection exposes kernels, statements and contains/reads relations for the pass machinery's diffing and `writes` enforcement.

**The tiled contraction schedule.** A kernel whose single member statement is a two-operand contraction may carry:

```
tile = {
  statement, reduce: { op, axis },
  loads: [{ tensor, indices }],            // each: plain indices, the reduction axis once,
                                            // at most one distinct output axis
  configs: [{ bm, bn, bk, tm, tn }],        // instantiations, small tiles first
  stage: true,                              // operand tiles in shared memory
  unroll: true,                             // #pragma unroll on the inner product loop
  double: false,                            // double buffering
  dispatch: { waves, minWork },              // the launch rule's constants
}
```

Each output element still accumulates its terms one at a time, k = 0, 1, …, rounding the product with `__fmul_rn` and the sum with `__fadd_rn` (or the `max.NaN.f32` fold), exactly as the meaning prescribes. Only the layout around that order changes: the output plane is split into bm×bn tiles bound to blocks; each thread owns a tm×tn register patch of its block's tile; the k axis is walked in bk-sized chunks; each chunk's operand tiles are staged in shared memory (A-tile stride bk+1 to spread rows over banks; B-tile row-major with the j axis contiguous and stride bn+4, read as one `float4` per thread); masks cover shapes that are not multiples of the tile; k-iterations beyond the extent are skipped, never folded with a zero.

## The passes

Scheduling steps are v6 passes on the schedule IR (`definePass` + `applyNativePassSync`): each decides its legality from the IR before it is applied, returns the new native value with correspondence entries, declares `writes`, and preserves the schedule-order analysis. Application failure (an order violation) rejects the candidate and keeps the previous revision; the lowering then proceeds with the refused step recorded in `refusals`.

1. **`tensor.tile-contraction`** (v1). Legality, decided from the IR: the kernel is a singleton (one member), its statement's expression contains exactly one reduction; the reduction has one axis with a `dim` extent; its body is exactly two loads multiplied; each load's indices are plain, contain the reduction axis exactly once and at most one distinct output axis; the output has rank 2; each load's tensor is a parameter. Refusals record the first failed condition (multi-statement groups, `blocks`/`tail` extents from split-sum, affine reads as in conv2d, three or more factors, non-plain indices). The pass attaches the `tile` schedule with the config table and the dispatch constants. *What is refused and why:* conv2d (three reduction axes and affine reads — not a two-operand GEMM shape; tiling it is a later stage); rank-1 outputs such as matvec (the emitter's patch is two-dimensional; the element mapping already reads two floats per multiply-add there); contractions inside fused row-mode kernels (attention's `score`/`out`, mlp's `h`/`y`) — their threads already cover the member's row, so a tile would have to restructure the group's block domain; kept at stage 3b's speed, listed under Later with the measured reason (L2 operand re-reads).
2. **`tensor.double-buffer`** (v1). Legality: the kernel has a `tile` schedule, `stage` is on, and two operand-tile sets fit in the device's opt-in shared limit (a constant from the stage-3 device probe). Sets `double: true`: the next chunk's tiles are staged while the current chunk is computed, separated by the barrier that already ends each chunk.

`unroll` and the tile sizes are data of the tile schedule rather than separate passes: unrolling a straight-line loop in order cannot change the fold order (the pass would have nothing to decide), and the tile sizes are chosen per launch shape by the dispatch rule, not per program by a pass.

## What each step is checked against

- **The schedule-order analysis** (`tensor.schedule-order`, v1): for every kernel, member statement and reduction, the canonical description of how the schedule folds that reduction's terms: the axes in fold order, the enumeration (lexicographic ascending, or — for a tiled schedule — the chunk partition `[k0*bk, min(K, (k0+1)*bk))` which the analysis validates as an exact ascending partition of `[0, K)` for probe values of K and by its symbolic form), and the rounding site (one rounded product and one rounded fold per term). Each pass declares it under `preserves`; the pass machinery recomputes it before and after and rejects any change.
- **The framework change this needs:** `applyNativePassSync` rejected passes with `preserves` because checking a claim needs the asynchronous analysis manager. The fixed API `cudaSource(program, fn)` is synchronous, so the manager cannot run inside it. The extension lets the synchronous path check `preserves` by recomputing each preserved analysis (required to declare no effects and not use the context) on both revisions and comparing canonical values. Needs and contracts stay asynchronous-only.
- **The schedule-order property** (`tensor.schedule-ordered`, v1) on the final schedule: every reduction's fold, as the schedule performs it, is the meaning's — lexicographic ascending over the reduction's axes, one rounded product and one rounded fold per term, initial value +0 or −∞. The lowering transformation ensures this property on its schedule output, so the end-to-end schedule is checked against the algorithm, not just step against step.
- **What this covers, and what the GPU check still has to cover.** The IR-level argument covers the *order and rounding of every output element's accumulation*, given that one thread folds an element start to finish and that staging copies bits. It does not cover the emitter's realization: address arithmetic, tile masks, barriers, the dispatch rule, the epilogue — those stay with the exact differential (`checkLowering`), which runs every case on both sides of every gate, tiled and per-element, including zero extents and shapes below one tile.

## The emitter

`emitCuda` prints a `ScheduleUnit` and makes no decisions: singleton element kernels print stage 2's kernel (the `fuse: false` digests must hold), fused groups print stage 3/3b's kernel from the group record, and a `tile` kernel prints one `template <int Mode, int BM, int BN, int BK, int TM, int TN>` definition: Mode 0 is the tiled schedule, one instantiation per config, with the two shared tiles, the register patch, the masked staging, the chunked k loop and the per-patch epilogue; Mode 1 is the statement in stage 2's element mapping. The host picks at launch, from the shape values: per-element below `minWork` output elements; otherwise the last config whose grid covers `waves` waves of the SMs (larger tiles buy operand reuse; the rule prefers them when the grid still fills the device), with `--gate=fused|--gate=unfused` forcing a side for the contract. The launch reports its side through the existing `gates` field.

## The strategy

The rule that picks a schedule is `scheduleStrategy(schedule, { fuse })`: for each kernel, the tile pass when its contraction is legal and fusing is on, then the double-buffer pass when the tiles fit — each step with its reason, each refusal recorded. It is a pure function of the schedule. **`src/framework/strategy` does not fit it, and the reasons are concrete:** its interpreter is asynchronous while `cudaSource` is a fixed synchronous API; a plan is static JSON, so the per-program decision would be built by code before the plan exists, adding serialization and trace records to a pure function called on every emit; and its algorithms exchange JSON values, not artifacts and manager contexts, so the checked passes could not run as plan steps anyway. What would make it fit — a synchronous, traceless execution mode for plans over local algorithms — is listed under Later. The strategy module keeps the sequenced rule with recorded reasons, which is what the strategy layer would orchestrate.

## Measurements

- matmul at 512³ and 4096³, fused and unfused, against the base and cuBLAS (0.0329 ms, 8.15 TFLOP/s; 19.2 TFLOP/s); TFLOP/s = 2MNK over time; the ratio to the arithmetic ceiling (14.39 TFLOP/s for separate mul and add).
- Config sweep: the config table above at both sizes, forced per config, picking the shipped configs and the dispatch rule's constants from the crossover.
- All corpus programs fused and unfused against the base (no program may become slower), and small/odd shapes for the dispatch rule.
- The protocol: median of 5 `benchmark` calls, alternating variants; differences under 5% are noise; SM clock checked at 4096³.

## Later

- Tiled contractions inside fused row-mode kernels (attention, mlp): several rows per block, so operand tiles are re-read per TI rows instead of per row; the measured L2-traffic argument is in the report.
- Batched and rank-1 contractions; conv2d's three-axis affine contraction.
- A synchronous execution mode for `src/framework/strategy` over local algorithms, so the schedule choice can be a framework strategy plan.
- An IR-level cost model checked against measurement (the dispatch rule's constants are its first, fitted instance); vectorized global loads; `cp.async` staging; split-K and tensor cores, which the tile schedule leaves room for by keeping the fold per element in one thread.
