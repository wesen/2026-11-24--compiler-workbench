---
Title: IRWB-023-H research diary
Ticket: IRWB-023-H
Status: active
Topics:
    - compiler
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological research diary for the best-in-class Tix compiler round.
LastUpdated: 2026-11-26T00:00:00Z
---

# IRWB-023-H diary

## 1. Orientation and ticket setup (2026-11-26)

The authored request (verbatim, first appearance): "Your ticket is IRWB-023-H. This is a research round: design and experiment, no changes to the product code. The question: What compiler work would make Tix best in class? 'Best in class' is yours to define and defend. ... This round measures ingenuity, creativity and scientific depth. What scores well: ideas that exploit what is specific to Tix: an exactly specified f32 meaning, index notation, every transformation a checked pass in the v6 framework, and a GPU available for experiments; a familiar technique, when you find something new to say about it here; claims tested by experiments you design and run, including the ones that refute your idea."

I read the Stage 1 (IRWB-020-B) design and report and the Stage 2 (IRWB-022-I) design and report, then skimmed `src/tensor/*.ts` (model, evaluator, passes, CUDA emitter) and the framework differential contract. Key facts I take forward:

- The f32 meaning is exactly specified: every arithmetic op, literal, shape value and fold step rounds with `Math.fround`; sums start at +0, maxima at -Infinity; folds are lexicographic, first binder outermost. The CUDA emitter reproduces these rounding sites with explicit `__f*_rn` intrinsics and double transcendentals, and the coordinator measured bit-identity with the f32 meaning for all 2^32 f32 exp/log/tanh inputs.
- The two existing passes: `inline` (exact gate) and `split-sum` (tolerance gate, budget `2e-6 + 2e-5*|r|`, checked against the f64 interpreter on sampled cases with at most 4096 elements per tensor).
- Naive CUDA: one kernel per statement, one thread per output element. GB10 timings (coordinator): matmul 512^3 0.197 ms vs cuBLAS 0.0329 ms; streaming 244 GB/s; softmax 0.785 ms; layernorm 0.563 ms; attention 1.81 ms; mlp 1.05 ms; conv2d 0.341 ms.
- CPU interpreter is very slow at full size (matmul 512^3: 781 s wall), so full-size checking is only possible with a GPU oracle.
- `checkLowering` sampling is limited to small shapes (<= 4096 elements/tensor), so deployment-shape behaviour is unchecked.

Created the ticket with docmgr. Plan: three research threads — (A) certified (static) error bounds for reduction rewrites vs the sampled gate; (B) meaning-preserving tiling/fusion chasing vendor performance under the exact gate; (C) a GPU f64 oracle so checks run at deployment shapes. Each gets an experiment.

`npm run build` succeeds on this worktree.

## 2. Experiments E0–E6 (2026-11-26)

**E0 (`scripts/01-api-probe.mjs`).** Public API probe on matmul 8×8: f32-vs-f64 max diff 2.6e-7; `optimizeTix ['inline','split-sum']` accepted both; `cudaSource` emits one kernel and the split-sum block structure is visible in the emitted text.

**E1 (`scripts/02-exact-error-study.mjs`, local Node).** Exact-real oracle for f32 summation schemes via BigInt rationals (every f32 is an integer multiple of 2^-1074), n=1024:

| Scheme | max err vs exact (random ±1, 200 trials) | max err (adversarial, exact sum ≈ 0, 50 trials) | Certified bound (Higham-style, S≈512) |
| --- | ---: | ---: | ---: |
| sequential | 9.7e-5 | 8.3e-5 | 3.1e-2 |
| blocked w=4 (split-sum) | 2.7e-5 | 2.0e-5 | 7.9e-3 |
| blocked w=32 | 8.2e-6 | 8.0e-6 | 1.9e-3 |
| pairwise | 5.0e-6 | 6.9e-6 | — |
| Kahan (two-sum) | 1.8e-6 | 1.6e-6 | 6.1e-5 |
| f64 accumulator | 1.8e-6 | 0 | ~u·S = 3.1e-5 |

