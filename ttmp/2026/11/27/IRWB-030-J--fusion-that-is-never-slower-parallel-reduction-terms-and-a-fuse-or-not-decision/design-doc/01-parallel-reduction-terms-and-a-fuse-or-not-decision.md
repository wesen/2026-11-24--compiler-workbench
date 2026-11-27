---
Title: Parallel reduction terms and a fuse-or-not decision
Ticket: IRWB-030-J
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: Legality analysis; gains term-staging decisions and the fuse-or-not rule
    - Path: repo://src/tensor/cuda-source.ts
      Note: Group emitter; gains the term phase, the ordered fold and the terms row buffer
    - Path: repo://src/tensor/index.ts
      Note: runTixCuda passes the launch's shape values to the planner
    - Path: repo://src/tensor/cuda-contract.ts
      Note: Artifact v3 records each kernel's staged reductions
    - Path: repo://src/tensor/cuda-runtime.ts
      Note: Shape values of one concrete case, shared by the encoder and the planner
ExternalSources: []
Summary: Terms of a row-scalar reduction computed by the block and folded in order by thread 0; block-mode groups left unfused when the launch shapes say fusion cannot fill the machine.
LastUpdated: 2026-11-27T02:10:00-05:00
WhatFor: Design of stage 3b before implementation
WhenToUse: Reviewing the staged-terms lowering and the decline rule
---

# Parallel reduction terms and a fuse-or-not decision

## Goal and domain

The domain is stage 3's, unchanged: any function of the checked core, the same call domain, the same exact relation. Two changes to the fused lowering, both bit-exact by construction:

1. **Parallel terms.** In a block-mode kernel, the terms of a row-scalar member's reduction are computed by the block's threads, each into a terms buffer; thread 0 then folds them in the meaning's order.
2. **Fuse only where fusion is not slower.** A block-mode group is left unfused (its statements keep stage 2's kernels) when the launch's shape values say the fused mapping cannot fill the machine and unfused would run more threads.

## Where the work runs today

Stage 3's block mode computes a row-scalar member (`mean[i]`, `variance[i]`, softmax's `m` and `s`) entirely on thread 0 of the row's block, with the reduction's body inside the fold loop. A per-term division is therefore a long serial chain on one thread per row: inside layernorm (`mu[i] = sum(d) x[i,d] / D`) runs 0.569 ms fused against 0.191 ms for the corpus's outside placement, while stage 2 runs the same folds one thread per row, all rows at once (0.577 ms). A term never depends on the accumulator (Tix has no syntax for it), so the body can be computed by any thread without changing a single rounding site; only the fold order must be kept.

## Parallel terms, decided from the IR

A reduction is **staged** when all of these hold (checked per reduction, reasons recorded in the plan for both answers):

