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

## Step 3: the gate calibrated by sweep; the rule has two clauses; the rows cap moves to 256

Scripts 02 (calibration sweep, fused-ungated-source against fuse:false) and 03 (repeats around the
crossover), outputs committed:

- **mlp** is the one family that crosses: fused/unfused is 1.78 at 8,192 fused threads (N=128), 1.19 at
  12,288 (N=192), 0.99 at 16,384 (N=256), and it wins above (0.77 at 65,536, the corpus size). Every row
  member is a contraction reading a strided global operand, and there is no row-scalar member at all.
- **softmax, layernorm-inside** (streaming row members, 16 MiB fixed) never cross: fused wins down to
  4 rows x 128 threads = 512 fused threads (ratios 0.45 to 0.90). Their row-scalar members carry reductions
  that span the row, and stage 2 pays the same serial fold on one thread per row - at few rows that thread is
  the whole unfused kernel.
- **attention** never crosses either: 0.45 at Q=32 (2,048 fused threads) down to 0.71 at the corpus size.

So a single threshold would forfeit measured wins (softmax at 512 fused threads is 2.2x faster fused), and
the final rule has two clauses, both measured (fusion.ts): a block-mode group fuses when
`points x threads-per-block >= 16384` (the upper edge of mlp's measured crossover band), **or** when one of
its row-scalar members carries a reduction whose serial term count spans the longest row (the equalizer that
was measured never slower), **or** when the row fits in its block's threads (no concurrency lost at all).
The CPU tests pin all three clauses; the GPU tests run a gated (refused) source through the transformation's
candidate path and runTixCuda's gated path against the interpreter.

The rows-only thread cap is re-measured with staging (script 06): 256 beats stage 3's 128 (layernorm 0.189
against 0.209 ms; layernorm-inside 0.215 against 0.224; softmax 0.385 against 0.390) and 512 is worse again.
Stage 3 measured 128 best because thread 0 carried the whole serial reduction; with the terms staged across
the block, bigger blocks pay. `blockThreads.rows` is 256; the contraction cap stays 64.

## Step 4: probes, final table, contract cost; all suites green

Script 06 probes (each three benchmark calls):

- **Bare-load refusal**: the refused serial `sum(j) e[i,j]` at 0.383 ms against the same reduction staged by
  a multiplication by 1 (exact for every f32 word) at 0.381 ms - ratio 0.996. Staging a bare load buys
  nothing; the fold's own chain dominates. The refusal is measured, not argued.
- **Costly body**: layernorm-inside's staged instantiation at 0.240 ms against the serial instantiation of the
  same source (flipping the host's `staged_k0`) at 0.585 ms - staging is 2.44x faster, and the serial
  instantiation reproduces stage 3's measured fused time (0.569 in the brief's table), which cross-checks the
  whole mechanism.

Script 04 (final table, three benchmark calls per cell, GB10): every corpus program and both inside variants
fused is faster than unfused, all outputs bit-identical; layernorm-inside fused is 0.202 ms against 0.545
unfused (stage 3: 0.569 against 0.577). Script 07: the exact contract accepts all eight programs; cold
`checkLowering` 2.7-19.5 s wall (ssh and compile; the machine is shared), repeat 1-2 ms.

`node --test` on the GPU files: cuda-gpu 11, fusion-gpu 5, staging-gpu 5, all pass; CPU files 35 pass,
including the stage-2 digest pins. Prettier was run only on the new test files (the base's `src/tensor`
sources were already outside its style, so they are left as they were).
