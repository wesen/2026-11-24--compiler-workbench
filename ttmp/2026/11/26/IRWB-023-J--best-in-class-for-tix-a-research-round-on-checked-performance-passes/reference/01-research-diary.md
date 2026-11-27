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

## Step 3 — Library research (citations for the design doc)

**Intent.** Collect the theory and practice anchors before writing, so every proposal cites checkable sources.

**Outcome.** Summation error theory: Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., SIAM 2002, ch. 4 (sequential fold bound gamma_{n-1} * sum|x|; pairwise/blocked bounds; the log2 n parallelism observation). Reproducible summation: Demmel & Nguyen, ARITH-21 2013 (doi 10.1109/ARITH.2013.9) and Ahrens, Demmel & Nguyen, ACM TOMS 46(3), 2020 (doi 10.1145/3389360) — fixed reduction trees as the reproducibility mechanism. Accurate dot products: Ogita, Rump & Oishi, SIAM J. Sci. Comput. 26(6), 2005 (doi 10.1137/030601818) — the Kahan/TwoSum family my certificate probes use. Tensor cores under FP32 accuracy contracts: Ootomo & Yokota 2022 (arXiv:2203.03341, 3xTF32-class recovery); NVIDIA cuBLAS 13 docs (bitwise reproducibility guaranteed only per toolkit version, single stream; not across versions) and the NVIDIA developer blog on BF16x9 FP32 emulation in cuBLAS 12.9+. Practice: Triton (MAPL'19), Ansor (OSDI'20), Halide (PLDI'13).

## Step 4 — E1: matmul variants on the GB10 (bit-exact tiling)

**Intent.** Test the core structural hypothesis: locality transformations (shared-memory tiling, register blocking) that leave each output element's fold order and rounding sites untouched are bit-identical to the Stage 2 meaning, and worth a large speed factor.

**Outcome (timed run, median of 10 event intervals, 512^3, seed-20 uniform inputs).**
`scripts/gpu/e1-matmul/main.cu`, results in `scripts/e1-matmul-results.md`:
- Stage 2 emitted kernel embedded verbatim: 0.2141 ms (1.3 TFLOP/s), matching the coordinator's 0.197 ms.
- 16x16 shared-tile kernel, k ascending: 0.1232 ms, **0/262,144 bit mismatches**.
- 16x16 tile + 2x2 register accumulators: 0.0863 ms (3.1 TFLOP/s), **0/262,144 bit mismatches**.
- 8-way split-K + ordered combine: 0.1959 ms — no speedup at this shape (refuted my expectation), 243,569 bit mismatches, but 2.5x *smaller* max error than sequential (5.6e-6 vs 1.4e-5 rel-scaled).
- Kahan compensation on the k0 structure: 0.2173 ms (**+1.6%** median) — cheap.
- f64 shadow accumulation: 2.7323 ms (**12.9x**) — refutes f64-based runtime certificates; Kahan-in-f32 stands.
- Sequential f32 error at K=512 consumes 70% of the Stage 1 tolerance (1.4e-5 of 2e-5 rel); gamma_511 worst case bound is 4.6e-3, ~16,000x looser than observed - worst-case gamma bounds certify little at these sizes.

**Failures along the way.** nvcc rejected `std::min` in a kernel (fixed with a ternary); illegal memory access #1: split-K partial buffer allocated without the SPLITS factor; #2: the inner `kk` loop bound let kk reach 63, reading past a 16x16 shared tile. The one-probe-per-kernel pre-pass found both. All failures are recorded because the final binary's correctness was only established after them.

## Step 5 — E2: reduction-order error study (local, exact f32 emulation)

**Intent.** Ground the "derived budget" proposal: how do orders the Tix IR can express compare in forward error, against Higham's bounds and against the Stage 1 tolerance?

**Outcome.** `scripts/02-reduction-error-study.mjs`, K=1024 dot products, 300 trials: sequential max rel-scaled error 8.6e-6, split-16 2.5e-6, pairwise 2.0e-6; worst-case gamma bounds (6.1e-5, 4.6e-6, 6.0e-7) are 40-600x above observed maxima. The half-ULP witness (1 + 1023 * 2^-24) is stark: sequential returns exactly 1 (loses the whole 6.1e-5 tail), split-4 recovers to 1.8e-10 error, pairwise to 6.1e-10 - i.e. the *unoptimized sequential meaning itself* would violate the 2e-5 tolerance on this input while every blocked order passes. First witness attempt (2^-12 terms) failed to separate the orders (terms too large to round away); fixed to half-ULP terms.

## Step 6 — E5: width-B split pass through the real framework gate (local)

**Intent.** Check whether parameterized reassociation is (a) expressible in today's IR and (b) arbitrated by today's gate.

**Outcome.** `scripts/03-split-width-gate.mjs` reimplements split-sum with a width parameter as a script-level pass (definePass + applyNativePassSync + meaningGate - the same machinery optimizeTix uses). Result: width 2 produced a structurally valid candidate with **wrong values** (stride 2 vs baked-in extent width 4); widths 8-64 produced NaN-reading candidates; the gate **rejected every one** with a coordinate-level counterexample. Width 4 accepted. Root cause found in `src/tensor/evaluate.ts`: `blocks`/`tail` extents interpret `width` as the *global constant* 4 from `model.ts` - the generated-bound forms cannot express any other width. So: (1) the differential gate catches semantic corruption that structural validation passes - good framework evidence; (2) the IR schema (tensor.tix v1) needs the split width carried in the extent form before reassociation can be parameterized, checked, and tuned. This was a happy failure: the intended experiment (gate insensitivity to B at sample scale) became a stronger finding about IR expressiveness.

Also confirmed (part 2 of the script): at K=128 with random data, origin f32 consumes 0.6% of budget and split-4 halves the error (0.25%); the gate accepted everything it could express, showing sampled acceptance is insensitive to the quantity (error) that actually varies with width and scale.

## Step 7 — E3/E4: fused statement chains with fixed reduction trees (GB10)

**Intent.** Test the fusion proposal and the two-reduction softmax case, including the claim that a max reduction tree is bit-exact under the Tix minmax semantics.

**Outcome (timed).**
- Layernorm (`scripts/gpu/e3-layernorm/`, results `scripts/e3-layernorm-results.md`): Stage 2 four-kernel sequence 0.4792 ms; fused one-block-per-row kernel with fixed shared-memory trees 0.1395 ms (**3.44x**, 240.6 GB/s = 98.6% of the measured 244 GB/s streaming roofline); Kahan variant +0.6%. Fused consumes 0.135 of the f64 tolerance vs Stage 2's 0.572 - the fused tree is both faster and 4x more accurate. Cross-check through the product (`scripts/04-layernorm-crosscheck.mjs`): Stage 2 output bit-identical to the interpreter f32 on 4096/4096 elements of the probe rows; fused output 4x inside the interpreter f64 budget fraction of the sequential meaning.
- Softmax (`scripts/gpu/e4-softmax/`, results `scripts/e4-softmax-results.md`): Stage 2 0.8308 ms; fused 0.3865 ms (2.15x - bound by 4.2M double-precision exp calls, not bandwidth). **Tree max = sequential max bit-for-bit on all 4096 rows**; the sum tree differs (94% of words) with 9x smaller budget consumption (0.0027 vs 0.0233).

**Failure.** The first cross-check reported absurd budget fractions (~2e6) because `readFileSync(...).buffer` on the small gamma/beta/eps files is a pooled ArrayBuffer with nonzero byteOffset; x.bin (16 MB) hid the bug. Fixed by honoring byteOffset. The bad intermediate numbers were never used in a conclusion; the corrected run supersedes them.

## Step 8 — E7: cost of the sampled gate vs full-scale checking (local)

**Intent.** Quantify the "check time" axis: what does today's sampled gate cost, and what would full-scale CPU checking cost?

**Outcome.** `scripts/05-check-cost.mjs`: one checked split-sum application costs 0.6-15.2 ms per corpus function on this host (sample scale, dims <= 7). A single f64 origin evaluation at quarter scale (e.g. matmul 128^3) costs 77-999 ms; at full corpus scale this is minutes - which is why the sampled domain exists, and also why it is blind at scale. Against this, the GPU certificate probes (Kahan shadows) cost +0.6% (memory-bound layernorm) and +1.6% (latency-bound matmul): full-scale checking can ride inside the kernel on the GB10 for well under the noise floor, while CPU checking cannot.
