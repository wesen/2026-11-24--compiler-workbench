---
Title: IRWB-023-J research diary
Ticket: IRWB-023-J
Status: active
Topics: [compiler, ir, verification, research]
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of research, experiments, failures and decisions for the best-in-class research round.
LastUpdated: 2026-11-26T18:05:00-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-023-J research diary

## Step 1 — Orientation and the shape of the question

**Intent.** Read the two prior Tix tickets (IRWB-020-B, IRWB-022-I) designs and final reports, then the tensor sources, before defining "best in class" for Tix.

**Outcome.** The picture that emerged: Tix's distinguishing assets are (a) an exactly specified f32 meaning — every operator rounds, every reduction has a fixed visiting order — shared bit-for-bit by the Node interpreter and the CUDA lowering; (b) the v6 framework where *every* transformation is a checked pass with an explicit relation to a baseline (exact word equality, or a tolerance budget vs the f64 origin); (c) a GB10 to run experiments on.

The Stage 2 lowering is deliberately naive: one kernel per statement, one thread per output element, per-thread sequential reductions. Measured: matmul 512³ at 0.197 ms (≈1.36 TFLOP/s) vs cuBLAS SGEMM 0.0329 ms (8.15 TFLOP/s) — a 6× gap — while a streaming kernel proves the memory system does 244 GB/s and softmax/layernorm move several times more bytes than that bound allows for their measured times.

A key structural observation I want to test first: **memory-locality tiling that leaves each output element's reduction order and rounding sites untouched should be bit-exact**, i.e. checkable under the strictest gate, while traditional wisdom files "tiling" under "changes the numerics". If that holds, a large share of the performance gap can be closed with *zero* numerical risk, and the tolerance budget only needs to be spent where reassociation actually buys something (register blocking/ILP, cross-thread reductions, fusion of reduction chains, tensor cores). That split — exact locality work vs budgeted reassociation work — is the seed of the design.

**Evidence.** Read:
- `ttmp/2026/11/26/IRWB-020-B--.../design-doc/01-tix-semantics-and-checked-tensor-rewrites.md` and `reference/02-report.md`
- `ttmp/2026/11/26/IRWB-022-I--.../design-doc/01-checked-tix-to-cuda-lowering.md` and `reference/02-report.md`
- `src/tensor/model.ts`, `passes.ts`, `index.ts`, `evaluate.ts`, `cuda-source.ts`, `contract.ts`; `tools/cuda-remote.mjs` header.

Measured facts supplied by the coordinator (GB10): cuBLAS SGEMM 0.0329 ms @512³ (8.15 TFLOP/s), 19.2 TFLOP/s @4096³; streaming y=2x at 244 GB/s; merged stage-2 kernel times (matmul 0.197 ms, softmax 0.785 ms, layernorm 0.563 ms, attention 1.81 ms, mlp 1.05 ms, conv2d 0.341 ms); lowering bit-identical with the f32 meaning on everything measured; CUDA double exp/log/tanh rounded to f32 equal the JS meaning for all 2³² inputs.

Build: `npm run build` succeeded (tsc, no errors).

## Step 2 — Plan for the round

**Intent.** Define "best in class", then propose and *test* the proposals with probes in `scripts/`.

**Plan.**
1. Library/web research on: summation error theory (Higham), reproducible/blocked reductions (Demmel–Nguyen), tensor-compiler practice (Triton, TVM/Ansor, Halide), bit-exactness work on GPUs, FP32 tensor-core emulation (3xTF32), Kahan/compensated summation and error-free transformations.
2. Local probe: import the Stage 2 emitter from `dist/` and re-emit the corpus kernels to have a faithful baseline to compare against.
3. GPU probes (handwritten CUDA in `scripts/`, run via `tools/cuda-remote.mjs`):
   - E1: bit-exactness of a shared-memory tiled matmul vs the Stage 2 kernel; timings vs the stage 2 kernel and a 2-accumulator register-blocked variant (which should *change* bits).
   - E2: reduction-order error study: sequential vs width-B split vs pairwise at K=1024/4096, random data; compare against Higham bounds; show blocking *reduces* worst-case error (informs derived per-pass budgets).
   - E3: fused single-kernel layernorm/softmax with a fixed deterministic block-tree reduction: timing + error vs f64 reference; compare traffic estimate against the 244 GB/s roofline.
   - E4: cost of runtime error certificates: f64 and Kahan shadow accumulation overhead in a matmul kernel.
4. Local probe: a generalized width-B split rewrite implemented *as a script* against the compiled Tix IR (no src changes), run through the real differential gate to show the framework arbitrates derived budgets today.
5. Design doc with ranked proposals, ≥2 mermaid diagrams, staged plan, failures section.
