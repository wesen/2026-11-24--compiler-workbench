---
Title: Implementation diary
Ticket: IRWB-030-F
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
LastUpdated: 2026-11-27T02:15:00-05:00
---

# Implementation diary

## Step 1: base read, design written

Read stage 3's design, final report and code first, then stage 2's design, then `src/tensor/`
(`fusion.ts`, `cuda-source.ts`, `cuda-contract.ts`, `cuda-runtime.ts`, `index.ts`,
`contract.ts`, `evaluate.ts`, `passes.ts`, `parser.ts`, `ir.ts`) and the framework READMEs, as
the brief orders. The brief's motivating case is confirmed in the code: in `emitGroup`, a
row-scalar member (rank == depth) is computed inside `for (U e = threadIdx.x; e < 1; ...)`, so
thread 0 alone walks `kernelWriter.scalar`, which inlines the reduction's serial loops; every
term - a division in the "inside" placements - is computed on that one thread, while stage 2
runs one thread per row.

Design (design/01-fusion-that-is-never-slower.md), committed before implementation:

- **Parallel terms.** A reduction's body cannot mention the accumulator in this IR, so every
  term is a pure function of loads. Fill the terms in shared memory from all threads of the
  block, one thread folds them in the meaning's order; bit-identical by construction. Only
  row-scalar members of block-mode groups (the ones that lose concurrency); refuse bare-load
  bodies (the fold chain dominates), nested reductions (staging leaves would reassociate a
  split sum), tail axes on outermost reduces (never generated; flat decomposition unsafe), and
  row members (their elements are already spread over the block's threads; a term buffer would
  be the whole row's terms).
- **Cost gate.** `gatedPlan(fn, shapeValues)` replaces a block-mode group with stage-2
  singleton kernels when its fused parallelism (points x threads-per-block) is below a
  measured saturation threshold. `runTixCuda` has the launch shapes and uses the gate;
  `cudaSource` (and so `checkLowering` and the kernel count) keeps stage 3's fully fused plan;
  a gated source is checkable through the transformation's existing candidate path.
- No framework change planned; the candidate path, the `fuse` port, the correspondence and the
  revision-keyed differential evidence already express everything the stage needs.

Two earlier ideas rejected in the design: emitting both fused and fallback kernels with a
launch-time branch (doubles the compared kernel counts), and shape-specializing `cudaSource`
everywhere (the contract checks one source over many shape assignments).

## Step 2: staging and gate implemented; all existing tests pass; two emitter bugs found by the GPU compile

Commit `IRWB-030-F: parallel reduction terms in the plan and emitter, and the launch-shape cost gate`.

`fusion.ts` now records, per block-mode group, the outermost reductions of row-scalar members whose
terms are staged (`parallelTerms`, with the child-index path to the reduce node), and the refusals in
`reasons` (bare-load body; tail axis on an outermost reduce; row members; nested reductions noted as
serial within their term). The block-thread cap moved here (`groupCap`) so the gate and the emitter
compute the same launch. `gatedPlan(fn, shapeValues)` applies the cost gate; `gateThreads` is a
placeholder (16384) until the calibration sweeps. `index.ts` computes the shape values from the inputs
in `runTixCuda`; `cudaSource` stays ungated.

`cuda-source.ts`: `kernelWriter` gained a fold mode (`setFold`) that replaces a staged reduction with a
serial in-order fold over its term buffer; `emitGroup` emits the fill loops (flat index decomposed into
the axes, each thread taking a strided share), one barrier, and the fold by thread 0 inside
`if constexpr (Staged)`, with stage 3's serial walk as the `else`. The group becomes
`template <bool Shared, bool Staged>` only when something is staged. The host picks the instantiation
that fits shared memory (rows and term buffers together), the same one-code-path choice as stage 3's
shared/scratch switch.

Two bugs found while bringing the GB10 compile up, both in the new code:

1. **Binder-name collision across the walks.** `kernelWriter.bind` derived names from `indices.size`;
  the fill's `alias` of a reduce axis and the serial fallback's `bind` of the same axis then reused a
  stale size, and the emitted fallback read `4LL * i4 + i4` (five times the lane, not four times the
  block plus the lane). Fixed with a dedicated counter; stage 2's kernels bind every axis exactly once
  in order, so `emitKernel` and the `fuse: false` digests are unchanged (the digest test passes).
2. **Template arguments must be constant.** `k0<shared_k0>` does not compile; the launch now selects
  the instantiation with runtime `if`s, as stage 3 did, and `std::max<U>` needed `static_cast<U>` around
  the term-count products (braced-init narrowing).

Evidence: `node --test tests/tensor/{fusion,language,passes,cuda,corpus,staging}.test.mjs` all pass
(51 CPU tests, including the stage-2 digest pins and the corpus plan shapes); on the GB10,
`cuda-gpu.test.mjs` (11) and `fusion-gpu.test.mjs` (5) pass unchanged, so the staged kernel is exact on
the corpus (layernorm's variance is staged), on split sums, beyond both shared-memory limits, and the
two mutants are still rejected. The new `staging-gpu.test.mjs` (5) passes: staged reductions exact
against the interpreter (multi-axis, two reductions in one member, max, a staged reduce reading a row
buffer, empty extents, attention-inside), the serial-fold fallback (`<true, false>`, term buffer of
240 KB) and the scratch-rows-with-staged-terms case (`<false, true>`) exact through the ungated source,
the inside placements accepted by `checkLowering`, and the gated unfused source accepted through the
candidate path.

Not yet done: the gate's constant is a placeholder; calibration sweeps, corpus benchmarks and the
report remain.
