---
Title: Research diary
Ticket: IRWB-023-C
Status: active
Topics:
    - compiler
    - research
    - performance
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: ttmp/2026/11/26/IRWB-023-C--best-in-class-tix-exact-meaning-performance-research/scripts/01-exact-gemm/main.cu
      Note: Exact tiled GEMM, cuBLAS via dlopen, batch invariance and sample-shape bugs
    - Path: ttmp/2026/11/26/IRWB-023-C--best-in-class-tix-exact-meaning-performance-research/scripts/02-exact-exp/main.cu
      Note: Fast exact exp and its exhaustive 2^32 check
    - Path: ttmp/2026/11/26/IRWB-023-C--best-in-class-tix-exact-meaning-performance-research/scripts/03-fused-exact.mjs
      Note: Fused row kernels checked against the unmodified Stage 2 translation units
ExternalSources: []
Summary: Chronological record of the IRWB-023-C research round, including experiments that failed.
LastUpdated: 2026-11-26T18:50:00-05:00
WhatFor: Reproducing and reviewing the evidence behind the IRWB-023-C design
WhenToUse: Read before re-running an experiment or extending a proposal
---

# Research diary

## Step 1: Orientation, ticket and the working thesis

I read the Stage 1 (IRWB-020-B) and Stage 2 (IRWB-022-I) designs and final reports, then the Tix code in `src/tensor/` (model, evaluator, passes, contract, CUDA emitter, CUDA contract and runtime). I created ticket IRWB-023-C with docmgr, a design document and this diary. The outcome of the reading is a working thesis: Tix's distinguishing asset is that its f32 meaning fixes every rounding site and every fold order, so "best in class" should mean *the fastest code that is bit-identical to a portable specification*, not the fastest code full stop.

### Prompt Context
**User prompt (verbatim):** "You are a research agent in a comparison of agent configurations. Your working directory is the git worktree /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-op-irwb-023-c (branch r2-op/irwb-023-c). Run every command there, using absolute paths, and commit on that branch only. Your complete brief is the file /tmp/claude-1000/-home-manuel-code-wesen-2026-11-24--compiler-workbench/6d4ded76-01c1-42ed-bd4c-3f506f14dfc9/scratchpad/claude-briefs/r2-IRWB-023-C.md. Read it now and follow it exactly, including its standing instructions: work only from your worktree, the web and the GPU machine; do not read other worktrees, other branches, or the parent repository's working tree; do not read anything else in the scratchpad directory. Use your docmgr and diary skills for the ticket and the diary. Work through the whole brief before you stop: research, experiments, the design document, the diary, and the commits. Your final message is the one the brief specifies."
**Assistant interpretation:** A research round (no product-code changes): define best in class for Tix, propose ranked compiler work, and back it with literature and GB10 experiments, in a docmgr ticket with a design document, a diary and `IRWB-023-C:` commits.
**Inferred user intent:** Find ideas that only make sense because of Tix's exact f32 meaning, index notation and checked passes, and test them, including tests that could refute them.
**Commit (code):** 2a32592 — "IRWB-023-C: create ticket and record first GB10 experiments (exact GEMM, exact exp)"

### What I did
- Read both tickets' design docs and reports, then `src/tensor/{model,evaluate,passes,contract,cuda-source,cuda-contract,cuda-runtime,index}.ts` and the six corpus programs.
- `docmgr ticket create-ticket --ticket IRWB-023-C ...`, `docmgr doc add` for the design doc and this diary.
- Probes: `npm run build` (exit 0) and a device-properties program through `tools/cuda-remote.mjs` (`scripts/00-device`).

