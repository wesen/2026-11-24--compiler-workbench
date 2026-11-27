---
Title: Checked fusion of Tix statements into fewer CUDA kernels
Ticket: IRWB-029-H
Status: active
Topics:
    - compiler
    - ir
    - verification
    - gpu
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emitter that prints a kernel per statement in stage 2 and will print the fused plan
    - Path: repo://src/tensor/model.ts
      Note: Resolved statement trees, affine forms and extent kinds the legality rules read
    - Path: src/framework/ir/correspondence.ts
      Note: Grouped correspondence entries, and the entity universes they require
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Exact-relation lowering contract that will judge the fused candidate
ExternalSources: []
Summary: Fuse Tix statements into fewer kernels from a plan computed on the Tix IR, keeping every output element's rounded operation sequence identical.
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion of Tix statements into fewer CUDA kernels

Stage 2 emits one kernel per statement and one thread per output element. Stage 3 fuses statements into fewer kernels on the same v6 framework, with the same acceptance condition: `checkLowering` must accept the fused lowering under the exact relation (bit-identical to the current revision's f32 meaning, NaN compared as a class).

## Domain

The lowered function is the named function of a `compileTix`/`optimizeTix` result. Inputs are the stage 2 domain: finite f32 inputs, nonnegative and consistent dimensions, affine reads inside their tensor, and a target with room for the buffers and launches. Signed zeros, infinities and NaNs may appear in results, as in stage 1.

One boundary is new. A fused row kernel stages a row in dynamic shared memory, so the staged footprint of one row must fit the device's shared-memory limit. A launch that needs more fails with a message naming the requirement; nothing else in the domain is narrowed. The corpus sizes need 8 KB per block at most.

## Where fusion lives: the emitter, from a plan computed on the Tix IR

Three candidates were considered.

**A pass on the Tix IR.** Tix statements carry meaning. Kernel boundaries, thread mappings and storage classes carry none, and the stage 1 meaning gate compares statement values, so it could not check such a pass. The Tix adapter would also have to advertise relations that are not about the language. Chosen against: it puts lowering decisions in the language IR where neither the gate nor the meaning can see them.

**A second v6 artifact (a kernel IR) between Tix and CUDA.** This carries exactly the information the Tix IR lacks. It has two shapes. It can restate each statement's expression, which duplicates the resolved tree that `inline` and `split-sum` rewrite, in a second representation to validate and keep in step. Or it can name statements of the Tix function, at which point it is a projection of the current Tix revision that lives only as long as one lowering: a plan. Its second use would be a v6 record relating statements to kernels. Chosen against for this stage: the artifact that has to be judged is the CUDA translation unit, which already is an artifact, and the plan is a pure function of the current Tix revision, so a second publication adds a revision identity without adding a distinction the contract can act on.

**The emitter, from a named plan (chosen).** `fusePlan(fn)` in `src/tensor/fusion.ts` is a pure function from the current Tix function to an ordered list of kernels, and for each statement its kernel, storage class and the legality rule that admitted it. `emitCuda(fn, options)` prints that plan. `fuse: false` bypasses the plan and prints stage 2's one-kernel-per-statement lowering unchanged, so the two lowerings differ only in what the plan decided.

The plan is a projection, so it is not published. The CUDA artifact stays `{fn, source}` at the same version, and the source text is where the grouping is visible: a kernel's parameter list names exactly the tensors its group reads and writes.

**Framework finding.** The framework can express several statements becoming one kernel, but not for this artifact. `makeCorrespondence` accepts a grouped entry `{from: [s1, …, sn], to: [k]}` and `validateCorrespondence` requires only that every declared source and target entity be accounted for. Both universes must therefore exist. The CUDA artifact is one opaque payload with no adapter, so there is no target entity for a statement to correspond to, and stage 2's lowering has no correspondence requirement for that reason. Recording statement→kernel groups would require the kernel IR above, whose only remaining job would be to supply that entity universe. The grouping is instead recorded in the artifact payload (the emitted source) and certified by the exact GPU relation; a local test asserts that the plan's kernel count equals the number of `__global__` definitions in the source, so the two cannot drift.

## What may change under fusion, and what may not

Fusion may change where an intermediate lives (a register, shared memory, global memory) and which thread computes it. It may not change the sequence of rounded operations applied to any output element. The stage 2 emission invariants already fix that sequence: explicit round-to-nearest intrinsics for the four arithmetic operations and the square root, `exp`/`log`/`tanh` in double rounded once with `__double2float_rn`, a NaN-propagating min/max helper, one fold step per iteration with a rounding after each, sequential accumulation in increasing lexicographic index order with the first binder outermost, and f32 at every store. Stage 3 keeps all of them, so a fusion is admissible exactly when it leaves every one of them in place.

Four decisions follow.

| Rule | What it does | Why it keeps the bits |
| --- | --- | --- |
| F1 substitution | A statement whose expression contains no reduction is substituted at each of its reads and has no buffer and no kernel. | Its value at a coordinate is a pure function of that coordinate, so recomputing it there gives the same f32 words. This is what the stage 1 `inline` pass does, which is already checked exact; F1 differs only in not requiring a single use. |
| F2 thread-local substitution | A statement that contains a reduction may be substituted into a read only when no reduction encloses that read and the enclosing iteration variables are exactly its own axes in order. | The substituted fold then runs once per element by the thread that owns that element, with the same axes in the same order, so its rounding sequence is unchanged. `mlp`'s `h` into `g` is this case. |
| F3 row kernel | A group of statements whose first axis has one extent becomes one kernel: `blockIdx.x` is the row, `threadIdx.x` strides over the second axis. Every reduction over the thread axis is a serial fold by one thread; every other reduction is a per-thread serial fold. | A fold is still executed by a single thread in increasing index order with one rounding per step. Only the identity of the thread changes. |
| F4 staging | An intermediate read only inside its kernel is staged in shared memory instead of global memory, and a global row that a thread-axis fold reads is cooperatively copied into shared memory first. | Shared memory holds f32 too, so the words are identical. The copy makes the loads coalesced and keeps the fold on chip instead of issuing strided loads from one thread. |

A statement stays in global memory when it is the function's result or is read outside its kernel (G4 below). Rank above two, or a group whose members disagree on the first extent, keeps the stage 2 flat mapping.

### Fusions that are legal and are refused

| Refusal | Why it is legal | Why it is not applied |
| --- | --- | --- |
| Substituting a reduction-containing producer into a read enclosed by a reduction (attention's `score` into `shift` and `z`) | Each recomputation is the same fold in the same order. | It multiplies the producer's global reads by the number of enclosing iterations: attention would recompute a 64-term contraction once per column of a 1024-element row. |
| Staging or substituting into a group whose rows differ in extent, or any statement above rank two | Recomputing or copying does not reorder anything. | The block-per-row mapping needs one row extent per kernel, and there is no second mapping in this stage. |
| Reassociating a fold (parallel trees, warp shuffles, split-K) | It is faster. | It changes where the roundings happen, so it changes the meaning. This is the boundary of the stage, not a limitation of the plan. |
| Fusing a producer across the kernel that would read it | It is exact when the producer is pure. | The inversion would need the consumer's kernel to run before the producer's, or to duplicate the producer in both. |

## Measurements to take

For each corpus program at the brief's sizes, fused and unfused: kernel count; benchmark GPU time (`benchmark: true`, one warm-up and the median of three timed runs under the tool's `--timed` lock); the global bytes each kernel reads and writes, counted statically from the plan (issued addresses, not DRAM transactions); and the time those bytes would take at 244 GB/s. The contract's own cost: cases per function, wall time per `checkLowering`, and which verdicts are replayed.

The block size was to stay at stage 2's 256 threads so that the fused and unfused columns would differ only in what
the plan decided. It did not: the measurement below is an amendment.

## Amendments after implementation

| Change | Reason |
| --- | --- |
| The fused row kernel launches 128 threads per block; the flat mapping keeps 256. | A reduction over the lane axis is one thread's serial work, so the number of *resident blocks*, not threads, sets how many rows are folded at once. `scripts/05-block-size.mjs` measured 32/64/128/256 twice: softmax 0.414 ms at 128 against 0.489 at 64 and 0.608 at 256, layernorm 0.152 against 0.168 and 0.179, with under 1% spread between repeats. |
| Rule P1 also requires that no read of the statement sits inside a reduction. | This is a cost rule, not a legality rule: recomputation there is still exact, but it puts the expression into one thread's serial fold. Softmax's `e` would have been recomputed once per row element by one thread instead of once per lane. |
| Rule P2 additionally requires a single read. | `mlp`'s `h` has five reads inside the GELU expression; substituting it would recompute a 256-term contraction five times, so it is staged in shared memory instead. |
| Staged reads also accept the `split-sum` address `4 * block + lane`. | Its tail extent is `min(4, dim - 4 * block)`, so the value covers `[0, dim)` exactly. Without this the *optimized* corpus programs lost their staging entirely and read every staged value back from global memory. |
| The shared-memory requirement is checked at launch through `cudaDevAttrMaxSharedMemoryPerBlockOptin` and throws with the number of bytes needed and the number available. | To state the one new boundary of the input domain where it is enforced, rather than relying on a bare `cudaFuncSetAttribute` failure. |

## Later

- Reassociation, tiling of contractions for data reuse, tensor cores, streaming attention, autotuning: later stages.
- The kernel IR artifact, if a later stage needs a v6 record of statement→kernel correspondence.
- Dead statement elimination: stage 2 emits a kernel for a statement nothing reads; the plan does not change that.
