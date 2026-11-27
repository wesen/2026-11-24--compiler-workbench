---
Title: Implementation diary — IRWB-023-E research round
Ticket: IRWB-023-E
Status: active
Topics:
    - compiler
    - ir
    - verification
    - tensor
    - numerics
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of the research round: reading, six experiments, two refutations.
LastUpdated: 2026-11-26T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 0. Framing, before any experiment

Read both prior tickets (design + report) and then the code: `src/tensor/model.ts`, `parser.ts`,
`evaluate.ts`, `contract.ts`, `passes.ts`, `cuda-source.ts`, `cuda-contract.ts`,
`cuda-runtime.ts`, and the framework's `contracts/types.ts`, `contracts/differential.ts`,
`passes/define-pass.ts`. Built `dist/` (`npm run build`, exit 0).

Starting hypothesis: "the exact f32 meaning is the enemy of performance; the interesting work is
finding what it costs and where that cost is misallocated". Deliberately left open *which* parts of
the meaning are expensive.

Hypotheses I wrote down before measuring, so that I could be wrong in public:

1. The no-contraction rounding discipline (`__fmul_rn` + `__fadd_rn` instead of one FMA) halves
   matmul throughput.
2. The double-precision `exp`/`log`/`tanh` path costs a large fraction of softmax, attention
   and mlp.
3. A sequential fold is more accurate than a parallel tree, because it visits terms in the
   written order.
4. The tolerance gate would reject an implementation-level change like `expf`.

