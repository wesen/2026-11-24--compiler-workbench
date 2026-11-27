[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 7,
      "evidence": 8,
      "correctness": 6,
      "grounding": 7,
      "padding": 2,
      "overall": 7
    },
    "best_ideas": [
      "Compress an ordered f32 chunk into “a two-entry summary with a validity window” that can be composed or rejected at runtime.",
      "Check inlining by comparing “the result tensor's expression with every definition inlined,” and use a shape-aliasing mutant to test what the check buys.",
      "Separate the cost of rounding from the cost of placement using “the same schedule with FMA” as a matched GEMM control."
    ],
    "novelty_check": [
      "Ordered tiling is established scheduling practice. The contribution is the GB10 measurement of a strict two-rounding schedule against matched FMA and vendor controls. Halide establishes the algorithm/schedule split, its formal semantics addresses an integer model, and RepDL already fixes floating-point operation order. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Formal Semantics for Halide](https://arxiv.org/html/2210.15740), [RepDL](https://arxiv.org/html/2510.09180v1)",
      "Canonical comparison is established translation-validation practice. TensorRight is missed related prior art for symbolic tensor rewrite validation at indexed outputs. The narrow Tix contribution is the exact-tree specialization, the inverse split rule, and the concrete sampler escape. [TensorRight](https://doi.org/10.1145/3704865)",
      "Kapre and DeHon already recover the sequential floating-point result in parallel. Raychev et al. summarize unknown incoming state, and Mytkowicz et al. compose finite-state transitions. I found no match for the specific two-parity displacement summary with prefix validity windows. [Kapre and DeHon](https://ic.ese.upenn.edu/abstracts/fpaccum_arith2007.html), [Raychev et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Mytkowicz et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/asplos302-mytkowicz.pdf)"
    ],
    "errors": [
      "“Tix defines every bit of its f32 result.” The Stage 2 report records different NaN words for the same negative square root, and the source uses JavaScript transcendental functions whose approximations are implementation-dependent. Specify a NaN observer and pin or specify the transcendental reference. [ECMAScript Math.exp](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.exp)",
      "“Giving up the algebra makes equivalence decidable by normalization.” Equality of the proposed normal forms is a sufficient test for a restricted rewrite class. The document itself gives a counterexample to completeness by swapping commutative operands.",
      "“Equal normal forms imply equal bits for every shape and every in-domain input.” The standalone prototype omits function names and serializes direct parameter returns as just `{ param: fn.result }`, dropping their signatures and shapes. Require independently checked signatures and result extents before using the normalized body as a pass certificate.",
      "“This bound holds for all inputs.” The stated gamma bound requires finite terms, no overflow in the additions, and `(n−1)u < 1`. A CPU probe with `[Fmax, 0, 0, 0, Fmax, −Fmax]` produced infinity in the flat fold and finite `Fmax` after splitting. Even where the local bound holds, accepting a reassociation inside an arbitrary output expression requires controlling how the local error propagates. [Higham](https://nhigham.com/wp-content/uploads/2023/10/high93s.pdf)",
      "“A correct split exceeded the fixed tolerance.” Experiment 5 uses the sequential f32 sum as the comparator and scales its budget by that sum. The merged split gate uses the origin's f64 evaluation. The reported factor of 2.49 establishes a result for the experiment's comparator.",
      "“If the exact value of `s + x` has magnitude in `[2^e, 2^(e+1)]`.” At `e = 127` and `s = x = 2^127`, the formula gives `2^128`, while binary32 nearest rounding overflows to infinity. The prototype's strict interior window avoids that endpoint. State the lemma on the guarded domain. [NVIDIA floating-point guide](https://docs.nvidia.com/cuda/floating-point/index.html)",
      "“`CheckResult` evidence today is differential evidence.” The framework declares `evidence?: unknown`. Tix can attach a domain-local certificate today. A framework change would be needed for shared assurance classification, rather than for carrying the certificate.",
      "“The sequential kernel is already near the memory bound.” The same 4096×1024 table reports 0.047 ms for the free fold, roughly 357 GB/s of logical input traffic. The 244 GB/s streaming benchmark is a useful reference point, but it neither bounds this warmed workload nor establishes the sequential bottleneck."
    ],
    "would_fund": "Fund the normal-form gate for same-signature inlining first. The demonstrated aliasing escape gives it an immediate acceptance test, and that scope can be checked independently of CUDA and reassociation bounds.",
    "notes": "Speed for a specified result is a good definition once the observer and runtime profile are explicit. The short passage “the transducer on the corpus shapes” earns its space by stating where the most original idea loses, although that finding is repeated in the summary and ranking."
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 8,
      "grounding": 9,
      "padding": 2,
      "overall": 8
    },
    "best_ideas": [
      "Derive row residency from affine access fibers and certify “which threads see” each rounded producer value.",
      "Make the placement plan a v6 artifact and verify “ownership, coverage, barriers and f32 recurrence” before emitting CUDA.",
      "Use “an immutable packed grid” to justify exact INT8/S32 execution, then charge the actual cost of proving, packing, and routing."
    ],
    "novelty_check": [
      "Row-resident softmax and normalization are established. The distinctive contribution is checking affine ownership and allowing the max tree while retaining the ordered sum. The discussion of online normalization and FlashAttention correctly distinguishes their arithmetic trees from Tix's. [Triton fused softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Online Normalizer](https://arxiv.org/abs/1805.02867), [FlashAttention](https://proceedings.neurips.cc/paper_files/paper/2022/hash/67d57c32e20fd0a7a302cb81d36e40d5-Abstract-Conference.html)",
      "Translation validation, verified affine scheduling, and selected GPU kernel proofs already exist. The Tix-specific contribution is the small block-private phase model wired into an actual v6 postcondition, plus emitted code and mutation tests. [Li, Liang and Feng](https://plax-lab.github.io/publications/polyhedral/index.html), [VeriTile](https://veriinfra-lab.github.io/VeriTile/proofs/coverage/), [CUDA synchronization](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-c-programming-guide/index.html#synchronization-functions)",
      "Integer tensor-core products and scaled integer accumulation have prior art. The conditional identity with every prefix of the existing ordered f32 dot, including the treatment of zero, is the distinctive part. I found no matching allocation-epoch certificate for that claim. [Ootomo, Ozaki and Yokota](https://arxiv.org/abs/2306.11975), [Integer-only inference](https://arxiv.org/abs/1712.05877), [PTX MMA](https://docs.nvidia.com/cuda/archive/13.0.0/parallel-thread-execution/index.html#warp-level-matrix-instructions-mma)",
      "The one-shot prefix verifier is an explicitly limited variant of optimistic accumulation. Its contribution is the negative hit-rate result and the demonstration that final-word equality can hide incorrect interior carries. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)"
    ],
    "errors": [
      "“A stage-2 split sum, if accepted upstream.” The split-sum rewrite is Stage 1 work. Stage 2 lowers the resulting tree from the current Tix revision.",
      "“A mismatching binary cannot reuse a passing receipt.” The archived certified-row prototype binds the emitted header digest and the runner's build-input hash. The base runner hashes the compiler path and inputs. It does not authenticate the executed binary or identify a compiler replaced at the same path. Binary binding remains an implementation requirement.",
      "“It uses the same verifier as a typed postcondition, then maps the accepted load tree and fold mode to CUDA.” There is a verifier/emitter gap beyond the two fixtures. A local compiler probe confirmed that `x[i,j] + K` can produce a scalar shape node using a third parameter's extent. The verifier accepts that node, while the emitter only knows the row and column dimensions and throws on `K`. Check that restriction before accepting the schedule or pass the additional extent to the emitter."
    ],
    "would_fund": "Fund the certified row emitter first. The generated softmax and layernorm gains, deliberate certificate mutations, and exercised width fallback make it the shortest route to a useful checked backend feature.",
    "notes": "The ordered and application benchmark boards give a good definition of leadership because they distinguish matching the source answer from competing on application speed. The final recap “Whole-input scanning lost to exact FP32 tiling” repeats the ablation, with little other padding."
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 8,
      "creativity": 8,
      "scientific_depth": 7,
      "evidence": 9,
      "correctness": 5,
      "grounding": 8,
      "padding": 4,
      "overall": 7
    },
    "best_ideas": [
      "Instantiate “the same kernel source” with symbolic scalars to expose rounding-tree changes on inputs where numeric comparisons miss them.",
      "Use “a Ziv rounding test with a double-precision fallback” and exhaustively check the fast paths against the existing scalar reference.",
      "Split fusion groups at contractions and “materialize only the tensors that cross kernels,” generating schedules for five of six corpus programs."
    ],
    "novelty_check": [
      "The scheduling techniques and batch-invariant contraction objective have prior art. The contribution is the measured cost of Tix's exact order and the working two-template planner. [Halide rfactor](https://andrew.adams.pub/par.pdf), [Thinking Machines Lab](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [LLM-42](https://arxiv.org/html/2601.17768v2)",
      "Adaptive rounding checks and exhaustive binary32 reference comparisons are established. The distinctive target is Tix's JavaScript-derived observation and the proposal to carry the qualified result as pass evidence. [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [RLIBM-32](https://arxiv.org/abs/2104.04043), [CORE-MATH](https://core-math.gitlabpages.inria.fr/)",
      "Mirage is missed prior art for probabilistic tensor equivalence checking, and TensorRight is prior art for symbolic validation of indexed tensor outputs. I found no identical same-source CUDA instantiation using a strict rounded-expression algebra. The residue sweep is a useful mutation-testing technique. [Mirage](https://www.cs.cmu.edu/~zhihaoj2/papers/mirage.pdf), [TensorRight](https://doi.org/10.1145/3704865)",
      "Fixed split sizes and named floating-point operation orders already appear in Thinking Machines' kernels and RepDL, respectively. Boldo and Melquiond give prior art for correct FMA emulation. I found no identical use of the origin's measured f32 error as the normalization term for a Tix pass. [Thinking Machines Lab](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [RepDL](https://arxiv.org/html/2510.09180v1), [Boldo and Melquiond](https://guillaume.melquiond.fr/doc/08-tc.pdf)"
    ],
    "errors": [
      "“Stage 2 already satisfies this” and “portable, exactly specified meaning” overstate current assurance. The Stage 2 gate compares sampled outputs to f64 under a tolerance, and JavaScript transcendental results depend on the implementation. The global portability promise needs a specified primitive reference. [ECMAScript Math.exp](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.exp)",
      "“T_e depends on the reduction extents and on the words e reads, never on the extents of free axes.” Tix allows shape values in scalar expressions. A local run of `y[i] = x[i] + N` returned 6 and 7 for the same first input value when `N` changed from 1 to 2. Batch invariance requires that the resized dimension leave the selected expression, reduction domains, and reads invariant.",
      "“No implementation of the current meaning can exceed 14.39 TFLOP/s” and “no schedule can parallelize it” turn measurements of particular implementations into impossibility claims. The throughput experiment measures one instruction mix, while parallel algorithms that preserve the sequential sum already exist. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)",
      "“At 4096³ it is cuBLAS's own function.” Agreement on the tested operands establishes an empirical match for that case. It does not identify cuBLAS's algorithm or establish equality on all operands. [cuBLAS reproducibility contract](https://docs.nvidia.com/cuda/cublas/index.html#results-reproducibility)",
      "“This is the join of a semilattice: associative, commutative and idempotent on words.” The CUDA helper canonicalizes NaNs, so joining a noncanonical NaN word with itself can change its bits. The stated law holds on the proposed NaN-class observation or on canonicalized words.",
      "“The worst case equals Stage 2's cost, never worse.” A fallback-heavy warp can pay for range reduction, approximation, and its decision before running the double routine. Also, the claim that the fast path is proved “for this compiled binary” applies to the audited microbenchmarks. The corpus kernels separately compile force-inlined headers, so their equivalence evidence is the sampled corpus comparison.",
      "“Up to a 2^-64 collision probability per comparison.” The fixed mixer has no random seed or collision proof. Matching fingerprints are heuristic evidence, and they also depend on the symbolic instantiation following the same relevant control flow and memory behavior as the f32 instantiation.",
      "“The tree of an element depends on the shape only through the quotient class of each extent (0, 1 or at least 2 tiles) and its residue.” A branch at four tiles satisfies the stated condition about multiples and defeats the proposed quotient classes even on one axis. The reported eight-shape “Stage 1/2 recipe” also omits the all-zero assignment in the actual CUDA sampler.",
      "“Split-sum is never less accurate than the origin by more than that factor.” The observed 0.95 is a sampled maximum against a denominator that includes a half-ULP allowance. It gives no universal bound relative to the origin's error alone. The archived implementation also tests `ratio > K_NORM`, which fails to flag a NaN ratio, and its fixed subnormal ULP breaks the claimed scale covariance at the bottom of the range.",
      "“The correctly rounded dot product computed exactly with integer tensor cores [Ozaki 2012].” The cited paper gives an error-free splitting method built on floating-point matrix products. The integer tensor-core implementation is a later development. [Ozaki et al. 2012](https://waseda.elsevierpure.com/en/publications/error-free-transformations-of-matrix-multiplication-by-using-fast/), [Ootomo, Ozaki and Yokota 2024](https://arxiv.org/abs/2306.11975)"
    ],
    "would_fund": "Fund the two-template schedule planner first. Its generated results across five programs, including direct interpreter comparisons at off-tile shapes, give a stronger starting point than the proposed fingerprint proof policy.",
    "notes": "Fast execution for a fixed observable meaning is a good definition, and the five-program generator gives it a credible benchmark. The recurring “sequential-fold wall” and ceiling arguments add some padding, while the quoted portability, hashing, and performance claims are the main correctness deductions."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 9,
      "evidence": 10,
      "correctness": 9,
      "grounding": 9,
      "padding": 1,
      "overall": 9
    },
    "best_ideas": [
      "Intersect per-input rounding constraints and return “two source-level f32 inputs demonstrating why that table family cannot work.”",
      "Have the timed kernel and auditor call “one executable with an out-of-line scalar device function,” then compare complete output streams against independent Node evaluation.",
      "Certify an ordered-fold chunk using “its beginning and end words and its minimum and maximum raw word along the entire path,” with miniature counterexamples for weakened guards."
    ],
    "novelty_check": [
      "Tang supplies the table-driven structure, and RLIBM already fits approximations to output rounding intervals. Harrison independently verified a table-driven exp implementation against a real-function error bound. I found no match for the discrete one-coefficient interval intersection, its conflicting-input witnesses, and the same-binary qualification against the Node reference. [Tang](https://doi.org/10.1145/63522.214389), [RLIBM-32](https://arxiv.org/abs/2104.04043), [Harrison](https://www.cl.cam.ac.uk/~jrh13/papers/tang.html)",
      "Resident rows and checked scheduling have prior art. The distinct contribution is using the resolved same-row max/subtract relationship to admit a restricted scalar intrinsic while preserving the ordered denominator, then reusing that region inside attention. [Triton fused softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Exo](https://www.cs.cornell.edu/~yuka/pdf/exo_pldi2022_full.pdf), [NVIDIA floating-point guide](https://docs.nvidia.com/cuda/floating-point/index.html)",
      "Sequential-equivalent speculative summation and composable state summaries both have prior art. I found no match for the adjacent-seed, even-shift certificate using guarded trace extrema. Ahrens, Demmel and Nguyen establish the distinct goal of order-independent accumulation. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf), [Raychev et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Ahrens, Demmel and Nguyen](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-121.html)"
    ],
    "errors": [
      "“This prototype uses a width cap of 1,024, chooses the generated route on empty dimensions and wide rows.” The standalone softmax harness does this and the archived width-1025 result confirms it. The attention harness instead exits on zero dimensions or K above 1024, so the demonstrated fallback applies only to standalone softmax."
    ],
    "would_fund": "Fund the domain-specific intrinsic fitter and its qualification gate. Use the checked ordered-double row template as the paired control so the compiler can measure what the fitter contributes after fusion.",
    "notes": "Time to a reproducible answer on a named target and runtime is a good definition, with credible paired measurements, a signed-zero-aware maximum, and receipts that tie the scalar audit to the timed binaries. The passage “A 4.25× softmax speedup” earns its repetition by quantifying how little of that factor transfers to whole attention."
  }
]

1. **doc-D (9)** — The coefficient fitter, conflicting-input witnesses, and independently qualified timed binaries make the strongest case for a new compiler capability.
2. **doc-B (8)** — The checked row artifact and emitted CUDA give the clearest path from a structural invariant to a production optimization.
3. **doc-C (7)** — The generated five-program planner breaks the tie on demonstrated corpus impact, while the strongest portability and proof claims exceed the evidence.
4. **doc-A (7)** — The parity summary is a substantial research idea, but its measured wins sit outside the current corpus and the proposed proof gate needs tighter hypotheses.