### Why
- The meaning (`evaluate.ts`) rounds at every operator and folds `sum` in lexicographic binder order starting at +0. Every Stage 2 kernel reproduces that per output element. That fact decides which optimizations are free (anything that leaves each element's operation sequence alone) and which are meaning changes.

### What worked
- Device probe: `NVIDIA GB10`, sm 12.1, 48 SMs, 2.418 GHz, 24 MB L2, 99 KB opt-in shared memory per block.

### What didn't work
- No failures in this step.

### What I learned
- The Stage 2 report already recommends switching the lowering relation from the f64 tolerance to f32 word equality. My experiments assume that relation.
- The sample recipe (`contract.ts` `cases`) caps every tensor at 4,096 elements and uses extents 0, 1, 3, 4, 7 and a 3/5/7 mix. No case reaches 8 along a reduced axis.

### What was tricky to build
- N/A (reading only).

### What warrants a second pair of eyes
- N/A.

### What should be done in the future
- N/A.

### Code review instructions
- Start with `src/tensor/evaluate.ts` (the meaning) and `src/tensor/cuda-source.ts` (the per-element loop shape every later experiment is compared to).

### Technical details
- Device JSON: `{"name":"NVIDIA GB10","sm":"12.1","sms":48,"clockKHz":2418000,"memClockKHz":8533000,"busWidth":256,"smemPerBlockOptin":101376,"regsPerSM":65536,"l2":25165824}`.

## Step 2: Experiment 01, how fast an exact GEMM can be, and whether cuBLAS is batch invariant

I wrote `scripts/01-exact-gemm/main.cu`, which has a naive kernel shaped like Stage 2's output (the oracle), a register-blocked tiled kernel that keeps `__fmul_rn`/`__fadd_rn` and strictly increasing k per output, the same kernel with `fmaf`, a split-K kernel whose chunk size (128) depends only on K, and cuBLAS SGEMM loaded with `dlopen`, since the runner links no libraries. The tiled exact kernels were bit-identical to the naive kernel at every size up to 4096³. cuBLAS differed from the Tix meaning on 93% of words, and it is not batch invariant. Row 0 computed as a 1×N problem differs from row 0 of the M×N problem in 471 of 512 words at 512³.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Measure the price of keeping the meaning exact for the dominant workload.
**Inferred user intent:** Evidence for or against "exact and fast" as a definition of best in class.
**Commit (code):** 2a32592 (scripts and `results/01-exact-gemm-perf.json`)

### What I did
- `node tools/cuda-remote.mjs <ticket>/scripts/01-exact-gemm -- perf 256 512` (untimed, correctness first), then added cuBLAS through `dlopen("libcublas.so.13")`, then `--timed -- perf 512 1024 2048 4096`.
- Timing: CUDA events, one warmup, median of 21 (≤1024), 7 (2048) or 3 (4096) runs.

### Why
- Tiling the free indices i, j changes *which thread* computes an element and *where* operands are staged. It does not change the element's fold order. If that argument is right, the tiled kernel must equal the naive one word for word, at full size, on random data.

### What worked
- `wordsDifferentFromNaive` was 0 for both exact tile shapes at all four sizes (262,144 to 16,777,216 outputs).
- Timed results (ms; TFLOP/s in parentheses):

| size | naive | exact 64-tile | exact 128-tile | fma 64 | exact split-K(128) | cuBLAS |
|---|---|---|---|---|---|---|
| 512³ | 0.250 (1.07) | 0.0617 (4.35) | 0.113 (2.38) | 0.0513 (5.23) | 0.0546 (4.92) | 0.0350 (7.67) |
| 1024³ | 2.047 (1.05) | 0.310 (6.94) | 0.347 (6.18) | 0.244 (8.80) | 0.456 (4.71) | 0.138 (15.61) |
| 2048³ | 17.02 (1.01) | 2.213 (7.76) | 2.038 (8.43) | 1.694 (10.14) | 3.884 (4.42) | 0.992 (17.31) |
| 4096³ | 271.0 (0.51) | 18.55 (7.41) | 15.27 (9.00) | 20.57 (6.68) | 29.64 (4.64) | 7.26 (18.93) |

- Split-K equals its own tree oracle (`naive_chunk`, one thread per output folding 128-element chunks in order) in 0 words at every size and is batch invariant (0 row-0 differences), while differing from the sequential meaning on 93% of words, as a reassociation must.
- cuBLAS row-0 batch-invariance differences: 471/512, 924/1024, 1928/2048, 4014/4096 words.

### What didn't work
- My kernels are not cuBLAS-quality: the fma variant reaches 5.2–10.1 TFLOP/s against cuBLAS's 7.7–18.9, so the exact/cuBLAS ratio mixes the semantic price with an engineering gap. At 4096³ the fma variant was even slower than the exact one (20.6 vs 15.3 ms with 3 runs), which I attribute to code generation and noise rather than semantics. Step 3 separates the two with an instruction-throughput probe.
- A first ulp metric (ordered-integer distance) reported meaningless six-digit "ulps" for outputs near zero; I replaced it with `maxRelDiffFromNaive` scaled by max(1,|r|).

### What I learned
- At 4096³ cuBLAS and my sequential-k fma kernel differ from the meaning in exactly the same number of words (15,283,973) and have the same max relative difference (3.59e-5). This is suggestive but unproven: I did not compare cuBLAS to the fma kernel directly.
- The 512³ problem has too few 64×64 tiles (64) for 48 SMs. Split-K would be the vendor answer, and it changes the meaning. A K-only chunk tree keeps batch invariance and is exactly reproducible, so it is a meaning *choice*, not a loss of determinism.

### What was tricky to build
- Tile padding. Zero-filling M and N padding is harmless because padded outputs are never stored. Zero-filling the K tail would fold extra `RN(0*b)` terms. Under the meaning that is still exact *if* the partner is finite and the accumulator can never be −0. A +0-initialized RN sum can only become −0 if both operands are −0, so it never is. Intermediate tensors can hold ±inf, however, and 0×inf is NaN. The kernel therefore uses a shorter K-tail loop instead of padding.

### What warrants a second pair of eyes
- The `dlopen` cuBLAS call uses the column-major trick (C^T = B^T A^T). It is correct for the shapes measured because cuBLAS results agree with the meaning to 3.6e-5 relative.

### What should be done in the future
- Compare cuBLAS to the sequential-fma kernel directly at each size (done in Step 6).

### Code review instructions
- `scripts/01-exact-gemm/main.cu`: `tiled<...>` (exact path lines with `__fadd_rn(acc, __fmul_rn(a, b))`), `perf()`, `results/01-exact-gemm-perf.json`.

### Technical details
- Tile configs: `<128,128,8,8,8>` and `<64,64,8,4,4>`, 256 threads, `As[BK][BM]`, `Bs[BK][BN]`.

## Step 3: Experiment 02, a fast exp that is proven equal to the meaning on all 2^32 inputs

Stage 2 implements `exp` as `__double2float_rn(exp((double)x))`. The GB10 runs FP64 at 0.386 TFLOP/s, against 26.98 TFLOP/s for FP32 FFMA (a 70:1 ratio), so this exact exp runs at 92 GB/s in a streaming kernel, well short of the 244 GB/s the memory system delivers. I wrote a float-float exp in f32 arithmetic only: a 64-entry table, Cody–Waite reduction with an exact FMA step and a degree-5 polynomial. A Ziv-style rounding test returns a result only when the rounding is determined, and the lane otherwise falls back to the double routine. All 2^32 inputs were checked on the GPU in 0.59 s. There were 0 mismatches, and the rounding test was undecided on 200,354 in-range inputs. Streaming throughput rose to 218 GB/s with 0 words changed.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Find an optimization whose correctness can be *proved* rather than sampled, using the GPU as the prover.
**Inferred user intent:** Ideas exploiting "an exactly specified f32 meaning" plus "a GPU for experiments".
**Commit (code):** 2a32592 and the commit after Step 4 (bound sweep results)

### What I did
- `scripts/02-exact-exp/main.cu`: modes `peak`, `exhaust [b]`, `stream`.
- Computed constants with Node: `Math.fround(Math.LN2/64) = 0.0108304247260093688965`, low part `-2.97602221e-11`.
- Runs (all `--timed`): `exhaust`, `peak`, `stream`, then `exhaust b` for b = 38, 40, 42, 44, 52, 64 to test the bound's role.

### Why
- Unary f32 functions are the one place where a meaning check can be exhaustive: 2^32 inputs is a few seconds of GPU time. Equality on every input is a proof for that compiled binary, not a sample.

### What worked
- `exhaust` (bound 2^-36): `{"mismatches":0,"fallbacks":2057572002,"inRangeRoundingTestFallbacks":200354,"ms":592.0}`. Most fallbacks are the out-of-range words (NaN, |x| beyond the normal-result range). Within range the test is undecided about once in 11,000 inputs.
- `peak`: FFMA 26.98 TFLOP/s, FMUL+FADD 14.39 (53%), DFMA 0.386.
- `stream` (2^26 softmax-like arguments in [-12, 0]): double exp 5.83 ms (92 GB/s); fast exact 2.47 ms (218 GB/s, 0 words different); `expf` 2.17 ms (20,444,397 words different); `__expf` 2.15 ms (50,286,309 different).

### What didn't work
- My first low constant (`-2.98161650e-11`) was wrong. I caught it by computing it in Node before the first run. With the wrong constant, the exhaustive check would have reported the error as fallbacks or mismatches.
- Bound sweep (the refutation test): 2^-38 is still sound (0 mismatches, 49,964 fallbacks), while 2^-40 gives 66 mismatches, 2^-42 gives 705, 2^-44 gives 861, and 2^-52 and 2^-64 give 882. The first failing word at 2^-52 is `0x33800000` (2^-24), where exp lies just above the midpoint between 1 and 1+2^-23. My a-priori error estimate (≈2^-38) was right within a factor of four. The default 2^-36 has a 4× margin.

### What I learned
- The exactness of a fast path is a property of the compiled binary and its error bound, and exhaustive enumeration separates a sound bound from an unsound one without an error proof. The 882 failures show that a fast path without the test is not exact, even though it is more accurate than `expf`.

### What was tricky to build
- `r1 = fma(-n, L_HI, x)` must be exact. `n·L_HI` is a multiple of 2^-30, and for |x| ≥ 2^-8 (where n can be nonzero) x is a multiple of 2^-31. The difference is below 2^-7, so it fits in 24 bits. For |x| < 2^-8, n = 0.
- The rounding test uses monotonicity of RN: if RN(lower) == RN(upper) for an interval that contains the true value, the result is determined. Computing `ph + (pl ± E)` adds one rounding of `pl ± E`, which is covered by doubling E.

### What warrants a second pair of eyes
- The proof is for this binary on this GPU with `nvcc -O3 -arch=sm_121` (no fast-math). A different compiler version must re-run `exhaust` (0.6 s).

### What should be done in the future
- The same treatment for `tanh` (GELU) and `log`.

### Code review instructions
- `fast_exp_try` in `scripts/02-exact-exp/main.cu`; results in `scripts/results/02-exact-exp-*.json`.

### Technical details
- Reference: `__double2float_rn(exp((double)x))`, NaN compared as a class, everything else by word.

## Step 4: Experiment 01 shapes, why the current sample recipe cannot check a tiled kernel

I added two deliberate bugs to the tiled kernel. `pair` adds products in pairs inside full K tiles only, a common ILP rewrite that reassociates. `rowstride` uses BN instead of BM as the block-row stride, a copy-paste bug that matters only when BM ≠ BN and M > BM. I ran both at the Stage 1/2 recipe shapes and at tile-aware shapes. At the recipe shapes both bugs were invisible to the exact relation and to the tolerance. At tile-aware shapes the exact relation caught `pair` whenever K ≥ 8, and the tolerance never caught it at any shape.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Test whether the current checking would protect an optimizing backend.
**Inferred user intent:** Claims tested by experiments that could refute them.
**Commit (code):** commit after this step

### What I did
- `node tools/cuda-remote.mjs <ticket>/scripts/01-exact-gemm -- shapes` with tile `<64,128,8,4,8>`; outputs NaN-filled before each variant so unwritten rows cannot look correct.

### What worked
- Recipe shapes (1,3,4,7, 5/3/7 mix, zero extents): `pair` 0/0 and `rowstride` 0/0 (exact mismatches / tolerance failures).
- `cap-64` (64³, the largest square case the 4,096-element cap admits): `pair` 3,347 exact mismatches, 0 tolerance failures; `rowstride` invisible (M = BM).
- Tile-aware (65,9,129), (63,8,127), (64,16,128), (129,17,257): `pair` caught by exact every time (3,395–18,761 words), tolerance never (worst budget fraction 0.15). `rowstride` caught by both when M > 64 (129 and 16,448 failures).

### What didn't work
- My first `rowstride` run would have compared against a buffer still holding the previous variant's correct output. The NaN fill fixed that before any result was recorded.

### What I learned
- A sample recipe has to be derived from the schedule: at least one extent at T−1, T and T+1 per tiled axis, and more than T along a reduced axis. Under the 4,096-element cap a 2-D tensor cannot have two extents above 64.
- Tolerance cannot police reassociation: the pair bug is a legal-looking meaning change within 15% of the budget.

### What should be done in the future
- Full-size exact checks on the GPU against the naive kernel (Step 2 already does this at 512–4096).

### Code review instructions
- `shape_case()` and `main()` in `scripts/01-exact-gemm/main.cu`; `scripts/results/01-exact-gemm-shapes.json`.

## Step 5: Experiment 03, fused exact kernels against the unmodified Stage 2 code

A Node generator (`scripts/03-fused-exact.mjs`) builds one translation unit from three sources. The first is the unmodified Stage 2 output of `cudaSource()` for softmax, layernorm and attention, each in its own namespace, with its `run_case` driven through `fmemopen`/`open_memstream`. The second is the fast exp, copied verbatim from experiment 02. The third is my fused kernels. All fused kernels were bit-identical to Stage 2: softmax 4.63× faster, layernorm 2.89× and attention 7.44×.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Check that fusion plus exactly associative max trees plus the exact exp keep the meaning at full size, and measure the gain.
**Inferred user intent:** Show what an exact-meaning optimizer could reach on the corpus.
**Commit (code):** commit after this step

### What I did
- Fused row kernels: one block per row. Max is a tree of the Stage 2 `minmax` joins, `exp` is double or fast, `sum` is folded in order by one thread from shared memory, and the pointwise epilogue is written once.
- Attention: first a single fused kernel (one block per query row), then four rows per block with staged tiles, then three kernels (transpose of k, the experiment-01 exact GEMM for scores, a row kernel, the exact GEMM for weight × v).
- Timed run: `node <ticket>/scripts/03-fused-exact.mjs --timed`.

### What worked (timed, `results/03-fused-exact.jsonl`)

| program | Stage 2 (run_case, median of 3) | fused, double exp | fused, fast exp | words different |
|---|---|---|---|---|
| softmax 4096×1024 | 0.794 ms | 0.353 ms | 0.171 ms (196 GB/s) | 0 / 0 |
| layernorm 4096×1024 | 0.474 ms | 0.164 ms | — | 0 |
| attention, one fused kernel | 1.045 ms | 0.777 ms | 0.721 ms | 0 / 0 |
| attention, three kernels | 1.045 ms | 0.188 ms | 0.141 ms | 0 / 0 |

### What didn't work
- The single fused attention kernel was *slower* than Stage 2 at first (1.69 ms). Removing a runtime 64-bit division from the tile loads gave 1.49 ms, four rows per block with staged K and V tiles gave 0.96 ms, and unrolling gave 0.72 ms. A phase probe showed the score phase alone took 0.475 ms (0.28 TFLOP/s). A thread-per-score loop is latency-bound, and fusing it with the softmax did not repair that. Reusing the register-blocked GEMM for the score and value contractions, with only the 4 MB score matrix in global memory, was the version that worked.
- The first three-kernel version differed in all 65,536 output words: the transpose kernel indexed with `t % R` instead of `t % C`. Word comparison flagged it at once. The fix restored 0 differences.

### What I learned
- In softmax, half of the gain comes from the exp. The fused kernel with the double exp is limited to 0.353 ms by FP64, and the fast exp halves that.
- The sequential row sum by one thread is not the bottleneck at these sizes: the softmax fused kernel reaches 196 GB/s (80% of the streaming kernel).
- Fusion granularity matters more than fusion itself: the profitable attention is "GEMM, row kernel, GEMM", not one kernel.

### What was tricky to build
- Reusing Stage 2 code verbatim. Each translation unit defines the same helper names, so each is wrapped in a namespace with its `#include` lines hoisted, and `int main` is cut off. `run_case` reads and writes `FILE*`, so the harness feeds it in-memory streams.

### What warrants a second pair of eyes
- The exactness argument for the max tree: `minmax` returns canonical NaN if either operand is NaN, the bitwise AND of equal-comparing words for max (so +0 wins over −0) and otherwise the larger. That is a join on a semilattice, so any bracketing gives the same word. The experiments confirm it on these inputs only.

### Code review instructions
- `scripts/03-fused/fused.cuh` (kernels and harness), `scripts/03-fused-exact.mjs` (generator), `scripts/results/03-fused-exact.jsonl`.

## Step 6: cuBLAS versus a sequential FMA fold, and an exact interpreter reference for FMA

Two questions drove this step. Does cuBLAS compute a fixed function? And could Tix specify an FMA-contracted contraction exactly? I re-ran experiment 01 with a direct comparison of cuBLAS against my sequential-k `fmaf` kernel, and wrote experiment 04, which compares two JavaScript FMA references with the GB10's `__fmaf_rn`. At 4096³, cuBLAS equals the sequential FMA fold in every one of 16,777,216 words. At 512–2048³ it differs from it in 92–96% of words. The exact error-free-transformation (EFT) reference had 0 mismatches. The obvious `Math.fround(a*b + c)` passed every random triple and failed every constructed hard case.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Test whether an FMA meaning is both implementable on the interpreter and worth having.
**Inferred user intent:** Ideas that lift the price of exactness, with refutation tests.
**Commit (code):** be6b4a7 — "IRWB-023-C: FMA meaning reference, cuBLAS vs sequential FMA, tolerance vs accuracy relations"

### What I did
- Added `cublasVsSequentialFma` to `perf()`, then ran `--timed -- perf 512 1024 2048 4096` (`results/01-exact-gemm-perf-run2.json`).
- `scripts/04-fma-meaning.mjs` writes triples to `04-fma-meaning/triples.bin` (a `--runtime-input`), runs `main.cu` remotely, and compares. The triple families are 2^20 random words, 2^18 random normals and 2^16 constructed cases: c odd, a·b = ±h(1 − 2^-46), h = ulp(c)/2.

### What worked
- cuBLAS vs sequential FMA: 242,386/262,144 (512³), 992,461/1,048,576 (1024³), 4,036,086/4,194,304 (2048³) and **0/16,777,216 (4096³)** words different.
- EFT `fma32`: 0 mismatches in all families. Naive: 0, 0 and **65,536/65,536**.

### What didn't work
- None in this step.

### What I learned
- At large sizes cuBLAS's meaning is a sequential FMA fold. An FMA meaning in Tix would therefore be bit-compatible with cuBLAS exactly where cuBLAS runs at full speed.
- Random testing cannot validate a reference for a fused operation: the double-rounding cases occur with probability about 2^-29.

### What was tricky to build
- The midpoint argument. f32 midpoints are representable in f64, so a sum s that is not a midpoint is at least an f64 ulp away from one, while |e| ≤ ulp64(s)/2. Only an exact midpoint needs the sign of e. Overflow at the 2^128 − 2^103 midpoint is handled separately.

### Code review instructions
- `fma32()` in `scripts/04-fma-meaning.mjs`; `results/04-fma-meaning.json`.

## Step 7: Experiment 05, the tolerance is not scale covariant

I drove the real Stage 1 gate (`meaningGate(origin, 'tolerance')`) with an all-zero candidate on `y[i] = sum(k) x[i,k] * S`, and evaluated three relations offline on the six corpus programs. The relations are the Stage 1/2 tolerance, an elementwise accuracy relation and a per-case norm accuracy relation. Each was applied to split-sum, the Stage 1 floor-split mutant and all zeros, at the gate's cases plus one large case per program, unscaled and with inputs scaled by 2^-20. The gate accepted zeros for S ≤ 1e-7. The tolerance accepted both bugs on every program with small outputs at scale 2^-20, and rejected split-sum on a 4,093-term matmul. The elementwise relation was refuted. The norm relation with k = 2 separated legitimate from buggy candidates everywhere.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Measure the meaning-change judge that Stage 1 and 2 use, and propose a replacement.
**Inferred user intent:** Strength of correctness guarantees, with experiments that can refute.
**Commit (code):** be6b4a7

### What I did
- `node <ticket>/scripts/05-accuracy-relation.mjs` (Node 24, imports from `dist/`); `results/05-accuracy-relation.jsonl`.

### What worked
- Part A: zero candidate rejected at S = 1e-3, 1e-5, 2e-6; **accepted** at 1e-7 and 1e-9.
- Part B: the norm relation `max|C−R| ≤ 2(max|O−R| + ulp32(max|R|)/2)` accepted split-sum everywhere (max ratio 0.95) and rejected the floor mutant wherever it changed the output and zeros everywhere, at both scales.

### What didn't work
- The first relation I tried, elementwise `|C−R| ≤ 8(|O−R| + ulp32(R))`, falsely rejected split-sum on matmul (max ratio 12.6) and layernorm (127). It is refuted: where the origin happens to be very accurate at one element, any change looks unboundedly worse there.
- My first minimum-ratio statistic for mutants was meaningless (0 for the zeros candidate on the all-zero stream, where zeros is correct). A candidate is rejected if *any* case fails, so I report the number of failing cases instead.

### What I learned
- The absolute term 2e-6 makes the Stage 1/2 tolerance vacuous for small-magnitude programs, and the relative term makes it too strict for long reductions with cancellation.

### Code review instructions
- `scripts/05-accuracy-relation.mjs`, `floorMutant()` and the loop computing `normFail`.

## Step 8: Experiment 06, fingerprints of the same kernel source

I rewrote the experiment-01 kernels generically in their scalar type and instantiated them at `Sym`. In `Sym` a load is a hash of (tensor, index), `mul`/`add` are commutative hash combiners, and a "may be −0" bit carries the +0-identity law. Fingerprints of the exact tiled and split-K kernels matched their oracles at all six shapes. The `pair` mutant was caught at every shape with K ≥ 8, including on small-integer and all-zero data, where the numerical comparison saw 0 differences.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Find out what the compiler can *prove* about an exact schedule beyond sampled data.
**Inferred user intent:** Stronger guarantees, specific to Tix.
**Commit (code):** 83a921c — "IRWB-023-C: symbolic fingerprints decide per-shape exactness for all data"

### What I did
- `node tools/cuda-remote.mjs <ticket>/scripts/06-fingerprint` (untimed; a check, not a measurement); `results/06-fingerprint.json`.

### What didn't work
- The first fingerprint algebra had only commutativity. It flagged the K-only chunk tree as different from the sequential fold when K ≤ 128 (49/49 at 7³), although the words are equal: RN(+0 + s) = s for any fold value s. Adding the law with a "may be −0" bit removed the false alarm and kept the genuine difference at K = 300.

### What I learned
- The fingerprint is sound and incomplete by design. Every legal rewrite outside its algebra needs a proved law, and associativity of `+` must never be added.

### Code review instructions
- `struct Sym`, `tadd`, `LAW` in `scripts/06-fingerprint/main.cu`.

## Step 9: Experiment 07, a fast tanh, its first failure, and the fix

The MLP epilogue spent 0.211 ms in Stage 2's double `tanh`, half of the exact MLP's 0.442 ms. I wrote a fast tanh: a series below 2^-6, otherwise 1 − 2/(e^{2|x|} + 1) using the exp core as a float-float, a one-step float-float division and the same rounding test. The first version had **85,400 mismatches** over all 2^32 inputs. The fixed version has 0, runs 4.9× faster than the double path in streaming, and brings the MLP to 0.270 ms.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Extend Proposal 2 to the second transcendental in the corpus.
**Inferred user intent:** Depth on one idea, including its failures.
**Commit (code):** e3eb1a0 — "IRWB-023-C: exhaustively checked fast tanh; exact kernels for all six corpus programs"

### What I did
- `scripts/07-exact-tanh/main.cu` with modes `exhaust <series-bits> <exp-bits>`, `stream` and `debug <hexword>`.
- Diagnosis: `debug 3c952178` printed the intermediates at 17 digits, and a 60-digit Decimal computation gave the true values.

### What didn't work
- First exhaustive run: `{"mismatches":85400,"fallbacks":17523292,"firstMismatchWord":"0x3c952178"}`. My attempt to loosen the bounds appeared to change nothing, because zsh does not word-split unquoted `$b`, so `exhaust $b` with `b="30 30"` passed a single argument. With separate arguments, (30, 30) and (34, 26) gave 0 mismatches, which showed that the exp-path bound was the problem.
- Root cause: `exp_ff` returns an *unnormalized* float-float whose low word holds the whole polynomial tail (7.97e-6 at x = 0.018). The division correction q2 = (2 − q1·D)/dh assumes dl ≪ ulp(dh). With dl/dh ≈ 3.9e-6 it carried a relative error of about 3.9e-6 on q2 ≈ 3.8e-6, about 1.5e-11 in t. That is just above the bound of 1.48e-11. The exp result itself was accurate (relative error 3.8e-13).
- Fix: renormalize D = exp + 1 with a second Fast2Sum. After the fix: (34, 36) gave 0 mismatches and 17,523,060 fallbacks, of which 16,777,214 are NaN words. (34, 38) and (36, 38) gave 0; (34, 40) gave 6.

### What I learned
- An exhaustive check can find an algorithm bug that a careful error analysis missed, and debugging it took one high-precision replay of the first failing word.
- Exp's exhaustive pass did not prove exp_ff's float-float accurate. It proved only that the *rounded* results are right. Reusing an intermediate in another function needs its own proof.

### Technical details
- Streaming, 2^24 arguments in [−3, 3]: double 3.30 ms, fast 0.668 ms (0 words different), `tanhf` 0.544 ms (3,397,679 different).

## Step 10: Exact kernels for all six corpus programs

I extended the experiment-03 generator to all six programs. It now copies the experiment-01 GEMM and the experiment-07 tanh verbatim (by markers), and the MLP and conv2d schedules are new. MLP is GEMM, fused bias+GELU, GEMM, then bias. conv2d is an implicit GEMM with k = (c·3 + dy)·3 + dx. All six were bit-identical to the Stage 2 output at full size. Speedups: matmul 3.50×, softmax 4.73×, layernorm 2.90×, attention 7.56×, mlp 3.93×, conv2d 1.98×; geometric mean 3.76×, and 3.763 ms total became 0.887 ms.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Corpus-wide evidence for Proposal 1.
**Inferred user intent:** Claims backed by experiments at realistic sizes.
**Commit (code):** e3eb1a0

### What didn't work
- The first conv2d version took 0.110 ms (1.50×), because it decomposed the pixel index with runtime integer division for every tile element. Hoisting the decomposition out of the k loop gave 0.083 ms.

### Code review instructions
- `node <ticket>/scripts/03-fused-exact.mjs --timed`; `results/03-fused-exact.jsonl`.

## Step 11: Literature check and the design document

I checked each citation with web searches or by fetching the source page. Three details changed as a result. The Halide reductions paper's DOI could not be confirmed, so it is cited by its researchr record. Ziv's TOMS DOI could not be confirmed, so it is cited by its index record. The Thinking Machines post is cited from the page itself, including its about 20% matmul cost relative to cuBLAS and its fixed-split-size rule for split-KV. Then I wrote the design document: the definition of best in class, the exact ceiling, four ranked proposals with theory, novelty, evidence, risks, success measures and framework needs, a staged plan, failures and the experiment index.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Commit (code):** 73bcfe8 — "IRWB-023-C: design document - exact-meaning performance, four ranked proposals"

### What warrants a second pair of eyes
- The ranking. Proposal 3 (fingerprints) is arguably the most novel, but it enables Proposal 1 rather than delivering speed, so it is ranked third.
- The norm relation's k = 2 is fitted to six programs.