Two findings: (a) certified worst-case bounds are 100–300× looser than measured random-case error, but preserve the right *ordering*; (b) **the sampling gap is real and quantified**: what the Stage-1 split gate compares (|blocked − seq|) is ≤ 4.8e-7 at the sampled scale (n≤7, always inside the 2e-6 budget) but reaches 1.1e-4 at n=1024 under cancellation, exceeding the budget in 49/50 trials. Sampled evidence at toy shapes does not transfer to deployment shapes.

**E3 (`scripts/03-tiled-matmul/main.cu`, GB10, `--timed`).** Hand-written shared-memory tiled matmul with register blocking (64×64 tiles, 4×4 per thread, k walk kept sequential and in order). **Bitwise mismatches vs the naive stage-2 kernel: 0 at 512³, 1024³ and 2048³.** Medians of 20 event-timed runs: naive 0.215 / 2.041 / 16.789 ms (1.25 / 1.05 / 1.02 TFLOP/s); tiled-exact 0.0495 / 0.262 / 2.134 ms (**5.43 / 8.19 / 8.05 TFLOP/s**, 4.4× / 7.8× / 7.9× over naive). The same tiled kernel with `fmaf` (contraction allowed, meaning-violating) is only 14–21% faster (6.2 / 9.5 / 9.7 TFLOP/s). So: tiling under the exact gate reaches 5.4 TFLOP/s at 512³ (cuBLAS FP32: 8.15) and 42% of cuBLAS at 2048³, and the entire cost of bit-exactness is ~15%.

**E4 (`scripts/04-fused-softmax/main.cu`, GB10, `--timed`).** Softmax 4096×1024:
- naive 4-kernel lowering: 0.76–0.88 ms median.
- first exact-fusion attempt (sequential fold *with the double exp in the chain*, one thread per row): **12.2 ms — 16× slower. REFUTED my initial hypothesis that exact fusion is free.** The fold's serial dependency chain must not contain expensive ops.
- fixed exact fusion (parallel max — order-independent under the Tix minmax semantics — then parallel e into shared memory, then the exact j-order fold over shared-memory operands by one thread, then parallel y): **0.354 ms, 2.3× faster than naive, and 0 / 4,194,304 bit mismatches.**
- order-changing tree-sum fusion: 0.712 ms — slower than the exact variant (it recomputes exp) AND 4,100,331/4,194,304 words differ (max 5.6e-8).
- Debugging note: the first run showed 94% mismatches that were a bug in MY hand-written harness `k_max` (2-D index decode applied to a 1-D output), not in the fused kernel. The emitted kernels decode coordinates from the output shape; my harness divided by d1 anyway. This is exactly the error class the checked lowering exists to catch — a hand-ported kernel without a meaning check silently computes the wrong rows.

**E5 (`scripts/05-f64-oracle/`, GB10).** Built an f64 oracle program by transforming the emitted CUDA source (float→double, `__d*_rn` intrinsics, transcendental path already double, f32 inputs staged and widened, literal words mapped back to full-precision doubles via the IR). Oracle validation at small shapes vs the Node f64 evaluator: **bit-identical for matmul (45/45), layernorm (65/65), conv2d (160/160)**; ≤ 2.15 ulp differences where double exp/tanh implementations differ (softmax 8/66, attention 4/20, mlp 1/12).

Deployment-scale check (full corpus sizes, uniform [-1,1] inputs, Stage-2 budget |g−r| ≤ 2e-6+2e-5|r|, all elements):

| Program | Elements | Violations | Max budget fraction | Tool cost (compiles+runs) |
| --- | ---: | ---: | ---: | ---: |
| matmul 512³ | 262,144 | 148 | 3.2× | 0.8 s (wall 5.3 s) |
| softmax 4096×1024 | 4,194,304 | 0 | 1.2e-3 | 0.7 s (wall 10.7 s) |
| layernorm 4096×1024 | 4,194,304 | 0 | 0.27 | 0.7 s (wall 10.6 s) |
| attention 1024×1024×64 | 65,536 | 15,552 | 5.6e-2... (fraction 0.056, i.e. within budget per element but 24% of elements within 5.6% of budget? no — see below) | 0.6 s (wall 4.8 s) |
| mlp | 262,144 | 2,340 | 36× | 0.6 s (wall 5.6 s) |
| conv2d | 984,064 | 0 | 0.94 | 0.6 s (wall 5.9 s) |