1. its enclosing member has rank == depth — the members stage 3 computes on thread 0 (a member with trailing axes has its elements spread over the block's threads already; staging its terms would fold one element at a time behind a barrier per element);
2. every axis extent of the reduction is `kind: 'dim'` (a rectangular term space; split-sum's generated `blocks`/`tail` extents are refused and keep stage 3's serial fold);
3. the body contains an op, a call, or a nested reduction — a bare load adds no serial work to remove, and staging it would only add a buffer and a barrier (softmax's `s`, layernorm's outside `mean`: refused, measured).

**Emitted structure** for a staged reduction of member m (all threads reach every barrier; none is conditional):

```cpp
for (U t = threadIdx.x; t < nT; t += blockDim.x) {   // term phase: any thread, any order
  <decode the reduction's indices from t, last axis fastest>
  float v = <the body, stage 2's scalar code>;        // each term rounds exactly as before
  rterm[t] = v;
}
__syncthreads();
if (threadIdx.x == 0) {                              // one thread folds
  float acc = 0.0f;                                  // or -INFINITY
  for (U t = 0; t < nT; ++t) acc = __fadd_rn(acc, rterm[t]);  // meaning's order, rounded per step
  <the rest of m's expression, staged reductions replaced by their accumulators>
  <buffer and store m>
}
```

Several staged reductions in one member alternate phases and folds, with a barrier between a fold and the next phase (the terms buffer is reused). `nT` is the product of the axis extents with each factor clamped at 0, so an empty extent gives an empty phase and an untouched accumulator, as in the meaning. The terms buffer is one row buffer per group (sized to the largest staged reduction), laid out with the staged and buffered rows, in dynamic shared memory or the global scratch area by the existing `Shared` template decision.

**Why the bits do not change.** Each term is stage 2's scalar code for the same body at the same indices, computed by some thread instead of thread 0; the shared/scratch copy moves f32 words unchanged. Thread 0 folds the terms in increasing linear index, which is the meaning's lexicographic order (first binder outermost), starting from +0 (or −∞), rounding after each step — the same instructions on the same values in the same order as stage 3's serial fold. Non-staged reductions keep stage 3's code.

## Fuse or not, decided from the IR and the launch shapes

Unfused, each statement's kernel launches one thread per output element, so its parallelism is its element count. Fused block mode launches `points × T` threads (`points` = block-domain points at these shape values, `T` = the threads per block the host picks) — and when that cannot fill the machine, the elementwise phases slow down by the shortfall while the row-scalar folds and the saved traffic stay the same. With few, long rows (one block does the whole parallel phase) the loss is large; with many rows the machine is full and fusion's traffic saving wins.

**Rule.** A block-mode group is declined — its statements keep stage 2's one-kernel-each lowering — when both hold at the launch's shape values:

1. the longest row exceeds the thread cap (the cap binds, so unfused would run `points × row > points × T` threads per statement; with short rows fused already has at least as many threads as unfused, and also saves the launches);
2. `points × T < FUSE_THREADS`, a constant fixed by the measurement sweep below, not chosen in advance.

Points, `T` and the row lengths are computed in TypeScript from the same affine extents and the same `min(cap, ceil(longest/32)*32)` formula the host uses. `FUSE_THREADS` is placed where the sweep shows fused first stops losing in every measured family (it must stay at or below mlp's 1024 × 64 = 65,536, where fusion is measured faster). Thread-mode groups are never declined: same threads, strictly less traffic, fewer launches.

**Where the rule runs.** `runTixCuda` knows the shapes of its inputs and passes them to the planner; `cudaSource` and `checkLowering` see no shape values and emit the default plan — every legal group fused, which is what the kernel-count comparison measures and what the contract checks. At the corpus sizes nothing is declined, so the source that runs is the source that is checked. A declined group's statements run stage 2's own kernels (`emitKernel`, byte for byte), and the planner recomputes every group's `stored` set over the final group list, so a fused group followed by a declined one stores the members the declined kernels read. A mixed plan is exact by composition — each kernel is either a legality-checked fused kernel or stage 2's — and the GPU tests run mixed plans against the interpreter.

| Alternative | Why not |
| --- | --- |
| Emit both lowerings in one source and let the host choose per case | The kernel count (the brief's own metric) would count both paths and fused would exceed unfused; the correspondence could not say which kernel ran. |
| Decide from the IR alone | Impossible: shape symbols are free, so the IR cannot bound the number of rows. |
| A third mapping: several rows per block | Recovers fold concurrency when rows are many and short; does nothing for the few-long-rows loss, the regime that measured slow. |
| Raise the thread cap for long rows instead of declining | Fewer blocks per SM when rows are long; the fold's latency then stalls an SM with no other block to run. Not measured; the decline is. |
| Reassociate the fold (tree, split-K) | Changes the bits; excluded by the brief. |
| Per-element term staging for members with trailing axes (inside attention's `s`, `o`) | All threads would cooperate on one element at a time, barrier per element, folding every element serially; the current mapping already runs one fold per thread. Refused, recorded. |

## Contract, artifact, API

The relation is unchanged: exact, bit for bit against the current revision's f32 meaning, NaN as a class, on `cudaCases`. The staged phases and folds are inside the checked source, and the case recipe exercises them at small extents and empty extents. The CUDA artifact goes to version 3: each kernel record gains `parallel`, the staged reductions it computes (for example `mean:sum(d)`), so the artifact still describes the mapping; the transformation goes to version 3 with it; the correspondence's evidence gains the same list. The fixed API is unchanged in shape: `cudaSource`, `runTixCuda`, `checkLowering` keep their signatures; `fuse: false` keeps emitting stage 2's bytes (the digest test); `benchmark` already flows to `runCudaBatch`.

## Measurements

- Corpus table: kernel count and `benchmark` GPU time, fused and unfused, median of three calls per program, with output digests; plus the two inside variants.
- The decline sweep: three families (softmax's exp phase, inside layernorm's staged divisions, mlp's contractions) at `points × T` from about 2,048 to 65,536, fused against unfused, to fix `FUSE_THREADS` where fused first stops losing everywhere.
- The staging refusal: softmax with `s` staged by force (bare-load body) against the rule, to show the buffer and barriers cost without a gain.
- The thread cap for staged kernels re-measured on inside layernorm at 64/128/256.
- Contract cost per program, as in stage 3.

## Framework

No change planned. The finding this stage adds: **the profitability decision needs the launch's shape values, and the checked transformation has no port that carries them.** The decision therefore lives in `runTixCuda`'s lowering, and the transformation checks the shape-independent default plan. A later `launchShapes` scalar port (a `JsonValue` of shape assignments) would let the checker judge exactly the source a concrete run executes. Legality stays IR-only, so nothing else moves.

## Later

- A `launchShapes` port on `tensor.lower-cuda` (version 4) so mixed plans are contract-checked as their own subjects.
- Staging with split-sum extents (rectangular decode of the blocks/tail nest).
- More threads per block for long rows, measured against the decline.
- The exactly rounded `exp` (softmax's floor), contraction tiling, tensor cores: unchanged from stage 3's Later list.
