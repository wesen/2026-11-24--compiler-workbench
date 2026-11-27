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