Correction while writing: attention's "max budget fraction 5.64e-2" means the worst element used 5.6% of its budget — but 15,552 elements (24%) still violated. (Fractions >1 violate.) So: **three of six corpus programs violate the Stage-2 budget at deployment shape with [-1,1] inputs** — matmul (0.06% of elements, up to 3.2× budget), attention (24%, just over), mlp (0.9%, up to 36×). The sampled gate sees only sums of ≤7 terms and accepts all of these. The check itself costs ~6–11 s wall per program (GPU compute ~0.3 s), versus ~13 CPU-minutes for one matmul f64 interpreter run.

**E6 (`scripts/06-optimized-at-scale/`, GB10).** The split-sum-optimized matmul, judged at deployment size: gpuMs 0.312 ms vs original 0.214 ms — **the optimizer's only numeric rewrite makes the GPU kernel 46% slower** — and its own f64-oracle check still shows 18 violations (max 1.3× budget). The sampled split gate observed ≤4.8e-7 deltas at n≤7 and accepted. Neither the speed cost nor the deployment-scale error of the rewrite was visible to the gates that accepted it.

## 3. Citations collected (2026-11-26)

- N. J. Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., SIAM, 2002 (summation error bounds, ch. 3–4).
- T. Ogita, S. M. Rump, S. Oishi, "Accurate Sum and Dot Product", SIAM J. Sci. Comput. 26(6), 2005. https://dl.acm.org/doi/10.1137/030601818
- W. Ahrens, J. Demmel, H. D. Nguyen, "Algorithms for Efficient Reproducible Floating Point Summation", ACM TOMS 46(3), 2020. https://dl.acm.org/doi/10.1145/3389360 (reproducible reduction orders via binning; builds on Demmel–Nguyen ARITH 2013).
- A. Solovyev, M. S. Jacobsen, Z. Rakamarić, G. Gopalakrishnan, "Rigorous Estimation of Floating-Point Round-off Errors with Symbolic Taylor Expansions", ACM TOPLAS 41(1), 2018 (FPTaylor). https://soarlab.org/papers/2018_toplas_sbbjrg.pdf
- A. Das et al., "An Abstraction-guided Approach to Scalable and Rigorous Floating-Point Error Analysis" (Satire), arXiv:2004.11960, 2020. https://arxiv.org/abs/2004.11960
- P. Panchekha, A. Sanchez-Stern, J. R. Wilcox, Z. Tatlock, "Automatically improving accuracy for floating point expressions", PLDI 2015 (Herbie). https://herbie.uwplse.org/pldi15-paper.pdf
- P. Tillet, H. T. Kung, D. Cox, "Triton: An Intermediate Language and Compiler for Tiled Neural Network Computations", MAPL 2019. https://dl.acm.org/doi/10.1145/3315508.3329973
- T. Dao et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness", NeurIPS 2022 — online-softmax reordering as the contrast case for exact fusion.
- J. Demmel, Y. Hida, "Accurate and Efficient Floating Point Summation" (2004) — compensated/cascade summation with input-size-independent error bounds.

## 4. Design document written (2026-11-26)

The design document `design-doc/01-best-in-class-for-tix-trustworthy-speed.md` (~4,900 words)
defines best in class as **trustworthy speed** (bit-exact or certified transformations,
performance near vendor libraries, checks that run at deployment shapes) and ranks three
proposals: (1) meaning-preserving tiling and fusion as checked passes, with the order-
sensitivity classification derived from the IR's free-vs-fold binder distinction; (2) certified
error budgets replacing sampled tolerance for reassociation, with magnitude-aware budgets;
(3) the deployment-scale f64 oracle. Staged plan: see-the-truth first, then tile, then fuse,
then certificates, then autotuning. "What did not work" records the 12 ms fused-exact softmax
(serial transcendental in the fold chain), the 1.08x first tiling, the harness index-decode bug,
the oracle literal-fidelity bug, and the non-transferability of sampled gate evidence.

Ticket marked complete; changelog and index updated. Commits 8bfb23a, 438db80, e21dfd0.