Hypotheses 1 and 3 were wrong; 2 and 4 were right, and 4 was right for a reason I had not
imagined (the gate's budget is 10⁵ times looser than the deviation it was passed).

## 1. Experiment 01 — microbenchmarks on the GB10 (`scripts/probe/main.cu`)

First compile failed: `cudaDeviceProp` has no `clockRate` in CUDA 13; a `void(*)()` benchmark helper
cannot take capturing lambdas (fixed with a template); `__float_as_uint` is device-only (replaced
with a `memcpy` helper). Second run: exit 0, 335 ms of GPU work.

Results (medians of 5 event intervals, 4 Mi elements unless noted):

- streaming 246.8 GB/s — reproduces the coordinator's 244 GB/s.
- double `exp` 0.368 ms vs `expf` 0.136 ms → 2.7×; `expf` is *at the streaming floor*, so the whole
  cost is the double-precision transcendental.
- GELU with double `tanh` 0.829 ms vs `tanhf` 0.137 ms → 6.0×.
- row sums of 1024, 4096 rows: sequential 0.115 ms, warp tree 0.0125 ms (9.2×), block tree
  0.0250 ms, double-accumulating block tree 0.0865 ms.
- accuracy against the double reference: sequential 2.14e-6 relative, both trees 1.21e-7 → the
  specified order is **17.7× less accurate** while being 9.2× slower. Hypothesis 3 refuted.
- bit differences between mappings: 3824/4096 rows (sequential vs warp), 1228/4096 (warp vs block).
- 512³ matmul: exact 0.160 ms (1.68 TFLOP/s), plain contraction 0.158 ms, explicit `__fmaf_rn`
  0.158 ms → 1% difference. Hypothesis 1 refuted, and with it my initial premise about the
  "exactness tax".
- contraction changes 221 934 of 262 144 output words. So contraction is numerically free and
  semantically loud; the opposite of what I assumed.

Decision: the axis is not "exact vs fast" but "which part of the meaning is being paid for". Split
the question into *arithmetic*, *transcendentals*, *fold order*, *schedule*.

## 2. Experiment 02 — auditing the contract (`scripts/02-contract-audit.mjs`)

Wrote a script that enumerates `cudaCases()` for all six corpus functions and runs reductions
through the real evaluator in both precisions.

- Case domain: 28–40 cases per function, extents {0,1,3,4,5,7}, residues mod 4 {0,1,3}, largest
  tensor **49 elements** (conv2d 2401), all values in [−1, 1].
- One 1024-length f32 sum against the contract budget: 1.4% of budget for positive data, 0.8% for
  signed, 0% for alternating ±1.
- My first "adversarial" pattern (alternating ±1) was exactly zero: f32 cancellation is exact. Had
  to design a third pattern (1e3, then 1023 terms of 1e-3, then −1e3) before anything happened —
  that one uses **106 743%** of the budget through the *correct* f32 evaluator.
- Classical bound vs observation at n = 4096: γ₄₀₉₅Σ|a| = 0.50 against an observed 4.0e-5 — four
  orders of magnitude apart, with the contract's constant sitting in between.

Parse error along the way: I wrote `fn f(x: f32[1,N]): f32[1,1]` for a rank-1 result; the checker
rejected it at 3:10 with "Invalid return tensor or shape". Useful reminder that the front end really
does check.

## 3. Experiment 03 — the fast-lowering A/B (`scripts/03-fast-lowering.mjs`)

Idea: do not simulate the cost of exactness; take the real emitted CUDA text, rewrite it into a fast
variant, and ask the *real* merged contract to judge it. `createCudaLowering(profile, executeBatch)`
takes an `executeBatch`, so the substitution costs nothing and the invariant, case recipe, budget and
memoisation are the shipped ones.

Implementation details that cost time:
- the emitted transcendental is `__double2float_rn(exp(static_cast<double>(X)))`; a textual
  replacement has to keep the three opening parentheses balanced (`fast_exp(((`), which is not
  obvious the first time;
- identifiers `__fmul_rn` → `fM` etc. plus `#define fM(a,b) ((a)*(b))` gives contraction without
  fighting the preprocessor;
- import paths had to go through `process.cwd()` + `dist/...` (four `..` levels, easy to get wrong).

First run (softmax only): 0.798 → 0.542 ms (1.47×), 2 089 873/4 194 304 words differ, gate
**accepted**. Full run over six functions with `--timed`. Then I noticed my "worst relative error"
column was dominated by near-zero outputs and reran with the contract's own budget as the metric;
the rerun is the table in the design doc.

What the table says: softmax gains 47% for a deviation that uses 0.000 of the budget; matmul/mlp/
conv2d gain nothing and exceed the budget by 1.03–26.8; every variant is accepted. Hypothesis 4 was
right, for a reason I had not imagined.

## 4. Probe 2 — is the exact meaning inside its own contract at corpus size?

`scripts/probe2/main.cu`: stage-2 arithmetic at 512³ against a double reference on the same device.

- correct f32 matmul: **4.36× the contract budget**, 334/262 144 elements outside it,
- largest absolute error 2.93e-5, worst relative 5.6e-2 (near-zero outputs),
- 1024-length row sum: 0.095 of budget, 0 rows outside.

So the contract is simultaneously too loose (accepts 26× overruns at sampled sizes) and too tight
(rejects the specified meaning at corpus size). That is the strongest single result of the round and
it is what P2 (certified bounds) answers.

Incidentally: the double GEMM at 512³ took 0.62 ms, so FP64 on this part is ~1/4 the FP32 rate for
naive code — the exact-sum and shadow-bound proposals are affordable on this hardware.

## 5. Probe 3 — is a schedule change bit-identical?

`scripts/probe3/main.cu`: the same accumulation chain under naive, 32×32 shared tile, and 32×32 tile
+ 2×2 register blocking.

Two failures and one decisive result:
- first compile: `run()` returned void but used the `CHECK` macro (which returns 1) → nvcc error;
- first run: illegal memory access, because `k_reg` indexes `As[ty + TR]` while I launched it with
  a 32×32 block (`TR` is 16). Fixed the launch geometry.
- then: **register-blocked schedule is bit-identical on 0 of 262 144 words differing** (i.e. all
  words agree) and 1.54× (512³), 1.64× (1024³), 1.85× (2048³) faster than naive.
- the plain shared-memory tile differs on **262 144 of 262 144** words and I could not explain why
  in the session. Same chain, same intrinsics, no padding at K = 512. Either a load/layout bug or a
  compiler effect I did not isolate. I am reporting it as an unexplained negative result rather than
  hiding it, because it is the best possible argument for running a bit-identity check on every
  schedule pass: I could not distinguish the correct schedule from the incorrect one by reading it.
- honest disappointment: 3.20 TFLOP/s at 2048³ against cuBLAS 19.2 at 4096³ — 6× still to find, and
  it is a tuning problem, not a semantics problem.

## 6. What I decided, and what I left

Decided: rank by *measured guaranteed speedup*, and split the meaning into a value layer (declared
bounds) and a schedule layer (bit identity). That split is what makes every number in this document
land somewhere coherent: the 1% contraction cost and the 0-of-262 144 bit identity belong to the
schedule layer, the 2.7×/6.0× transcendentals and the 9.2× reduction order belong to the value
layer.

Left undone, deliberately, with the exact next measurement named: the shadow-program certification at
corpus size (P2's own prototype), the residue-complete case cover plus coverage metric (P4), any
tensor-core prototype (P5), and the fused softmax the traffic model predicts at 0.14 ms.

## 7. Last run — the exhaustive sweep (probe 1, `-- exhaustive`)

Launched at the end of the session, expecting it to take a minute or more; it took **848 ms** for
2³² words × two functions.

- `__expf(x)` ≠ `fround(exp_double(x))` on **217 556 132** words (5.07%), plus 16 777 212 more where
  both sides are NaN (compare them as a class).
- `tanhf(x)` ≠ `fround(tanh_double(x))` on **39 501 004** words (0.92%).

This refuted a fifth assumption I did not know I held — that "single-precision `expf` is within a
couple of ulps, so it is basically the same function". It is not: one input word in twenty produces a
different f32 result. It also changes the cost calculus of P4 completely: exhaustive verification of a
unary kernel is cheaper (0.85 s, one invocation) than the remote compile a sampled check needs, so
"decide the scalar fragment" is not an aspiration, it is a Tuesday.
