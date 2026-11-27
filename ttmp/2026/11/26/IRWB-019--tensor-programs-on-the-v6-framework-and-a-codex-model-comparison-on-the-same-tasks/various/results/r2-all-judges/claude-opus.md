# Judgement of the eleven R2 research designs

Method. I read the brief, the rubric and all eleven tickets before scoring (each ticket's design document, diary, and the scripts and result files its claims rest on). I also ran targeted prior-art searches for the novelty claims (symbolic fingerprints, INT8 exact folds, reference-fitted intrinsics, parallel sequential sums, bit-exact scheduling). One finding applies to five documents: Yang, Riasanovsky, Deng and Sarkar, arXiv 2609.11356 (Sep 2026), already restricts GPU kernel autotuning to a single bitwise-equivalence class with sound static checkers. docs A, C, D, E and J claim versions of that idea without citing it.

I checked the repository claims against the base worktree (`src/tensor/*.ts`, `src/framework/contracts/differential.ts`, the Stage 1 and Stage 2 reports). I checked 5–13 citations per document on the web (DOI and arXiv resolution through Crossref and arXiv, publisher and documentation pages, quotes against the source). I checked at least three technical claims per document. I re-ran these local scripts from a copy outside the pack, against the base worktree's `dist/`: doc-A `05-accuracy-relation.mjs`, doc-B `02-contract-audit.mjs`, doc-E `08-correctly-rounded.mjs`, doc-F `01-certified-bounds.mjs`, doc-G `05-dyadic-domain.mjs`, doc-I `03-miniature.mjs` and doc-K `05-normal-form-proof.mjs`. Each reproduced the numbers its document reports.

Two facts about the base repository matter for several scores:
- the CUDA lowering gate compares against the f64 evaluator with the tolerance `2e-6 + 2e-5|r|` (`cuda-contract.ts`), on cases with extents from {0, 1, 3, 4, 7, mixed 3/5/7} and at most 4,096 elements per tensor (`contract.ts`);
- the mixed assignment gives 3, 5, 7 cyclically in sorted symbol order, so `D = O` in mlp, `D = V` in attention, and `C = O` and `H = W` in conv2d in every case. Only doc-K noticed this.

Quotes for scores below 6 are in each object's `low_score_quotes`. Padding is the one score where lower is better; it has a quote in every object.

```json
[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 9,
      "creativity": 8,
      "scientific_depth": 9,
      "evidence": 9,
      "correctness": 8,
      "grounding": 9,
      "padding": 3,
      "overall": 9
    },
    "low_score_quotes": {
      "padding": "(score 3, low padding) The length is long but nearly all of it is measured: \"The planner's geometric mean over the five programs is 3.19×, against 4.27× for the hand-written kernels on the same five.\" The only generic stretch is the four-definition survey in §2.1."
    },
    "best_ideas": [
      "Data-universal exactness by running the same kernel source at a symbolic scalar type, with an algebra that holds only the laws IEEE words obey, and a residue-complete shape recipe found by refuting its own first recipe: \"The *same kernel source* is compiled at a symbolic scalar type whose loads are hashes and whose arithmetic hashes the expression tree modulo the laws IEEE rounding obeys.\"",
      "Fast exp and tanh paths proved equal to the language meaning (fround of the JS double routine, not the real function) by enumerating all 2^32 inputs; a bound sweep finds the unsound bound and the enumeration catches an algorithm bug: \"The proof obligation is equality with `fround` of JavaScript's double routine, a function that can differ from the correctly rounded one.\"",
      "Batch invariance as a theorem of the meaning, measured against cuBLAS, plus an exactly specified FMA-fold meaning with an exact JS reference (the naive one is refuted on constructed midpoints): \"cuBLAS's own 4096³ result equals a sequential FMA fold word for word.\""
    ],
    "novelty_check": [
      "Symbolic fingerprints. The document says \"I have not seen it for tensor compilers.\" It misses close prior art: Yang, Riasanovsky, Deng and Sarkar, \"Taming Bitwise Behavior in GPU Kernels with Tensor Core: Black-Box Reconstruction, Compiler Enforcement, and Static Verification\", arXiv 2609.11356 (Sep 2026), builds sound static checkers for bitwise equivalence of compiled GPU kernels (PTX/GCN) and restricts Triton autotuning to one bit-equivalence class. KLEE-FP/KLEE-CL (Collingbourne, Cadar and Kelly, EuroSys 2011 and TSE 2014) crosscheck exact IEEE equivalence symbolically, and random interpretation (Gulwani and Necula, POPL 2003/2004) is the theoretical ancestor. Instantiating the kernel's own template source at a hashing type is still new, but the claim needed these citations.",
      "Inert autotuning (\"autotuning semantically inert\"). Yang et al. 2026 (above) already restricts autotuning to a single bit-equivalence class.",
      "Exhaustively proved intrinsics. Prior art is CORE-MATH and RLIBM-32, both cited and acknowledged. Targeting the language meaning (fround of V8's exp) instead of the correctly rounded value is new in context.",
      "Batch invariance. He / Thinking Machines (2025) and LLM-42 (2026) are cited and verified. The claim is that it follows from the semantics, which holds.",
      "cuBLAS at 4096³ equals an in-order FMA fold. doc-K replicated this independently; I found no published prior observation.",
      "Scale-covariant accuracy relation. This is close to normwise relative error (Higham 2002). Using the origin's exact f32 error as the yardstick is new here."
    ],
    "errors": [
      "\"CORE-MATH proves binary32 functions correct on all inputs [Sibidanov 2022]\" — CORE-MATH checks univariate binary32 functions by exhaustive search, which is testing, not a proof. The ARITH 2022 paper does not claim a proof (minor).",
      "\"Emulation of FMA and Correctly Rounded Sums\" — the title is \"Emulation of a FMA and Correctly Rounded Sums: Proved Algorithms Using Rounding to Odd\" (trivial).",
      "\"The specific combination is to reuse the *very kernel source* at a symbolic scalar type ... I have not seen it for tensor compilers.\" — the novelty claim misses Yang et al., arXiv 2609.11356 (2026), and KLEE-FP/KLEE-CL (2011/2014), which check bitwise floating-point equivalence of GPU and SIMD kernels."
    ],
    "would_fund": "Proposal 1, exact-meaning scheduling with the planner. It delivered bit-identical kernels 2.0–7.6× faster on all six programs, and the planner already generates 3.19× from the IR. It needs only a schedule artifact and an f32 word comparator, both of which the document locates precisely in the existing framework.",
    "notes": "This is the most complete document in the pack. Every proposal is backed by GPU experiments that could have refuted it, several did refute first versions, and the definition (fastest code bit-identical to a portable meaning) is well argued and measured against its own ceiling. Most of the 2^32, cuBLAS-comparison and corpus-wide results reproduce from the stored results, and the local accuracy-relation script reproduced exactly."
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 4,
      "creativity": 4,
      "scientific_depth": 3,
      "evidence": 4,
      "correctness": 1,
      "grounding": 4,
      "padding": 5,
      "overall": 3
    },
    "low_score_quotes": {
      "ingenuity": "The one non-obvious mechanism, a certificate that is itself a Tix program, was not run: \"The experiment I did **not** get to run in this round is the shadow program itself at corpus size\". The rest is the standard menu: \"Give each reduction a *semantics tag*: `ordered` (today's behaviour), `tree` (a declared shape of tree), or `exact`\".",
      "creativity": "\"Split each f32 operand into 2–3 TF32 pieces (the Ozaki scheme) ... accumulate with integer or TF32 tensor cores, and declare the resulting bound\" — the ML-compiler and numerics playbook, with nothing new said about it here.",
      "scientific_depth": "\"a compensated (Neumaier/Kahan-Babuška) or expansion-based sum achieves it with a small constant factor and full parallelism\" — the theory offered for the central reduction proposal is wrong (see errors), and bounds are quoted without derivation.",
      "evidence": "P5: \"Evidence. None of my own yet\"; P2's prototype was not run; and an unexplained mismatch is left as possible compiler misbehaviour: \"Either the kernel has a load/layout error I did not find or the compiler is doing something\".",
      "correctness": "Ten citations have wrong or dead identifiers or authors, and at least eight technical claims are wrong; see errors.",
      "grounding": "The plan's order rests on a false premise: \"the softmax fusion (2–5×) is *illegal* today (the fold order changes), so it cannot come before P3\".",
      "padding": "(score 5) The guarantee-axis table, the order-free-sum survey and the tensor-core section restate standard material: \"This is the reproducible-BLAS line of work: Demmel & Nguyen ...; Chohra, Langlois & Parés, ExBLAS; Neal ...; Collange et al.\""
    },
    "best_ideas": [
      "Feeding a textually relaxed version of the real emitted CUDA to the real lowering contract, to show it accepts both an `__expf` substitution and a contraction that exceeds its own budget at full size: \"Every fast variant was accepted by the merged contract.\"",
      "Showing the correct f32 meaning violates the contract's fixed budget at corpus size: \"worst budget fraction of the correct f32 matmul | **4.36**\"; the audit script reproduces the related 106,743% ill-conditioned case.",
      "A certificate that is a Tix program compiled by the same compiler (abs-shadow): \"the certificate is a program the compiler compiles\" (proposed, not run)."
    ],
    "novelty_check": [
      "Abs-shadow program. Running error bounds computed alongside the computation are classical (Wilkinson; Higham 2002 §3.3). Expressing the bound as a Tix program is a small new twist, unrun.",
      "Order-free reduction tag. This is ReproBLAS and binned summation (Demmel and Nguyen 2013 and 2015, cited); not new.",
      "Deciding the addressing fragment. This is Presburger arithmetic and the Omega test (cited); the residue-cover observation is reasonable but standard.",
      "Value/schedule split. Halide's algorithm/schedule separation (Ragan-Kelley 2013) and Exo; not new."
    ],
    "errors": [
      "\"matmul moves 0.4 MB per 512³ operation, so it is compute-bound: 1.34×10⁸ flops into 0.197 ms is 1.7 TFLOP/s, one fifth of cuBLAS\" — a 512³ matmul is 2·512³ = 2.68×10⁸ flops and moves 3 MiB (three 1 MiB matrices). 0.197 ms is 1.36 TFLOP/s, a sixth of cuBLAS.",
      "\"a 49-element tensor suffices for *bit* identity of a schedule ... it is size-insensitive\" — tiled schedules diverge only at extents at or above the tile size. Small cases never reach a tile boundary (doc-A's experiment 08 shows the stage recipe catches none of six tile mutants).",
      "\"An exactly rounded sum ... a compensated (Neumaier/Kahan-Babuška) or expansion-based sum achieves it\" — compensated summation is neither correctly rounded nor order-independent. Only exact accumulators (superaccumulator, Kulisch, binned) are.",
      "\"There is no thread mapping other than 'one thread per output, folding alone' that reproduces the specified bits, and that mapping is the slowest thing on the device\" — a block-per-row schedule that stages the row cooperatively and lets one thread fold it in order is bit-exact and reaches near streaming bandwidth (doc-E 248.6 GB/s, doc-A 82%). B's own sequential row sum already runs at about 146 GB/s.",
      "\"determinism is currently false for every reduction, which means the same program on two machines ... may print different answers\" — Tix's meaning fixes the fold order and the Stage 2 lowering is bit-identical with the interpreter. Only hypothetical reassociating schedules differ.",
      "\"the plain shared-memory tile differs on 262 144 of 262 144 words and I could not explain why ... or the compiler is doing something\" — `probe3/main.cu` loads `B[t * TS + ty * N + col]` instead of `B[(t * TS + ty) * N + col]`. It is an indexing bug in the kernel, not a compiler effect.",
      "\"single-precision `expf`/`logf`/`tanhf`\" and \"Single-precision `expf` differs ... on 5.07% of all 2³² f32 input words\" — the fast lowering and the sweep use `__expf` (`#define fast_exp(x) (__expf(x))`), the hardware approximation, not `expf`.",
      "\"The exactness of arithmetic is nearly free. Multiplication-then-addition versus fused multiply-add costs 1%, not 2×\" — this was measured on a naive, memory- and occupancy-bound kernel. On a compute-bound tiled kernel the FMUL+FADD issue rate is about half of FFMA, and the FMA fold is 1.3–1.45× faster (docs A, E, K).",
      "\"the softmax fusion (2–5×) is *illegal* today (the fold order changes)\" — softmax can be fused with the ordered fold kept, bit-identically (docs A, D, G, I, J).",
      "\"Higham ... https://doi.org/10.1137/1.9781611974159\" — that DOI does not resolve. The 2nd edition is 10.1137/1.9780898718027.",
      "\"J. Demmel, Y. Hida ... https://www.netlib.org/lapack/lawnspdf/lawn175.pdf\" — LAWN 175 is Langou et al., \"Exploiting the Performance of 32 bit Floating Point Arithmetic...\" (2006).",
      "\"Collange ... 'Numerical reproducibility for the parallel reduction on GPU', IJHPCA, 2015. https://doi.org/10.1177/1094342015594678\" — the DOI is a PyCOMPSs paper. The real paper is Parallel Computing 49 (2015), DOI 10.1016/j.parco.2015.09.001.",
      "\"K. Ozaki, T. Ogita, S. Oishi, S. Oishi ... https://doi.org/10.1007/s11075-011-9499-9\" — the authors are Ozaki, Ogita, Oishi and Rump. The DOI is Willis's hypergeometric-functions paper; the correct DOI is 10.1007/s11075-011-9478-1.",
      "\"D. Ootomo, R. Yokota, 'Recovering single precision accuracy on tensor cores...', Proc. SC20, 2020. https://arxiv.org/abs/2004.0460\" — the arXiv ID is invalid and there is no SC20 paper. The real paper is \"Recovering single precision accuracy from Tensor Cores while surpassing the FP32 theoretical peak performance\", IJHPCA 2022, arXiv 2203.03341.",
      "\"Henry, Tang, Heinecke, Kwasnick, 'Harnessing numerical flexibility for deep learning on FPGAs', 2019\" — that paper is by Ling et al. (Intel), HEART 2018. Henry, Tang and Heinecke wrote \"Leveraging the bfloat16 Artificial Intelligence Datatype For Higher-Precision Computations\", ARITH 2019.",
      "\"how recent work reaches near-exact FP32 GEMM with INT8 tensor cores (Ootomo et al., 2024)\" — Ootomo, Ozaki and Yokota 2024 emulate DGEMM (FP64), not FP32.",
      "\"R. M. Neal ... https://arxiv.org/abs/1507.08697\" — that ID is a derived-categories paper. Neal's is arXiv 1505.05571, \"Fast exact summation using small and large superaccumulators\".",
      "\"W. Pugh, 'The Omega test...', Comm. ACM 35(8), 1992. https://doi.org/10.1145/135226.135647\" — the DOI does not resolve. CACM 35(8) is \"A practical algorithm for exact array dependence analysis\" (10.1145/135226.135233); the Omega-test title is Supercomputing '91.",
      "\"D. C. Cooper, 'Programs for machine proofs in geometry', 1972\" — Cooper's Presburger paper is \"Theorem Proving in Arithmetic without Multiplication\", Machine Intelligence 7, 1972.",
      "\"A. Ziv ... https://doi.org/10.1145/114697.116805\" — that DOI is Higham's \"Algorithm 694\". Ziv's paper is 10.1145/114697.116813.",
      "\"N. Whitehead, K. Sitch, 'Reproducibility and performance in CUDA', NVIDIA developer blog, 2018\" — no such post or author found. The known source is Whitehead and Fit-Florea, \"Precision & Performance: Floating Point and IEEE 754 Compliance for NVIDIA GPUs\" (2011)."
    ],
    "would_fund": "P1, the schedule layer judged by bit identity. It is the only proposal with a bit-identical measured speedup (1.54–1.85×), and the framework already has the relation it needs.",
    "notes": "The contract audit and the fast-lowering-through-the-real-gate experiment are genuine findings, and the audit reproduces. They are buried under arithmetic slips, an undiagnosed indexing bug, wrong theory and the most citation errors in the pack, and the definition (\"performance per unit of decided semantic guarantee\") is never made operational."
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 5,
      "creativity": 5,
      "scientific_depth": 5,
      "evidence": 5,
      "correctness": 4,
      "grounding": 6,
      "padding": 5,
      "overall": 5
    },
    "low_score_quotes": {
      "ingenuity": "The main mechanism is a certificate that was not built: \"A pass or a lowering returns, beside its candidate, a *schedule certificate*: for every output element, a witness that the emitted computation is the same tree\". Its theory is, in the document's own words, \"shallow — it is determinism\".",
      "creativity": "P3 is the reproducible-summation playbook (\"Long (Kulisch) accumulators ... binned 'reproducible accumulators'\") and P5 is generic verification hygiene (\"Coverage-directed case generation\", \"Check once per (program, profile), then cite\").",
      "scientific_depth": "\"*Proof.* Induction over `T_e` ... The theorem is shallow — it is determinism\"; the price metric is misread as a bound (see errors).",
      "evidence": "\"I measured two of the six corpus programs (matmul, softmax); the layernorm, attention, mlp and conv2d claims are extrapolations from their instruction mix\". No certificate was prototyped, and the transcendental sweep miscounts its domain.",
      "correctness": "Two technical errors (sweep coverage, the 'upper bound' logic), an overclaim about fusion, a wrong claim about Halide, a novelty claim with missed prior art, and two citation-attribution errors; see errors.",
      "padding": "(score 5) §5 P5 and §8 are generic (\"More cases means slower checks, and slow checks get turned off.\")."
    },
    "best_ideas": [
      "A plausible lowering-level defect that the shipped `checkCudaLowering` accepts, because the case domain stops at extent 7: \"`const I end_i2 = ((d1) < 8LL ? (d1) : (d1) - 1LL);` ... sampledVerdictAccepted: true ... worst budget fraction at extent 16: 4018.08\".",
      "Budget consumption of the bit-exact meaning grows with K until the fixed relation rejects the program itself: \"matmul 64×1024×64 | **3.6494**\" — \"a numeric contract that is not scale-indexed certifies a different program from the one that ships\".",
      "A price-of-exactness metric that compares schedules with the same instruction mix, not with cuBLAS: \"price(P,s) = E(P,s) / U(P,s)\"."
    ],
    "novelty_check": [
      "P1 schedule certificate ('What I have not seen anywhere is the combination: a tensor compiler whose schedule space is explicitly restricted to the value-preserving class'). Prior art missed: Yang, Riasanovsky, Deng and Sarkar, arXiv 2609.11356 (Sep 2026), restrict Triton autotuning to one bit-equivalence class with sound static bitwise-equivalence checkers. Clément and Cohen (OOPSLA 2022) validate Halide lowering; Exo and ATL check schedule rewrites, but modulo real arithmetic.",
      "P2 verified transcendental layer ('as far as I know, new in a tensor compiler'). Exhaustive binary32 checking is standard practice (CORE-MATH, RLIBM); doc-A and doc-I did it in this round.",
      "P3 two reduction meanings in one language. RepDL (Xie et al. 2025) offers named fixed orders; ReproBLAS offers order-independent sums. Partly new as a language feature."
    ],
    "errors": [
      "\"I swept 2,147,483,648 f32 input words (a stride-4 traversal of the word space, 506 ms on the GB10)\" — the kernel computes `(U32)(start + i * stride)` for i < 2^31 with stride 4, so the index wraps at 2^32. Only 2^30 distinct words (those ≡ 0 mod 4) were visited, each twice. The reported 8,388,604 NaN inputs equal 2 × 4,194,302, and the 1,262 Ziv failures and other counts are doubled.",
      "\"`E(P,s)` is an *upper bound* on the exact-class optimum, and `price(P,s) ≤ 1.14` is an upper bound on the price of exactness — the true price could be smaller\" — when both E and U are suboptimal, E/U bounds nothing. U also excludes FMA contraction by definition (\"the same instruction mix\"), which other documents measure at 1.3–1.45× on tuned kernels. The true price can be larger.",
      "\"parallelising the only serial construct in the language both buys the only available speed and breaks the meaning\" — a block-per-row schedule that stages the row cooperatively and lets one thread fold it from shared memory keeps the meaning and reaches near streaming bandwidth. The document's own §6.5e names this schedule and did not test it.",
      "\"Dempel/Ahrens/Nguyen, ACM TOMS 2020\" / \"J. Demmel, P. Ahrens, H. D. Nguyen\" — the authors are Willow Ahrens, James Demmel and Hong Diep Nguyen, in that order.",
      "\"also R. Romanova et al., *Hierarchical approach for deriving a reproducible unblocked LU*\" — the paper at the linked PDF is by R. Iakymchuk, S. Graillat, D. Defour and E. S. Quintana-Ortí (IJHPCA 2019).",
      "\"Halide does not know whether its schedules preserve bits\" — Halide's ordinary schedules do not change the algorithm's result. Only `rfactor`/`atomic` (which assume associativity) and non-strict float codegen can, and `strict_float` exists to forbid the latter.",
      "\"What I have not seen anywhere is the *combination*\" — the novelty claim misses Yang et al., arXiv 2609.11356 (2026), which restricts a GPU kernel autotuner to one bitwise-equivalence class using static checkers."
    ],
    "would_fund": "P5.1/5.2, the exact-and-NaN-class lowering relation and coverage-directed cases. It closes the evasion the document demonstrated, at small cost, and it is a prerequisite for trusting the 2.0× tiling result.",
    "notes": "A sound diagnosis of the sampled gate with two good experiments (gate evasion, scale sweep), but the headline proposals (certificate, exact sum mode) are unprototyped and the transcendental sweep is mis-measured. The definition is reasonable; the plan would move Tix modestly."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 4,
      "creativity": 4,
      "scientific_depth": 5,
      "evidence": 6,
      "correctness": 3,
      "grounding": 7,
      "padding": 5,
      "overall": 5
    },
    "low_score_quotes": {
      "ingenuity": "\"`tile-outputs` ... `stage-through-shared` ... `fuse-statements` ... `warp-parallel-max`\" — the usual schedule passes, renamed; the exactness classes are what a competent engineer would list.",
      "creativity": "\"fast-math becomes a family of ordinary checked passes (`contract-fma`, `approx-expf`, `approx-rsqrt`, `warp-tree-sum`); the autotuner is a strategy ...\" — the standard playbook behind a gate.",
      "scientific_depth": "\"this round contributes the *checked-pass integration and measurement*, not a new bound derivation\"; the 'exactness calculus' is a table of one-line arguments.",
      "correctness": "Five wrong or dead citation identifiers or authors and one refutation built on the wrong stream; see errors.",
      "padding": "(score 5) The related-work and alternatives sections list standard systems without new content: \"Full polyhedral scheduling (Tiramisu/Halide-style) — more general than Tix needs\"."
    },
    "best_ideas": [
      "Fusion by replication as an exact rewrite class: \"Tix can fuse the softmax chain of the corpus *bit-identically* because replication is exact and the per-row sums stay sequential\" — measured at 2.0× (softmax) and 2.8× (layernorm), bit-exact.",
      "A working structural certificate for `inline`, comparing trees modulo binder renaming: \"the certificate **holds on the real inline candidate of all six corpus programs in 0.04–0.54 ms** ... **rejects** the identity-order substitution mutant\".",
      "A certified-throughput table that reports each speed next to the relation certified for it: \"for each corpus program, the kernel time together with the numeric relation the compiler *certified* for it\"."
    ],
    "novelty_check": [
      "'A per-operator exactness algebra ... used as the pass-admission criterion' is presented as new. Halide's schedule semantics (Reinking et al. 2022), Exo and ATL check schedule legality, and Halide's rfactor admits only associative reductions (Suriana 2017). Partly new.",
      "Fusion by replication is rematerialization (Halide compute_at and inline recomputation). It is new only in being argued bit-exact here.",
      "'Sound autotuning then falls out.' Yang et al., arXiv 2609.11356 (2026), already restrict Triton autotuning to a single bit-equivalence class.",
      "Proof-carrying schedule rewrites. Translation validation (Pnueli et al. 1998, Necula 2000) and Clément and Cohen 2022 are prior art. The structural matcher is modest."
    ],
    "errors": [
      "\"refuted by E7 on the stream family the checker actually uses ... The real exposure is cancellation inputs (found at K = 3), which the stream family already excludes\" — `03-blind-spot.mjs` tests only the positive half-ULP stream. The checker also draws a signed stream (`2 * random() - 1`), whose long sums cancel, and at K = 512 the exact f32 matmul exceeds the budget on 148–334 of 262,144 outputs (docs B, J). The refutation does not hold.",
      "\"Necula and Lee [(POPL 1998)](https://dl.acm.org/doi/10.1145/276698.276712)\" — that DOI is Grover, \"A framework for fast quantum mechanical algorithms\" (STOC 1998). Necula and Lee's 1998 paper is PLDI 1998 (10.1145/277650.277752); proof-carrying code is POPL 1997.",
      "\"(Necula, PLDI 2000)](https://dl.acm.org/doi/10.1145/349299.349312)\" — the DOI does not resolve; the correct one is 10.1145/349299.349314.",
      "\"(Pnueli and Zuck, 1998)](https://link.springer.com/chapter/10.1007/BFb0028757)\" — that DOI is Couturier and Méry (CAV 1998). TACAS 1998 \"Translation Validation\" is Pnueli, Siegel and Singerman, 10.1007/BFb0054170.",
      "\"(Baghdadi et al., 2019)](https://arxiv.org/abs/1904.03187)\" — that ID is a LIGO white paper. Tiramisu is arXiv 1804.10694 / CGO 2019.",
      "\"Ansor autotuning [(Zheng et al., OSDI 2020)](https://arxiv.org/abs/2002.10967)\" — that ID is a presolar-SiC astronomy paper. Ansor is arXiv 2006.06762.",
      "\"recent work mechanizes FP-optimization validation [(arXiv 2509.09019, 2025)]\" — the paper (Tekriwal and Sarracino) verifies one FMA-contraction rewrite in Rocq/Vellvm; 'FP-optimization validation' overstates it.",
      "\"Halide's schedules are *checked by translation validation after the fact* [(Clément and Cohen, OOPSLA 2022)]\" — Halide does not validate its schedules. Clément and Cohen is a research validator of lowered output against affine specs, using compiler annotations.",
      "\"TF32/FP16 tensor-core paths truncate inputs before the product [(Ootamo and Yokota, IJHPCA 2022)]\" — the author is Ootomo. The paper uses round-to-nearest for input conversion; round-toward-zero is the tensor core's internal accumulation."
    ],
    "would_fund": "Stage A, the schedule tier with replicate/schedule-only/max-reassoc classes. It is the measured 2.0–2.8× bit-exact gain on three programs, and the document maps its framework needs concretely.",
    "notes": "Competent and well grounded engineering. The certificate prototype and the bit-exact fusions are real, but the ideas stay inside the standard playbook. The blind-spot 'refutation' is wrong and the bibliography has five bad identifiers."
  },
  {
    "doc": "doc-E",
    "scores": {
      "ingenuity": 6,
      "creativity": 6,
      "scientific_depth": 7,
      "evidence": 7,
      "correctness": 7,
      "grounding": 7,
      "padding": 4,
      "overall": 6
    },
    "low_score_quotes": {
      "padding": "(score 4) Mostly measured content. Some repetition of the price-list framing across §1, §3.4, §5 P2 and §7: \"So the honest way to describe Tix to a user is not 'fast math on/off' but a *frontier*\"."
    },
    "best_ideas": [
      "Run the real gate with the origin as its own candidate, to separate a rewrite's error from the program's own: \"`|g − r|` is (rewrite-induced change) + (the program's own f32 error); only the first is the rewrite's business\" — leading to \"gate the change, not the total\".",
      "A per-construct price list measured one instruction apart, with an exact BigInt correctly-rounded oracle showing that the order Tix preserves is the least accurate: \"the specified order is correctly rounded in 3 of 60 trials at n=1024 where a tree manages 47 of 60\" (reproduced locally).",
      "Exhaustive enumeration as a toolchain certificate and as a discoverer of exact algebraic identities: \"'which algebraic identities are exact on the whole f32 domain?' is decidable for one-variable identities by enumeration\"; the exp-versus-exp2 forms differ on 1 of 2^32 words."
    ],
    "novelty_check": [
      "Neutral class / trace-neutral schedules ('a *proved* (not stylized) commutation between scheduling and meaning, which is what lets the search be unsupervised'). Halide's algorithm/schedule separation is prior art, as is Yang et al., arXiv 2609.11356 (2026), which restricts autotuning to one bit-equivalence class (missed). Exo and ATL reason modulo real arithmetic. The bit-level argument is modestly new.",
      "Exact-sum meaning (P4). Kulisch accumulators and ReproBLAS (cited); not new.",
      "Translation validation of the emitter (P3). Pnueli 1998 and Necula 2000 (cited, verified); the document says the decomposition is standard.",
      "Delta gating. Related to doc-A's accuracy relation; no prior art found for applying it to sampled pass gates."
    ],
    "errors": [
      "\"25.62 TFLOP/s against a 48-SM part at ~2.08 GHz with 128 FP32 lanes per SM is the expected peak, which validates the microbenchmark\" — the device reports a 2.418 GHz clock (cudaDevAttrClockRate, measured by docs A and D). At that clock the peak is about 29.7 TFLOP/s, so the 2.08 GHz figure is assumed, not measured, and does not validate anything (minor).",
      "\"`x * 0` (fails on the sign for negative x)\" — it also fails for ±inf and NaN, where x·0 is NaN (incomplete).",
      "\"matmul 512³ | 0.197 ms | 0.0953 ms | 2.06× | 0 of 16,384 (at 128³)\" — bit identity was checked at 128³, not at the 512³ size the speedup is reported for. This is disclosed, but the headline table pairs the two.",
      "\"`cudaSource(program, fn)` in `src/tensor/cuda-source.ts`\" — `cudaSource` is exported from `index.ts`; `cuda-source.ts` exports `emitCuda(fn)` (trivial).",
      "\"What is new. Two things. (i) The strength of the separation: a *proved* (not stylized) commutation ... which is what lets the search be unsupervised\" — the novelty claim misses Yang et al., arXiv 2609.11356 (2026), which already restricts GPU autotuning to a bitwise-equivalence class."
    ],
    "would_fund": "P1, the schedule as a checked artifact with an exact comparator. Layernorm reached the memory bound bit-exactly (3.79×) and matmul 2.06×, and the document identifies the cost-model terms (transcendental count, coalescing) that its two refuted fusions exposed.",
    "notes": "Clear theory (materialization and recomputation are trace-neutral), a useful per-construct price list, and honest refutations. The proposals stay close to standard (schedule artifact, translation validation, exact accumulator), and the exact-exp and SASS checks it says matter most were not run."
  },
  {
    "doc": "doc-F",
    "scores": {
      "ingenuity": 6,
      "creativity": 5,
      "scientific_depth": 6,
      "evidence": 7,
      "correctness": 6,
      "grounding": 7,
      "padding": 4,
      "overall": 6
    },
    "low_score_quotes": {
      "creativity": "\"Replace the sampled tolerance for any pass that reorders rounding with a **per-case certified bound** computed by static analysis\" and \"Move the reference evaluation to the GPU\" — the standard round-off-analysis (FPTaylor-style) and GPU-oracle moves, cleanly executed.",
      "padding": "(score 4) Mostly measured content. The related-work paragraphs repeat standard positioning: \"TACO's and Tensor Comprehensions' fusion/codegen machinery ... Triton's tiled execution\"."
    },
    "best_ideas": [
      "Lemma 2, defined-tree evaluation: parallelism enters through the tree a checked pass already declared: \"a schedule that evaluates inner sums concurrently and merges block partials sequentially in block order computes *exactly* the tree's meaning\" — fused softmax (2.1×) and layernorm (4.3×) are bit-identical to the split-sum IR.",
      "A certified difference with an exact semantic term that separates true reassociations from dropped terms: \"certified_diff(x) = e_c(x) + e_o(x) + |Ref_c(x) − Ref_o(x)|\" — 23,648 soundness assertions, 0 violations (reproduced locally).",
      "Bounding against the defined f64 evaluator rather than the reals, and measuring that f64 arithmetic is bit-portable while double transcendentals are not: \"CUDA's `exp`/`tanh`/`log` disagreed with Node's ... at double resolution on **10.3% / 5.8% / 3.2%** of inputs\"."
    ],
    "novelty_check": [
      "Certified budgets as pass evidence. FPTaylor, Daisy and Satire compute rigorous bounds (cited). Using them as stored, replayable pass evidence is a modest integration novelty.",
      "Defined-tree evaluation. I found no prior art phrased this way. It follows directly from split-sum's nested folds, but it is a useful observation.",
      "GPU-resident reference. doc-J independently proposes the same thing; it is standard differential testing at scale."
    ],
    "errors": [
      "\"Stage-2 numbers for the cost being removed: full-size Node f64 evaluation 781 s (matmul), 507–1,285 s for the others\" — Stage 2's 781 s is one call to the f32 interpreter, not f64.",
      "\"FMA contraction — changed **85% of output words for zero measured speedup**\" / \"some of its prizes are empty\" — measured only on a shared-tiled kernel without register blocking, which is latency-bound. FMUL+FADD issues at about half the FFMA rate, and on register-tiled kernels contraction is worth 1.3–1.45× (docs A, E, K).",
      "\"Ragan-Kelley, Barnes, Adams, Paris, Durand, Amarasinghe, 'Halide: Decoupling algorithms from schedules', PLDI 2013 — https://dl.acm.org/doi/10.1145/2491956.2462176\" — the PLDI 2013 paper is \"Halide: a language and compiler for optimizing parallelism, locality, and recomputation in image processing pipelines\". The 'decoupling' title is the CACM 2018 Research Highlight (10.1145/3150211).",
      "\"Herbie ...: Panchekha, Sanchez-Stern, Tatlock, PLDI 2015\" — the in-text author list omits Wilcox, and the frontmatter DOI 10.1145/2813885.2737959 is the SIGPLAN Notices reprint; the PLDI DOI is 10.1145/2737924.2737959 (minor)."
    ],
    "would_fund": "P2 together with the exact-f32 lowering gate. The fused bit-exact kernels and register blocking are measured, and the exact relation is a comparator change the document shows the current lowering already satisfies.",
    "notes": "A careful, reproducible document whose certified-bound analyzer actually runs and is sound on every sampled element, and whose defined-tree lemma is a neat use of the checked split-sum IR. Ideas are mostly standard; the FMA conclusion is overgeneralized."
  },
  {
    "doc": "doc-G",
    "scores": {
      "ingenuity": 8,
      "creativity": 8,
      "scientific_depth": 8,
      "evidence": 8,
      "correctness": 9,
      "grounding": 8,
      "padding": 5,
      "overall": 8
    },
    "low_score_quotes": {
      "padding": "(score 5) Dense, and the evaluation protocol is generic pre-registration advice not tied to an experiment: \"Pre-register the shape grid and mix common with deliberately awkward extents ... Report median and p90 for warmed device time and host-to-host invocation time ...\"."
    },
    "best_ideas": [
      "A conditional exactness theorem that lets integer tensor cores reproduce the ordered f32 fold bit for bit: \"`B <= 2^24`, `e >= -149`, `e + floor(log2(B)) <= 127` ... Every sequential partial sum is exact by induction\" — boundary witnesses reproduce locally, measured on WMMA, and honestly rejected as a speedup when the grid must be scanned fresh.",
      "Row ownership and barriers derived from the index program, with an independent structural verifier, emission from the verified plan, and executable binding: \"derive the ownership and barriers from the index program, then select permission to parallelize at the level of the particular fold\" — 16 mutants rejected, generated kernels 1.98× and 2.48× with every word matching.",
      "An assurance policy grounded in the actual framework: \"The current `assuranceOf` helper maps absent or unrecognized method to `checked-exact`. That default cannot serve as the proof policy\" (verified in `differential.ts`), and a two-board evaluation that separates ordered from application baselines."
    ],
    "novelty_check": [
      "INT8 grid theorem. Ozaki-scheme work (Ozaki et al. 2012; Ootomo, Ozaki, Yokota 2024; Uchino et al. SC'25) and the Abdelfattah et al. analysis are cited or related. Mukunoki et al. (ISC 2020) add reproducible variants on tensor cores. All of these target accuracy or reproducibility, not reproducing a given rounded left fold. A targeted search found no prior art for this use.",
      "Row residency. Triton's fused softmax and layernorm tutorials (cited); the derivation from binder identity is the new part.",
      "Schedule verification. Halide formal semantics (Reinking et al. 2022, quote verified), Li-Liang-Feng TASE 2024, GPUVerify, Alive-FP and VeriTile (pages exist) are all cited and positioned honestly.",
      "Optimistic carries. Kapre and DeHon 2007 (cited, verified); tested and rejected here."
    ],
    "errors": [
      "No substantive errors found. Minor: \"Matrix multiplication's `[i,j]` outputs ... The prototype uses ... eight f32 carries per thread. Full tile guards are explicit. Shape tails ... are the first gaps to fill\" — the exact-tile timing is for full tiles only, so the 3.80× is not yet a general kernel (disclosed)."
    ],
    "would_fund": "Proposal 1 with its proposal-2 checker, the row schedule. It gives 1.98–2.48× full-size gains with every word matching and a sub-millisecond verifier, and it is the smallest checking surface that turns the v6 postcondition into a real proof boundary.",
    "notes": "The strongest framework-grounded document. Every proposal carries a theory, a prototype, mutants and paired GPU timing, and its negatives (INT8 dispatch, optimistic carries, serial-max fusion) are reported as decisions. The prose is dense and sometimes hard to follow, and the plan leaves transcendental cost largely unaddressed."
  },
  {
    "doc": "doc-H",
    "scores": {
      "ingenuity": 4,
      "creativity": 4,
      "scientific_depth": 5,
      "evidence": 5,
      "correctness": 4,
      "grounding": 6,
      "padding": 5,
      "overall": 4
    },
    "low_score_quotes": {
      "ingenuity": "\"classify every candidate transformation by what it can change, put every candidate on the lowest rung it can survive, and make the budget on the tolerance rung a computed quantity\" — a standard exact/budget/certified ladder with Higham bounds.",
      "creativity": "P5: \"No experiment this round reached the tensor cores ... The proposal's honest form is: *defer*\"; P2 is fixed-tree reproducible reduction (Demmel–Nguyen), P3 compensated shadows.",
      "scientific_depth": "\"Kahan compensation captures the exact rounding error of each fold in f32 at ~3 extra flops per term\" — imprecise theory presented as the basis of a 'certificate'.",
      "evidence": "\"expected +1.6% (E1) but unmeasured on the tiled variant\" — the certificate-cost claim was measured only on the latency-bound naive kernel. Fusion was tested only with a reassociating tree, not with an exact fold.",
      "correctness": "Four technical errors, one of them central to the plan; see errors.",
      "padding": "(score 5) The conclusion and the ladder restate §1–§3: \"not the fastest kernels in isolation, but the only tensor compiler whose speed is bought with computed, machine-checked numerical receipts\"."
    },
    "best_ideas": [
      "Showing the sequential meaning itself can violate the fixed tolerance where every blocked order passes, and making the gate record budget consumed by both sides: \"sequential returns exactly 1 on the 1+1023·2⁻⁴ row, burning 6.1e-5 relative error against a 2e-5 budget ... the gate should record budget consumed by origin and candidate, and be able to require improvement\".",
      "Finding that the IR cannot express split widths other than 4, by pushing width-B splits through the real gate: \"widths 2 produced wrong values and widths ≥ 8 produced NaN-reading candidates, and the differential gate rejected every one\".",
      "Certificate kernels that ride in the same launch: \"Emit, alongside the candidate kernel, a **certificate kernel** ... compares |fast − accurate| against the derived budget **per element, on real inputs**\" (cheap on memory-bound kernels: +0.6%)."
    ],
    "novelty_check": [
      "Derived budgets from Higham's γ bounds. This is standard forward error analysis (Higham 2002).",
      "Fixed-tree reductions for determinism. Demmel and Nguyen 2013 and Ahrens et al. 2020 (cited); not new.",
      "Compensated shadow computation as a runtime check. Related to running error analysis and compensated summation (Ogita, Rump and Oishi 2005, cited). Calling it a certificate overstates it."
    ],
    "errors": [
      "\"The gap that remains to cuBLAS (0.033 ms) is *not* reachable on this rung: ... the CUDA-core f32 roof on the GB10 sits near where the register-blocked kernel already is. The next factor must come from tensor cores\" — the coordinator's cuBLAS figure is FP32 without TF32, on CUDA cores (19.2 TFLOP/s at 4096³). The FFMA issue rate is about 26 TFLOP/s and exact FMUL+FADD kernels reach 10+ TFLOP/s (docs A, E). H's 3.1 TFLOP/s is far below the CUDA-core roof.",
      "\"cuBLAS itself now runs 'FP32' GEMMs on Blackwell via BF16x9 tensor-core *emulation* (NVIDIA Developer Blog, 2025)\" — BF16x9 is opt-in (`CUBLAS_COMPUTE_32F_EMULATED_16BFX9` / `CUBLAS_FP32_EMULATED_BF16X9_MATH`) and is supported only on compute capability 10.x (B200/B300), not on the GB10 (sm_121). The default FP32 compute type is unchanged.",
      "\"Kahan compensation captures the exact rounding error of each fold in f32\" — Kahan's Fast2Sum step is exact only when |acc| ≥ |term|. A compensated sum gives a more accurate estimate, not a certified per-input bound on the fast result.",
      "\"yes: block-trees, width-B splits, fusion of sums\" (the ladder puts fusion of sums on the budget rung) and P2's \"fixed shared-memory reduction tree ... not bit-identical to the sequential meaning\" — fusing a sum does not require reassociating it. A staged row folded in order by one thread is bit-exact and reaches the memory bound (doc-E layernorm at 248.6 GB/s, doc-A, doc-G), so P2 spends budget it does not need to."
    ],
    "would_fund": "P1, exact-locality tiling under the exact gate. It is the only bit-exact measured win (2.5× at 512³) and, as the document says, needs nothing from the framework.",
    "notes": "The gate measurements and the extent-width finding are useful, but the plan is built on two wrong premises: that tensor cores are needed past 3 TFLOP/s, and that fusing sums requires a budget. The remaining proposals are textbook."
  },
  {
    "doc": "doc-I",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 9,
      "evidence": 9,
      "correctness": 9,
      "grounding": 7,
      "padding": 5,
      "overall": 7
    },
    "low_score_quotes": {
      "padding": "(score 5) The prose is compressed and repetitive about scope and receipts (\"Changing an inlined instruction, compiler, binary, GPU profile, reference engine or domain invalidates some part of the receipt\"); the definitional section adds a generic scorecard."
    },
    "best_ideas": [
      "Turn the last rounding into a discrete fit: with the polynomial fixed, the admissible binary64 table words for each input form an interval, so a cell is either fitted or refuted by two witnesses: \"If two actual constraints cross, their witnesses refute **every choice of that one coefficient** with the other operations fixed\" — the deployed quadratic matched Node on 2,139,095,041 inputs (digests compared).",
      "Use the IR to restrict the intrinsic's domain: \"For a nonempty row of finite f32 logits, its maximum is a row member. For every column, the exact difference from that maximum is nonpositive ... The relevant scalar domain therefore has roughly half the binary32 encodings\" — this gives exact softmax at 4.25× and 80.6% of matched streaming throughput.",
      "A translation lemma for speculative chunks of the ordered fold, falsified at four-bit precision: \"When d is even, translating a grid value by d steps preserves tie parity\"; mutants without parity, interior or full-path guards fail (reproduced locally: 8,444 strict acceptances, 0 wrong; 7,680 wrong without parity)."
    ],
    "novelty_check": [
      "Coefficient fitting to a reference observation. RLIBM-32 and RLIBM-ALL (Lim and Nagarakatte, PLDI 2021 and POPL 2022) derive rounding intervals from a correctly rounded oracle and solve for coefficients. A targeted search found nobody fitting to a non-correctly-rounded reference engine, or tuning discrete table words with refutation witnesses. Novelty holds.",
      "Domain from the IR. Range analysis for libm specialization exists in general (e.g. Daisy and FPTaylor input ranges). Proving the x − max(x) ≤ 0 domain structurally and certifying by enumeration is new here.",
      "Chunk translation. Kapre and DeHon 2007 is cited and verified; the document explicitly disclaims priority. doc-K's parity transducer is an independent, more general formulation."
    ],
    "errors": [
      "No errors found in the technical claims or citations checked (Tang 1989, RLIBM-32, Exo, Kapre–DeHon, the Demmel–Ahrens–Nguyen tech report, the Triton tutorial's approximate-exp comment, the `assuranceOf` behaviour, the stage-2 mutants passing at widths 32/33, and the exp(−104) < half-subnormal claim)."
    ],
    "would_fund": "Proposal 1, the domain-restricted exp synthesized against the reference and certified by enumeration. It removes the double-precision exp that dominates softmax and attention rows without changing a word, and its receipt design (binary hash, domain partition, digests) is already working.",
    "notes": "The deepest single investigation in the pack, with genuinely new mechanisms and an evidence chain down to SHA-256 receipts against Node. The scope is narrow (softmax and attention rows; contractions are not addressed), so the plan moves Tix less far overall than its depth suggests. The definition (time to a reproducible source answer) is good but deliberately small."
  },
  {
    "doc": "doc-J",
    "scores": {
      "ingenuity": 5,
      "creativity": 4,
      "scientific_depth": 5,
      "evidence": 7,
      "correctness": 5,
      "grounding": 7,
      "padding": 4,
      "overall": 5
    },
    "low_score_quotes": {
      "ingenuity": "\"Add two transformation families ... **Tile** ... **Fuse** ... Both passes are gated **exactly**\" — the usual playbook under an exact gate; the serial-chain rule and the oracle-as-profile observation are the only non-obvious mechanisms.",
      "creativity": "\"Replace the sampled tolerance gate for reassociation passes with a **static certificate** ... the classical forward bounds (Higham 2002)\" — the document itself notes \"Error certificates for floating-point programs are established technology\".",
      "scientific_depth": "The certificate table lists bounds with '≈' and no derivation (\"Kahan / two-sum (Ogita–Rump–Oishi 2005) | ≈ 2·u·S, independent of n\"), and the novelty argument is thin.",
      "correctness": "Two citation errors and two novelty claims with missed prior art: \"The combination — a scheduler whose every schedule is validated bit-for-bit against an exact meaning, on the actual GPU — is the new thing here\"; see errors.",
      "padding": "(score 4) Mostly measured content; the vendor-comparison table in §1 is generic (\"global fast-math flags; sampling tests written by the pass author\")."
    },
    "best_ideas": [
      "The f64 oracle as a precision profile of the same emitter, which makes deployment-scale checking cheap: \"**the oracle is just the lowering run in a different precision.** The same emitter, the same tree, the same batch protocol\" — bit-identical with CPU f64 on arithmetic programs; it finds 3 of 6 corpus programs over budget at full size.",
      "A static fusion rule from a 16× refutation: \"the fold's serial chain may contain loads and adds, never expensive ops\".",
      "Pricing the existing reassociation on the real target: \"The split-sum-optimized matmul at 512³ runs **0.312 ms vs 0.214 ms original — 46% slower on the GPU**\"."
    ],
    "novelty_check": [
      "'The order-sensitivity classification is also new in this setting.' Prior art: Halide's rfactor admits only associative reductions (Suriana et al., CGO 2017), and polyhedral reduction handling (Reddy et al., PACT 2016). Not new.",
      "Certified budgets in a checked-pass compiler. FPTaylor and Satire (cited) provide the bounds; the integration is modest.",
      "GPU f64 oracle. Same as doc-F P3; standard differential testing at scale."
    ],
    "errors": [
      "\"A. Solovyev, M. S. Jacobsen, Z. Rakamarić, G. Gopalakrishnan. 'Rigorous Estimation of Floating-Point Round-off Errors with Symbolic Taylor Expansions.' *ACM TOPLAS* 41(1), 2018\" — the authors are Solovyev, Marek S. Baranowski, Ian Briggs, Charles Jacobsen, Rakamarić and Gopalakrishnan.",
      "\"J. Ragan-Kelley et al. 'Halide: A Language and Compiler for Optimizing Parallelism, Locality, and Recomputation in Image Processing Algorithms.'\" — the title ends \"...Image Processing Pipelines\".",
      "\"The order-sensitivity classification is also new in this setting\" — the novelty claim misses prior art (Suriana et al. 2017; Reddy et al. 2016).",
      "\"The combination — a scheduler whose every schedule is validated bit-for-bit against an exact meaning, on the actual GPU — is the new thing here\" — the claim misses Yang et al., arXiv 2609.11356 (2026), which restricts Triton autotuning to one bitwise-equivalence class with static checkers validated on hardware."
    ],
    "would_fund": "Rank 3, the deployment-scale f64 oracle. It is cheap, reuses the emitter and the batch protocol, and already exposed budget violations and a mispriced rewrite that the sampled gate cannot see.",
    "notes": "Solid, honest engineering with good measurements (exact tiled matmul within 1.5× of cuBLAS at 512³, exact fused softmax 2.3×, full-scale oracle). The proposals are the expected ones and the certificate theory is thin."
  },
  {
    "doc": "doc-K",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 8,
      "evidence": 8,
      "correctness": 8,
      "grounding": 7,
      "padding": 2,
      "overall": 8
    },
    "low_score_quotes": {
      "padding": "(score 2, very low padding) Compact and almost entirely measured: \"Where the pass changed the program, the proof is 43 to 75 times faster than the sampled gate, and it covers every shape.\""
    },
    "best_ideas": [
      "The binade transducer: \"While the accumulator stays in one binade, a rounded addition is an integer addition whose only dependence on the accumulator is its parity. A chunk of the input therefore has a two-entry summary\" — a monoid of chunk summaries. It is bit-identical on the GB10 in every configuration, 33–94× faster on long growing sums, honestly refuted on the corpus shapes, with the f64 guess drift diagnosed.",
      "Equivalence by normalization because the meaning has no algebra: \"Giving up the algebra makes equivalence decidable by normalization\" — inline proved on all six programs in under 0.2 ms; it rejects a mutant that the real sampled gate accepts (reproduced locally).",
      "Finding the gate's shape-aliasing hole: \"A function with four or more shape symbols therefore has pairs of symbols that are equal in every sampled case: `D` and `O` in `mlp`, `D` and `V` in `attention`, `C` and `O`, `H` and `W` in `conv2d`\" (verified against `contract.ts`), and an inverse-rule proof for split-sum with a theorem budget."
    ],
    "novelty_check": [
      "Parity transducer. Kapre and DeHon 2007 (iterative), Raychev et al. SOSP 2015 (symbolic summaries) and Mytkowicz et al. ASPLOS 2014 (data-parallel FSMs) are cited and verified. Kadric, Gurniak and DeHon (ARITH 2013) compute correctly rounded, not sequential, sums. A targeted search found no within-binade parity-indexed summary, so novelty holds. doc-I's translation lemma is an independent parallel.",
      "Normal-form equivalence. Affine equivalence checking (Verdoolaege et al. TOPLAS 2012, quote verified) is prior art; the observation that Tix's exact meaning removes the AC problem is the new point.",
      "cuBLAS in-order FMA at 4096³. Independently replicates doc-A."
    ],
    "errors": [
      "\"Shashidhar, Bruynooghe, Catthoor and Janssens treat associativity and commutativity as declared operator properties ('Verification of Source Code Transformations by Program Equivalence Checking', CC 2005)\" — the CC 2005 paper's abstract covers dynamic-single-assignment affine programs. The algebraic (associativity/commutativity) handling is in the companion DATE 2005 paper, \"Functional Equivalence Checking for Verification of Algebraic Transformations on Array-Intensive Source Code\" (probable misattribution, unconfirmed).",
      "\"cuBLAS documentation, section 2.1.4, 'Results Reproducibility'\" — correct, but the section also says the guarantee fails when multiple CUDA streams are active or fixed-point emulation is used, which the paraphrase omits (minor)."
    ],
    "would_fund": "Proposal 2, acceptance by proof. It closes a hole the document demonstrated in the merged gate for a 60-line checker, and every later schedule or transducer pass needs a gate that covers all shapes.",
    "notes": "Three distinct, original ideas, each with a decisive experiment that could have refuted it; one (the transducer on corpus shapes) did, and the document says so. The class definition (results that are a specified function of input bits) is sharp; the plan does not address the transcendental cost that dominates softmax, attention and mlp."
  }
]
```

## Ranking by overall score

1. **doc-A (9).** It defines best in class as speed at a portable exact meaning, measures the ceiling, and backs four proposals with bit-identical kernels on all six programs (3.76× hand, 3.19× generated), 2^32-proved fast intrinsics and data-universal fingerprints.
2. **doc-G (8).** Row ownership derived from index maps, a verified schedule artifact emitted to CUDA, and a correct INT8 exactness theorem tested honestly on the GPU make it the best-grounded design in the framework.
3. **doc-K (8).** It is the most original per page: a parity transducer for the sequential fold, equivalence by normalization, and a real shape-aliasing hole in the merged gate, each with a decisive experiment and an honest refutation.
4. **doc-I (7).** It is the deepest single investigation (an exp table fitted to the reference with refutation witnesses, certified by enumeration against Node, giving 4.25× exact softmax), but its scope is limited to softmax and attention rows.
5. **doc-E (6).** It contributes clear trace-neutrality theory, a per-construct price list and the "gate the change, not the total" finding, with few errors and standard proposals.
6. **doc-F (6).** It brings a working, sound certified-bound analyzer and a neat defined-tree lemma for parallelising within a checked split, with mostly standard ideas and an overgeneralized FMA conclusion.
7. **doc-J (5).** It is good engineering (exact tiled matmul within 1.5× of cuBLAS, full-scale f64 oracle exposing violations), with expected proposals and thin certificate theory.
8. **doc-C (5).** It is a sound critique of the sampled gate with a nice evasion experiment, but its headline proposals are unprototyped and its 2^32 sweep covers only a quarter of the space, visited twice.
9. **doc-D (5).** It is competent and well grounded (a certificate prototype, bit-exact fusions), but conventional, with an invalid blind-spot refutation and five bad citation identifiers.
10. **doc-H (4).** Useful gate findings are undercut by two wrong premises its plan depends on: that tensor cores are required past 3 TFLOP/s, and that fusing sums requires a budget.
11. **doc-B (3).** Two real audit findings sit among arithmetic errors, an undiagnosed indexing bug, wrong summation theory and the largest number of fabricated or wrong citations in the pack.
