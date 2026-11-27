---
Title: Implementation diary
Ticket: IRWB-033-G
Status: active
Topics:
    - tensor
    - gpu
    - compiler
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: The order of work in stage 6, with the probe numbers that decided each choice.
LastUpdated: 2026-11-27T11:55:00-05:00
WhatFor: How stage 6 was built, in order
WhenToUse: Reviewing why the schedule IR looks like this, or repeating the measurements
---

# Implementation diary

1. **Read** stage 3b's report, then stage 3's, then stage 2's; then `src/tensor/` (fusion, cuda-source, cuda-contract,
   cuda-runtime), the contracts and IR READMEs, `define-pass.ts` and the strategy README.
2. **Script 01** (hand-written tiled GEMM outside the compiler) before designing, because the design has to name tile
   sizes and a threshold. Findings, 512³, medians of three: naive (one thread per output) 0.2467 ms; 64×64×32×4×4
   0.0637; 64×64×64 0.0617; 32×32×16 0.0717; 128×128×32×8×8 0.125. At 4096³: 128×128×32×8×8 15.8 ms (8.71 TFLOP/s),
   64×64×32×4×4 18.9. Small sizes: the tiled kernel loses up to 224³ (1.14×) and wins at 256³ (0.86×) — so a launch
   threshold is needed, and vector loads/stores (0.0756 against 0.0637) are not worth a schedule step.
3. **Design + commit** (`1bfcc95`).
4. **Framework change**: `PassSpec.source` so a pass can read another IR kind, plus an optional output id for
   `applyNativePassSync`. Found by trying to write the Tix → schedule step as a pass: `openIR` validates the input
   against the pass's own adapter, which rejects another kind.
5. **`src/tensor/schedule.ts`**: the artifact, the adapter, `scheduleFromPlan` (the plan's groups → kernels, plus the
   thread rule that used to live in the emitter), `contractionOf` (what may be tiled), `orderClaim`/`flattenOrder`
   (the check) and `orderViolation`.
6. **`schedule-passes.ts`**: four passes and `scheduleGate`. First failure: the artifact's value is deep-frozen, so a
   pass must `structuredClone` before it mutates. Second: the order claim's text differed between an untiled and a
   tiled nest because the flattening prefixed the axis with its `kind`; fixed by giving a plain axis, a term fold and
   a flattened strip-mine the same text, and any other level its kind as a prefix.
7. **`schedule-strategy.ts`** and the wiring in `index.ts`/`cuda-contract.ts`/`cuda-runtime.ts` (`--tile`, `tiles` in
   the result, gate × tiling sides in the differential and in `baselineKey`).
8. **Script 02**: matmul 512³ fused 0.0699 against unfused 0.2175, same digest; both bodies exact against the
   interpreter on seven shapes. The first miss: `s[i,j] = sum(d) q[i,d]*k[j,d]` (attention's score) was refused
   because `contractionOf` wanted the reduction axis in a fixed index position. Generalised the classification to
   either position, and made each tile copy walk the operand's own innermost index. attention's score went from
   0.617 ms to 0.0375 ms (script 03).
9. **The grid condition**: attention's out (grid 16 of 48 SMs) was 1.04 of the per-element body when tiled; with
   "at least one block per SM" it takes the per-element body (0.987) and matmul 512³ (grid 64) keeps the tiled one.
10. **Script 03** (fused against unfused, five calls each, alternating): the corpus table and the four standalone
    GEMMs in the report; 4096³ fused 21.6 ms against unfused 134.
11. **Tests**: `tests/tensor/schedule.test.mjs` (15 tests, no GPU) and `tests/tensor/tiled-gpu.test.mjs` (7 tests,
    GPU, its own file). `tests/tensor/fusion.test.mjs` changed one assertion: a one-statement program used to be
    byte-identical fused and unfused, and matmul no longer is (that is this stage's change); conv2d still is.
12. **Script 04**: what one check costs per program with the tiling's second side.
