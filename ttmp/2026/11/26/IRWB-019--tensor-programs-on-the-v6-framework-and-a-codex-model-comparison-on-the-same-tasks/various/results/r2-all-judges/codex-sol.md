[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 8,
      "evidence": 10,
      "correctness": 7,
      "grounding": 9,
      "padding": 3,
      "overall": 9
    },
    "best_ideas": [
      "Run one CUDA kernel at two scalar types to expose its floating-point expression tree. “The same kernel source is compiled at a symbolic scalar type.”",
      "Derive falsification cases from tile residues. “Take one axis at a time and give it every extent r, T + r and 2T + r.”",
      "Qualify fast exp and tanh against the language’s observable result. “The target is the language meaning, not the mathematical function.”"
    ],
    "novelty_check": [
      "Exact schedule search builds on Halide’s schedule separation and Boehm’s GEMM tiling. He and Gond already motivate batch-invariant kernels. The contribution here is measured ordered-f32 coverage across all six fixtures and an IR-driven planner for five. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Boehm](https://siboehm.com/articles/22/CUDA-MMM), [He](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [Gond et al.](https://arxiv.org/html/2601.17768v1)",
      "Ziv, RLIBM-32 and CORE-MATH cover guarded rounding, fitting rounded outputs and exhaustive binary32 checks. The work here supplies fast implementations for Tix’s particular reference and ties qualification to the toolchain. [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [RLIBM-32](https://arxiv.org/abs/2104.04043), [CORE-MATH](https://core-math.gitlabpages.inria.fr/)",
      "Symbolic crosschecking of floating-point kernels predates this work. I found no matching use of GPU execution of the same CUDA templates with a rounding-aware fingerprint algebra and tile-residue falsifiers. [Collingbourne et al.](https://srg.doc.ic.ac.uk/files/papers/kleefp-eurosys-11.pdf), [Necula](https://people.eecs.berkeley.edu/~necula/Papers/tv_pldi00.pdf)",
      "Fixed split sizes for batch invariance and careful FMA emulation have direct prior art. The contribution is the paired GB10 price measurements, constructed double-rounding cases and the origin-calibrated norm test. [He](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [Boldo and Melquiond](https://guillaume.melquiond.fr/doc/08-tc.pdf), [cuBLAS reproducibility](https://docs.nvidia.com/cuda/cublas/index.html#results-reproducibility)"
    ],
    "errors": [
      "“No implementation of the current meaning can exceed 14.39 TFLOP/s.” This is a measured issue rate for one instruction sequence on one device. It cannot bound all exact algorithms, and the observed 1.45× ratio cannot establish how much of the vendor gap is forced by semantics.",
      "“Batch invariance is a theorem of the Tix meaning.” It holds for the tested row-separable programs when their scalar operands and reduction domains stay fixed. Tix can read the batch extent as a scalar, so `y[i,j] = x[i,j] + M` disproves the general claim.",
      "“Up to a 2^-64 collision probability per comparison.” The prototype uses fixed deterministic mixers, including hash equality with the distinguished +0 tag. It supplies no random hash model or collision bound, and the same C++ source at two types still requires a correspondence argument through compilation.",
      "“The tree of an element depends on the shape only through the quotient class of each extent (0, 1 or at least 2 tiles) and its residue.” Comparisons with multiples of the tile size alone do not imply that quotient collapse. A branch at 3T or a joint predicate on two residues escapes the proposed one-axis sweep.",
      "“The worst case equals Stage 2’s cost, never worse.” A lane can execute the approximation and guard before it executes the fallback. The exhaustive output comparison also establishes equality for the tested executable and reference, without establishing the estimated error interval itself.",
      "“It is cuBLAS’s own function.” The 4096³ output agreement establishes agreement for the measured call and operands. It does not identify a general implementation or API guarantee.",
      "“A fold is a dependent chain of RN additions in one thread, and no schedule can parallelize it.” The literal recurrence is serial, but exact transfer summaries or speculative correction can compute the same result with parallel work. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)"
    ],
    "would_fund": "Fund exact scheduling and the two-template planner first. It already turns actual Tix IR into useful CUDA on five fixtures and supplies concrete controls for testing a checked schedule representation.",
    "notes": "Fastest execution at a fixed observable meaning is a good definition, especially where the document quantifies both proof scope and speed. I checked the current-f64 lowering relation, the separate CUDA rounding intrinsics and the generic differential outcome type, with the concrete evidence scope captured by “the prototype planner reaches 3.19× on five programs.”"
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 5,
      "creativity": 5,
      "scientific_depth": 4,
      "evidence": 6,
      "correctness": 3,
      "grounding": 5,
      "padding": 6,
      "overall": 5
    },
    "best_ideas": [
      "Compile an indexed magnitude companion alongside the value program. “The certificate is a program the compiler compiles.”",
      "Drive tests from symbolic extent coincidences and residues. “One assignment in which they differ.”",
      "Apply fast arithmetic through the real injected-executor gate. “Runs the merged checked lowering against the fast source.”"
    ],
    "novelty_check": [
      "Separating values from placement and testing schedules has clear prior art. The proposed use of Tix’s exact gate is a local integration. “A second IR kind for schedules” mainly applies existing machinery. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf)",
      "The Tix-to-Tix magnitude program is the most distinctive idea. Error-controlled compilation and optimization already exist in Rosa and Daisy, while Higham provides the local summation bound. [Rosa](https://arxiv.org/abs/1410.0198), [Daisy](https://people.mpi-sws.org/~eva/papers/tacas18_daisy_toolpaper.pdf), [Higham](https://epubs.siam.org/doi/book/10.1137/1.9780898718027)",
      "Order-free reduction is established in reproducible and exact summation libraries. The contribution is the proposed Tix tag and profile check. “Programs that need stage-1 compatibility keep ordered” is a language-policy choice. [Demmel and Nguyen](https://www.acsel-lab.com/arithmetic/arith21/papers/p54.pdf), [Neal](https://arxiv.org/abs/1505.05571)",
      "Pugh and Cooper establish the integer-analysis antecedents, and Ziv and RLIBM establish antecedents for scalar qualification. The observed case-domain gaps are Tix-specific. [Omega test](https://www.cs.umd.edu/~pugh/papers/omega.pdf), [Cooper](https://www.cs.cmu.edu/~emc/spring06/home1_files/Cooper.pdf), [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [RLIBM-32](https://arxiv.org/abs/2104.04043)",
      "The tensor-core proposal inherits splitting and partial products from published work. “None of my own yet” accurately describes the evidence for the claimed Tix speedup. [Ozaki et al.](https://link.springer.com/article/10.1007/s11075-011-9478-1), [Ootomo and Yokota](https://arxiv.org/abs/2203.03341)"
    ],
    "errors": [
      "“Matmul moves 0.4 MB per 512³ operation” and “1.34×10⁸ flops into 0.197 ms is 1.7 TFLOP/s.” Minimum operand and output traffic is about 3.15 MB. With the usual two operations per term, the run delivers about 1.36 TFLOP/s.",
      "“A load/layout error I did not find or the compiler is doing something.” The plain tile explicitly reads `B[t * TS + ty * N + col]` instead of `B[(t * TS + ty) * N + col]`. It loads the wrong rows after the first panel.",
      "“It holds if and only if each output’s operation sequence is unchanged” and “a 49-element tensor suffices for bit identity of a schedule.” Structural preservation with correct operands and execution is sufficient, while other equivalent trees exist. A small exact sample cannot cover unexecuted tiles or tails.",
      "“Worst budget fraction” uses `|fast − exact|` whereas “the contract’s own threshold” is evaluated against its f64 reference. The full-size table measures distance from the f32 lowering and cannot by itself establish a contract failure against f64.",
      "“The gate never sees a reduction longer than 7 elements” is already false for the corpus convolution, whose loop visits `C·3·3` terms. Fixed and affine extents can also exceed the sampled symbol values.",
      "“A sum of 1024 terms consisting of 1, −1,000 negative terms of 10⁻³ and a final −1.” The script uses first term 1000, then 1022 positive 0.001 terms, then −1000.",
      "“The shadow of a composition is the composition of the shadows.” A single magnitude shadow gives no general roundoff bound for compositions involving division, cancellation or transcendental sensitivity. A sound implementation needs separate magnitude and error propagation, denominator bounds and outward rounding.",
      "“A compensated (Neumaier/Kahan-Babuška) or expansion-based sum achieves it.” Ordinary compensation does not guarantee a correctly rounded exact sum for all inputs. “There is no thread mapping other than ‘one thread per output, folding alone’” likewise ignores cooperative staging and exact speculative approaches. [Neal](https://arxiv.org/abs/1505.05571), [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)",
      "“A cover that includes, for every reduction symbol, every residue … up to a threshold, is complete.” Marginal residue tests do not decide joint affine predicates, and pairwise unequal extents do not prove address equivalence. Use symbolic obligations for a proof and retain the cases as tests.",
      "“run(side, artifact, case) cannot see it.” The actual API also passes `inputs`. Profiles can be explicit input ports or captured by the spec. “Softmax fusion … is illegal today” is also false when lanes stage already rounded values and one owner keeps the ordered sum.",
      "“D. C. Cooper, ‘Programs for machine proofs in geometry’” misidentifies the cited procedure. “1507.08697” points to algebraic geometry instead of Neal, “s11075-011-9499-9” points to a hypergeometric-functions paper instead of Ozaki, and “114697.116805” is not Ziv’s paper DOI. The Ootomo citation gives the wrong author initial, title, venue and link. [Cooper](https://www.cs.cmu.edu/~emc/spring06/home1_files/Cooper.pdf), [Neal](https://arxiv.org/abs/1505.05571), [Ozaki](https://link.springer.com/article/10.1007/s11075-011-9478-1), [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [Ootomo and Yokota](https://arxiv.org/abs/2203.03341)"
    ],
    "would_fund": "Fund checked register-blocked tiling at the exact current-f32 relation. The 512³ result gives a workable starting point and the broken shared tile is a useful named falsifier.",
    "notes": "“Most performance per unit of decided semantic guarantee” is a useful direction but lacks a measurable denominator and treats sampled and proved claims as comparable units. The real CUDA tolerance, symbolic case assignment and differential input ports support the gate audit while contradicting several implementation premises of the roadmap."
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 6,
      "creativity": 5,
      "scientific_depth": 6,
      "evidence": 7,
      "correctness": 5,
      "grounding": 7,
      "padding": 5,
      "overall": 6
    },
    "best_ideas": [
      "Certify a lowering by “a fold-tree isomorphism” tied to its output writes.",
      "Make the shape blind spot observable with a runnable mutation. “At extent 16 the error is 4018× the budget.”",
      "Bind an intrinsic’s measured domain to a target artifact. “A sweep description plus digest.”"
    ],
    "novelty_check": [
      "“A per-emission certificate rather than a proof about the pass” has direct antecedents in Halide translation validation, including annotations and a bitwise SMT option. Tix’s proposed restricted fold map is the useful specialization. [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [CompCert floating point](https://gallium.inria.fr/~xleroy/publi/fp-compcert-arith13.pdf)",
      "The rounding test and exhaustive scalar validation have prior art in Ziv and RLIBM. Reuse of a toolchain-qualified witness as a Tix lowering prerequisite is the contribution. [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [RLIBM-32](https://arxiv.org/abs/2104.04043)",
      "The alternate exact sum comes from long-accumulator work. A Tix relation between its ordered and alternate meanings is a plausible language integration. [ExBLAS](https://www.nist.gov/system/files/documents/itl/ssd/is/NRE-2015-04-iakymchuk.pdf), [Ahrens, Demmel and Nguyen](https://willowahrens.net/assets/documents/ahrens_algorithms_2020.pdf)",
      "Static error admission has a substantial antecedent in Rosa. FPTaylor supplies rigorous analysis and proof certificates. This proposal contributes shape-dependent tensor obligations and a mutation that motivates stronger admission. [Rosa](https://arxiv.org/abs/1410.0198), [FPTaylor](https://soarlab.org/papers/2018_toplas_sbbjrg.pdf), [Higham](https://epubs.siam.org/doi/book/10.1137/1.9780898718027)",
      "Boundary-directed examples and memoized replay are familiar verification tools. The checked CUDA mutant makes the need concrete. The GEMM tiling also has clear prior art. [Goto and van de Geijn](https://www.cs.utexas.edu/~flame/books/TOMS.pdf)"
    ],
    "errors": [
      "“I swept 2,147,483,648 f32 input words (a stride-4 traversal … 506 ms).” The timed helper launches one warmup and one measured pass with the same start and stride, without clearing the counters. It visits 2³⁰ distinct words and counts them twice. The 1,262 guard mismatch count similarly represents 631 distinct sampled failures, and 506 ms extrapolates to about 2.03 s at unchanged throughput.",
      "“All 1262 failures are where expf saturates to 0 or inf.” The sweep records a count rather than failing words or categories. The reported locations and diagnosis are not established by this result. A faithful result may be one of the two adjacent representable numbers, whereas the document’s “faithful (≤0.5 ulp)” asks for a stronger condition.",
      "“Above 1.0 the relation cannot admit any candidate.” That excludes a candidate reproducing the over-budget f32 origin on those inputs. A different result closer to the f64 reference can pass, as the document’s own K=256 split result shows.",
      "“Price … ≤ 1.14 is an upper bound.” It is a ratio of two measured implementations. A faster relaxed kernel could raise the true ratio, and a faster exact one could lower it.",
      "“Parallelising the only serial construct … buys the only available speed.” The experiment couples a tree with different staging and exp work. A cooperative row block can parallelize those operations while keeping one ordered sum owner.",
      "“Goto & van de Geijn 2008” is used to support GB10 cuBLAS’s instruction mix. The paper describes GotoBLAS CPU GEMM. “J. Demmel, P. Ahrens, H. D. Nguyen” also reverses the first two authors of the 2020 paper, and the URL under “ExBLAS: Reproducible and Accurate BLAS Library” leads to the reproducible LU paper. [Goto and van de Geijn](https://www.cs.utexas.edu/~flame/books/TOMS.pdf), [Ahrens et al.](https://willowahrens.net/assets/documents/ahrens_algorithms_2020.pdf), [ExBLAS](https://www.nist.gov/system/files/documents/itl/ssd/is/NRE-2015-04-iakymchuk.pdf)"
    ],
    "would_fund": "Fund the restricted schedule certificate and require an independent check of coverage, addresses and synchronization. The extent-8 omission is a concrete acceptance test, and the exact tiled GEMM gives the first positive control.",
    "notes": "Speed under explicit preservation obligations is a good objective, with two useful kernel families measured and several broader claims still open. The repository confirms the ordered evaluator, current-f64 CUDA comparison and sampled shape assignments, and the author’s own “the warp variant also changes the memory access pattern” appropriately limits the reduction benchmark."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 7,
      "creativity": 6,
      "scientific_depth": 7,
      "evidence": 8,
      "correctness": 6,
      "grounding": 8,
      "padding": 4,
      "overall": 7
    },
    "best_ideas": [
      "Compare exact and relaxed kernels on a shared scoreboard. “Performance conditioned on a checked numeric relation.”",
      "Check an actual affine substitution with binder renaming. “Divergence only at load sites of removed single-use pointwise producers.”",
      "Retain the ordered sum while fusing and moving producers. “Lane-0 sequential sum.”"
    ],
    "novelty_check": [
      "Exact scheduling and class-based legality have close Halide translation-validation precedent, including a bitwise option. The Tix contribution is the small ordered-f32 rule set and its use in pass admission. [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Necula](https://people.eecs.berkeley.edu/~necula/Papers/tv_pldi00.pdf)",
      "Producer replication is already a principal Halide scheduling choice. The useful result is the measured exact row fusion and the control in which changing the sum tree bought negligible speed. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [FlashAttention](https://arxiv.org/abs/2205.14135), [Online softmax](https://arxiv.org/abs/1805.02867)",
      "Explicit numerical budgets in a compiler predate the proposal. The design contributes a Tix-specific measured price list and a GPU-oracle check plan. [Rosa](https://arxiv.org/abs/1410.0198), [Daisy](https://people.mpi-sws.org/~eva/papers/tacas18_daisy_toolpaper.pdf), [FPTaylor](https://soarlab.org/papers/2018_toplas_sbbjrg.pdf), [Higham](https://nhigham.com/wp-content/uploads/2023/10/high93s.pdf)",
      "Proof certificates and prevalidated variants are established techniques. The concrete contribution is the affine inline checker and its two mutants, with a measured check cost."
    ],
    "errors": [
      "“Naive-with-FMA 0.2131 ms (identical to naive-rn … contraction is free there).” Configurations 0 and 1 in the supplied harness both launch `matmul_k0`. The recorded naive rows are identical because they run the same kernel, while the 222,009 changed words belong to the register-tiled FMA variant.",
      "“The certificate holds on the real inline candidate of all six corpus programs.” The prototype’s agreement on those cases is recorded, but the checker omits the returned tensor and compares only the parameter count and function name for the signature. Switching the return to a different existing tensor of the same shape can escape it.",
      "“A certificate that ever disagrees with the sampled gate is a framework bug.” A defect in the domain checker, emitter, harness or toolchain can also cause disagreement. “Too strong … caught by the retained spot check” is conditional on the test exercising the bad case.",
      "“Today’s stage-2 kernels are fully certified.” The shipped gate establishes sampled f64 tolerance. The exact word comparisons are measurements over particular inputs.",
      "“Pnueli and Zuck, 1998” misattributes the foundational TACAS paper to the wrong coauthor. “Baghdadi et al., 2019” links to a gravitational-wave paper instead of Tiramisu. “Ootamo and Yokota” should be Ootomo and Yokota. [Translation Validation](https://link.springer.com/chapter/10.1007/BFb0054170), [Tiramisu](https://arxiv.org/abs/1804.10694), [Ootomo and Yokota](https://arxiv.org/abs/2203.03341)"
    ],
    "would_fund": "Fund exact row fusion with a compact schedule validator and end-to-end comparison. Softmax and layernorm both show substantial gains on the unchanged arithmetic, with workable controls for testing the emitted implementation.",
    "notes": "Certified throughput is a good definition when each entry names its actual assurance level. I verified the native exact gate, CUDA’s default contraction rules and the GB10 benchmark dispatch, where “the warp-tree softmax sum ran at the exact chain’s speed” is the stronger ablation than the mislabeled naive FMA control. [nvcc options](https://docs.nvidia.com/cuda/cuda-compiler-driver-nvcc/index.html)"
  },
  {
    "doc": "doc-E",
    "scores": {
      "ingenuity": 7,
      "creativity": 6,
      "scientific_depth": 6,
      "evidence": 8,
      "correctness": 5,
      "grounding": 7,
      "padding": 5,
      "overall": 7
    },
    "best_ideas": [
      "Use failed fusions to identify cost-model terms. “Bytes moved, sector transactions, transcendental issue, occupancy.”",
      "Expose how much of a budget the unmodified program consumes. “The candidate is the identity transformation.”",
      "Qualify emitter and scalar implementation at different scopes. “The lowering has two independent trust boundaries.”"
    ],
    "novelty_check": [
      "A searched schedule artifact and recomputation-aware costs are established Halide ideas. The coalescing and exponential ablations are the useful new inputs for a Tix cost model. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf)",
      "Explicit error requirements and accuracy-changing optimization have prior art in Rosa. The paired separate-rounding/FMA price measurements add Tix- and device-specific information. [Rosa](https://arxiv.org/abs/1410.0198), [Higham](https://epubs.siam.org/doi/book/10.1137/1.9780898718027), [FPTaylor](https://soarlab.org/papers/2018_toplas_sbbjrg.pdf), [NVIDIA tensor-core arithmetic study](https://eprints.maths.manchester.ac.uk/2784/3/fhmp20.pdf)",
      "Validating a particular emitted program is established translation validation, with close Halide precedent. Exhaustive unary comparison is also established. The Tix work is the proposed partition of evidence between its emitter and a pinned scalar profile. [Pnueli et al.](https://link.springer.com/chapter/10.1007/BFb0054170), [Necula](https://people.eecs.berkeley.edu/~necula/Papers/tv_pldi00.pdf), [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [RLIBM-32](https://arxiv.org/abs/2104.04043)",
      "Order-independent exact accumulation is established. The replayed comparisons quantify the trade for the Tix fold and show which claims are about accuracy versus its specified output. [Demmel and Nguyen](https://www.acsel-lab.com/arithmetic/arith21/papers/p54.pdf), [Kulisch](https://www.degruyterbrill.com/document/doi/10.1515/9783110301793/html), [Neal](https://arxiv.org/abs/1505.05571)"
    ],
    "errors": [
      "“59% of cuBLAS with every output word bit-identical to the Tix interpreter.” The interpreter comparison was at 128³. At 4096³ the packet reports throughput and no interpreter word comparison.",
      "“The irreducible price of Tix’s MAC” and “a factor between 1 and 1.87 … of any BLAS-3 kernel.” A measured instruction-loop ratio is not an algorithmic lower bound or a general kernel bound. The paired 4096³ result establishes a price for that implementation.",
      "“The f32 answer … does not depend on which accurate double formula computes it, except at a single input.” The sweep compares one specified pair of formulas per operation. “Overflows … for |x| > 355” is also wrong for the written tanh formula. Large negative arguments underflow the exponential and yield −1, while large positive ones can yield NaN.",
      "“45% of the program’s time is the double-precision exponential” converts throughput from a different kernel into a causal decomposition. The rate supports an estimate under a workload model. It cannot isolate the measured baseline’s time by subtraction.",
      "“Reduction reassociation … 0× (the same number of adds)” and “100%” changed words are unsupported. Equal operation counts can have different dependency depth and scheduling cost, and the reported round-to-nearest comparison includes agreements.",
      "“The program’s own f32 error … no rewrite can fix.” The error of the original remains a diagnostic baseline, while a reassociation can reduce the candidate’s error. Section 4.2 supplies that example.",
      "“Every plan is trace-neutral” and “the entire plan space is sound by construction.” Storage identity and pure recomputation alone do not prove address equivalence, coverage or safe synchronization. An independent plan validator needs those obligations.",
      "“The parallel implementation is … trivial to check … with no case list and no sampling.” A BigInt oracle checks concrete inputs. Universal validity requires proving merge and accumulator invariants. The prototype oracle also does not implement overflow to infinity outside its tested finite-sum range.",
      "“nvcc -O3 could in principle transform __fadd_rn(acc, __fmul_rn(a,b))” into a contracted operation. The explicit intrinsics carry a documented no-fusion guarantee. A disassembly check can test conformance to it. [CUDA Math API](https://docs.nvidia.com/cuda/cuda-math-api/cuda_math_api/group__CUDA__MATH__INTRINSIC__SINGLE.html)"
    ],
    "would_fund": "Fund the checked plan artifact and three initial plans, using staged layernorm as the first test. The extreme contrast between the two layernorm schedules gives the cost model a practical falsification case.",
    "notes": "Comparing speed at a fixed meaning is strong, and the definition also makes the cost of producing evidence visible. The copied CPU replay reproduced “3 of 60 trials against 47 of 60,” and I checked the evaluator’s rounding sites, the actual CUDA tolerance baseline and support for typed transformation ports."
  },
  {
    "doc": "doc-F",
    "scores": {
      "ingenuity": 7,
      "creativity": 6,
      "scientific_depth": 5,
      "evidence": 8,
      "correctness": 4,
      "grounding": 7,
      "padding": 4,
      "overall": 6
    },
    "best_ideas": [
      "Separate deviation caused by each evaluator from the candidate’s reference drift. “e_c(x) + e_o(x) + |Ref_c(x) − Ref_o(x)|.”",
      "Use the existing split as an explicit arithmetic tree the backend can schedule. “Evaluates inner sums concurrently and merges block partials sequentially in block order.”",
      "Measure reference portability at the precision where it matters. “Double transcendentals are not bit-portable.”"
    ],
    "novelty_check": [
      "Safe numerical optimization and roundoff certificates are established in Rosa, Daisy and FPTaylor. The experiment contributes a concrete origin/candidate decomposition and gate comparison on Tix IR. [Rosa](https://arxiv.org/abs/1410.0198), [Daisy](https://people.mpi-sws.org/~eva/papers/tacas18_daisy_toolpaper.pdf), [FPTaylor](https://soarlab.org/papers/2018_toplas_sbbjrg.pdf), [Herbie](https://herbie.uwplse.org/pldi15-paper.pdf)",
      "Parallel schedules for a declared computation and fusion are established. The particular split-tree-to-target experiment gives the existing Tix pass a plausible backend use. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Tensor Comprehensions](https://arxiv.org/abs/1802.04730), [FlashAttention](https://arxiv.org/abs/2205.14135)",
      "Target-side differential execution has prior art in floating-point crosschecking. Compiling both sides into one Tix batch is practical integration work, with the f64 libm comparison supplying additional evidence. [Symbolic Crosschecking of Floating-Point and SIMD Code](https://srg.doc.ic.ac.uk/files/papers/kleefp-eurosys-11.pdf), [NVIDIA floating-point documentation](https://docs.nvidia.com/cuda/floating-point/index.html)"
    ],
    "errors": [
      "“The certified bound is sound.” The analyzer returns zero error for every literal while `evaluate.ts` uses the full `Number` value in f64 mode. A legal output literal `0.1` has a gap of about 1.49e−9 despite the zero bound. The prototype also does not generally mark subnormal arithmetic unbounded as described.",
      "“Same libm … so libm error cancels.” The input to libm can differ between sides. A proof needs enclosures for the actual implementation and arguments, as well as outward rounding and treatment of the reference’s binary64 operations.",
      "“Exact semantic-difference term … zero for true reassociations.” Reassociations can change binary64 evaluation too, as the document’s own roughly 10⁻¹⁶ observations show. A computed difference on a case gives evidence for that case, while a structural check can establish preservation of the term set.",
      "“Mutants with real semantic changes are caught exactly.” The softmax transpose survives all listed gates and changes output values. The document establishes that the change is small under its chosen data and metric.",
      "“Splitting a sum provably shrinks the worst-case bound … by about the block width.” Both levels contribute to path depth. The approximation needs a sufficiently large K relative to the block width and does not extend directly to fused chains.",
      "“What is missing is … a ‘reference executor’ port.” A domain-defined heterogeneous invariant can already carry additional artifact ports, and batched `decide` has access to both inputs and cases. A compiled reference may require domain cache work, with no new framework port kind.",
      "“Checking at the sizes users actually run costs a fraction of the run itself.” The reported 1.60 ms reference is about 7.5× the 0.214 ms baseline kernel. The 781 s figure comes from the Stage 2 f32 interpreter measurement, and full-size f64 GPU agreement with Node was only cross-checked on a small case."
    ],
    "would_fund": "Fund checked lowering of the existing split tree with fixed inner folds and an ordered merge. The GPU experiments establish a plausible fast path, and a full-size comparison to an independently validated f32 reference is the next test.",
    "notes": "Verified numerics at a stated fraction of vendor speed is a good objective, but “certified per-element bounds” overstates the current prototype’s central guarantee. I checked literal rounding, the hard-coded split width and the batched invariant API, and the GPU results remain useful when their sampled equivalence scope is retained."
  },
  {
    "doc": "doc-G",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 9,
      "evidence": 9,
      "correctness": 9,
      "grounding": 10,
      "padding": 2,
      "overall": 9
    },
    "best_ideas": [
      "Prove exact ordered-f32 contraction over a conditional integer grid. “Every sequential partial sum is exact by induction.”",
      "Generate CUDA from a schedule that proves row ownership and visibility. “Each producer is available with the correct coordinate before its consumer executes.”",
      "Use proof provenance to avoid scanning and packing on every call. “A device allocation, slice, layout and write epoch.”"
    ],
    "novelty_check": [
      "Row residency and online normalization are established. Automatic binder-aware ownership and preservation of the particular Tix fold, with generated execution and an executable fallback, are the local contributions. [Triton softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Online Normalizer Calculation](https://arxiv.org/abs/1805.02867), [FlashAttention](https://proceedings.neurips.cc/paper_files/paper/2022/hash/67d57c32e20fd0a7a302cb81d36e40d5-Abstract-Conference.html)",
      "Halide validation, verified affine scheduling, GPUVerify and VeriTile cover substantial parts of the proof idea. The contribution is a small checker actually exercised as a v6 postcondition, followed by CUDA generated from the accepted phases. [Formal Halide semantics](https://arxiv.org/abs/2210.15740), [Li, Liang and Feng](https://plax-lab.github.io/publications/polyhedral/index.html), [GPUVerify](https://www.doc.ic.ac.uk/~afd/papers/2012/OOPSLA.pdf), [VeriTile proof coverage](https://veriinfra-lab.github.io/VeriTile/proofs/coverage/)",
      "Integer MMA for floating-point emulation has direct prior art in Ozaki-style slicing. The useful distinction is a checked condition that all ordered source partials are already representable, combined with a measurement that rejects fresh packing as the default. [Ootomo, Ozaki and Yokota](https://arxiv.org/abs/2306.11975), [Abdelfattah et al.](https://arxiv.org/abs/2506.11277), [PTX MMA semantics](https://docs.nvidia.com/cuda/archive/13.0.0/parallel-thread-execution/index.html#warp-level-matrix-instructions-mma)",
      "The one-shot carry validation is explicitly credited as a subset of Kapre and DeHon. Its contribution is the negative result on the Tix-like input distributions. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)"
    ],
    "errors": [
      "“A stage-2 split sum, if accepted upstream.” `split-sum` is a Stage 1 native rewrite. Stage 2 consumes the tree already selected by the caller."
    ],
    "would_fund": "Fund the row schedule and its existing verifier as one change. It has generated speedups, 16 rejected certificate mutants and a fallback bug that demonstrates the separate value of executable checks.",
    "notes": "The ordered and application boards define a good comparison, with a precise distinction between semantic assurance and competitive speed. The repository confirms current-f64 lowering, permissive `assuranceOf` behavior and typed `proofVerifier` support, and “a static v6 program revision by itself cannot attest mutable device values” captures the central boundary."
  },
  {
    "doc": "doc-H",
    "scores": {
      "ingenuity": 5,
      "creativity": 4,
      "scientific_depth": 4,
      "evidence": 7,
      "correctness": 4,
      "grounding": 6,
      "padding": 4,
      "overall": 5
    },
    "best_ideas": [
      "Account for accuracy on both sides of a rewrite. “Record budget consumed by origin and candidate, and be able to require improvement.”",
      "Test the real pass gate with a candidate the validator can represent but the evaluator misinterprets. “The address stride (B) and the fold extent (4) disagreed.”",
      "Measure the cost of GPU-side reference work. “The same computation with a compensated … or f64 shadow.”"
    ],
    "novelty_check": [
      "“Shared-memory tiles, thread-coarsened register accumulation” are classical scheduling, with a Tix-specific exact comparison. The measurements are the contribution. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Triton](https://www.eecs.harvard.edu/~htk/publication/2019-mapl-tillet-kung-cox.pdf), [Ansor](https://www.usenix.org/conference/osdi20/presentation/zheng)",
      "“C·γ … computed at the gate’s actual shapes” adapts classical error bounds to a Tix gate. Error-controlled optimization has prior art and the proposed composition remains unproved. [Higham](https://epubs.siam.org/doi/book/10.1137/1.9780898718027), [Rosa](https://arxiv.org/abs/1410.0198)",
      "Compensation and independent error estimates are established. “A certificate bounds the candidate against its own inputs” is the intended addition, but the supplied shadow timing does not build that certificate. [Ogita, Rump and Oishi](https://epubs.siam.org/doi/10.1137/030601818), [Numerical crosschecking](https://srg.doc.ic.ac.uk/files/papers/kleefp-eurosys-11.pdf)",
      "Parameterized reduction trees are standard. The actual failed width-B pass identifies the concrete Tix schema limitation and makes this a well-grounded enabling change.",
      "Budgeted tensor-core emulation inherits its main mechanism from Ootomo and Yokota and NVIDIA. The Tix integration is deferred and has no tensor-core experiment in this ticket. [Ootomo and Yokota](https://arxiv.org/abs/2203.03341), [NVIDIA emulation](https://developer.nvidia.com/blog/unlocking-tensor-core-performance-with-floating-point-emulation-in-cublas/)"
    ],
    "errors": [
      "“Kahan compensation captures the exact rounding error of each fold.” Ordinary Kahan does not supply an exact result or a certified interval. For binary32 inputs `[f32(1e20), 1, f32(-1e20)]`, it can produce zero while the exact sum is one. The reported overhead is for the shadow variant, without a proved enclosure or checked end-to-end verdict.",
      "“Sequential returns exactly 1 on the 1+1023·2⁻⁴ row.” The actual witness uses 2⁻²⁴. Its f64 value is 1.0000609755516052, the sequential result is 1, and the copied arithmetic gives a width-4 error of about 1.79e−7, versus the diary’s “1.8e-10 error.”",
      "“The CUDA-core f32 roof … sits near where the register-blocked kernel already is.” The 3.1 TFLOP/s result establishes one tile’s throughput, not a hardware roof. The claim that the next factor requires tensor cores does not follow.",
      "“Demmel–Nguyen and Ahrens–Demmel–Nguyen build with fixed trees and binned accumulators.” Their binned reproducibility result is designed to be independent of the reduction tree. A fixed floating-point tree supplies a narrower reproducibility guarantee. [Demmel and Nguyen](https://www.acsel-lab.com/arithmetic/arith21/papers/p54.pdf), [Ahrens et al.](https://willowahrens.net/assets/documents/ahrens_algorithms_2020.pdf)",
      "“The gate … at dims ≤ 7” describes the usual assignments to shape symbols, not every actual extent or fold length. “Both interpreters and the GPU lowering agree bit for bit” also conflates f32 and f64 evaluation.",
      "“The same computation with a compensated … shadow” alone does not certify error against the origin. The bound for rounded terms needs to include product error when compared to f64 products, and fused consumers need propagation through variance, square root and division.",
      "“cuBLAS itself now runs ‘FP32’ GEMMs … via BF16x9” states an available configured mode as a blanket behavior. The vendor source does not establish BF16x9 use in the coordinator’s benchmark. [cuBLAS compute modes](https://docs.nvidia.com/cuda/cublas/index.html)"
    ],
    "would_fund": "Fund exact-locality tiling first. The bit comparison gives it direct support and its correctness does not depend on the proposed Kahan certificate or a new language policy.",
    "notes": "“Verified at full scale, on the GPU, for a cost the kernel itself already pays” is a good target with a missing assurance and cost demonstration. I confirmed the width-four extent rule, the actual f64 CUDA comparator and the numerical failure of the claimed exact Kahan shadow."
  },
  {
    "doc": "doc-I",
    "scores": {
      "ingenuity": 10,
      "creativity": 9,
      "scientific_depth": 10,
      "evidence": 10,
      "correctness": 10,
      "grounding": 9,
      "padding": 1,
      "overall": 10
    },
    "best_ideas": [
      "Fit the discrete executable coefficient and produce a decisive conflict witness. “Two actual constraints cross.”",
      "Audit the exact scalar entry point used by the timed executable against independent Node streams. “The timed tensor kernel and a separate audit kernel call that function.”",
      "Use two guarded trajectories for local ordered-fold transfer. “Two adjacent predicted seeds suffice to represent both parities.”"
    ],
    "novelty_check": [
      "Tang supplies the table-and-polynomial structure and RLIBM supplies rounded-output constraints. The distinctive work is monotone intersection over binary64 table words for the actual device instruction sequence, with two-input infeasibility witnesses and per-executable independent qualification. [Tang](https://doi.org/10.1145/63522.214389), [RLIBM-32](https://arxiv.org/abs/2104.04043), [NVIDIA floating-point documentation](https://docs.nvidia.com/cuda/floating-point/index.html)",
      "Resident-row softmax and checked scheduling have direct precedents. The binder-identity match, argument-domain discharge and escaped-temporary rejection connect that scheduling to the exact scalar receipt in Tix. [Triton](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Exo](https://www.cs.cornell.edu/~yuka/pdf/exo_pldi2022_full.pdf)",
      "Kapre and DeHon already preserve sequential results with speculation and correction, and symbolic chunk summaries also predate the ticket. I found no matching two-trajectory, same-binade translation guard with explicit boundary and parity falsifiers. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf), [Raychev et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Reproducible summation](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-121.html)"
    ],
    "errors": [],
    "would_fund": "Fund the checked row template with the qualified exponential as its first specialized scalar component. The 4.25× paired softmax result, independent qualification and 1.38× attention integration give it a direct path to a compiler feature.",
    "notes": "Time to a reproducible answer from the current revision is a good, testable definition with explicit room for unsupported programs and devices. I checked binder-based matching, the current-f64 invariant and compiled-receipt identity, and “the actual GPU code in the experiment is a trusted handwritten template” states the remaining integration gap accurately."
  },
  {
    "doc": "doc-J",
    "scores": {
      "ingenuity": 6,
      "creativity": 5,
      "scientific_depth": 5,
      "evidence": 7,
      "correctness": 4,
      "grounding": 7,
      "padding": 5,
      "overall": 6
    },
    "best_ideas": [
      "Measure the optimized revision’s time and numerical deviation together. “0.312 ms vs 0.214 ms original.”",
      "Use a widened emitter profile to check deployment-size cases. “The oracle is just the lowering run in a different precision.”",
      "Stage expensive scalar work before an ordered carry. “Stage e in shared memory in parallel, fold only the adds.”"
    ],
    "novelty_check": [
      "“Emit a shared-memory tiled kernel with register blocking” and staged row fusion are established mechanisms. The good contributions are the two negative controls and paired exact controls. Halide also has close translation-validation prior art. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Triton](https://www.eecs.harvard.edu/~htk/publication/2019-mapl-tillet-kung-cox.pdf), [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf)",
      "Compiler use of verified numerical budgets predates this design. The exact-real summation study and deployment-scale width-four result are useful Tix-specific evidence. [Rosa](https://arxiv.org/abs/1410.0198), [FPTaylor](https://soarlab.org/papers/2018_toplas_sbbjrg.pdf), [Satire](https://arxiv.org/abs/2004.11960), [Herbie](https://herbie.uwplse.org/pldi15-paper.pdf), [Ogita, Rump and Oishi](https://epubs.siam.org/doi/10.1137/030601818), [Ahrens et al.](https://willowahrens.net/assets/documents/ahrens_algorithms_2020.pdf)",
      "A target-side oracle sharing code with the implementation is a useful Tix engineering experiment. Prior crosschecking literature also shows the value of an independently implemented path for detecting shared emitter defects. [Symbolic Crosschecking](https://srg.doc.ic.ac.uk/files/papers/kleefp-eurosys-11.pdf)"
    ],
    "errors": [
      "“What the split gate actually compares (|blocked − sequential|).” `meaningGate` compares the candidate f32 result to the origin’s f64 evaluation. The copied CPU replay reproduced 49/50 for the proxy quantity, which cannot be presented as 49/50 failures of the shipped relation.",
      "“Three of six corpus programs violate … attention 15,552.” The diary says attention also had a maximum budget fraction of 0.0564. Those observations cannot describe the same finite comparisons. No nonfinite witnesses are supplied to explain the count. Moreover, the replay’s finite-reference branch fails to reject a NaN candidate as the actual comparator does.",
      "“Certified forward error … Kahan / two-sum … independent of n.” The leading-order Kahan term omits higher-order terms, and TwoSum is a different primitive. The f64 accumulator entry also needs binary64 accumulation error and a final binary32 rounding term. A magnitude class and theorem preconditions must precede certification. [Higham](https://epubs.siam.org/doi/book/10.1137/1.9780898718027), [Ogita, Rump and Oishi](https://epubs.siam.org/doi/10.1137/030601818)",
      "“CUDA’s libm and V8’s differ by at most 2.15 ulp.” The program compares final tensor outputs and divides error by `abs(reference)·2^-52`, which is not exact local ULP spacing. It neither measures a per-intrinsic bound nor proves how discrepancies propagate.",
      "“The same emitter” is a reproducible shortcut with a common failure mode. The “literal words mapped back to full-precision doubles” map also cannot distinguish two source literals rounded to the same f32 word. A general f64 oracle needs an IR-driven, occurrence-preserving emitter.",
      "“The oracle … costs ~7–11 s wall each” conflicts with the same experiment’s 4.8–10.7 s wall entries. “The gate … saw only ≤ 7-term sums” also omits fixed or compound extents such as convolution’s channel-by-3-by-3 fold.",
      "“A 1024-deep dependency chain containing a transcendental per link.” Each exp operand is independent of the accumulated denominator. The slow prototype serializes their execution through the thread mapping, rather than through the mathematical carry dependency."
    ],
    "would_fund": "Fund checked ordered tiling. The measured 512³ performance is strong, and the proposed exact comparator can use an independent reference without relying on the disputed f64 audit result.",
    "notes": "Deployment-scale trustworthy speed is a good definition, but the document calls “static error ≤ budget … for ALL inputs” an intended gate before it has a sound general certificate. The CPU replay reproduced the summation statistics, and checks of the live tolerance formula, attention arithmetic and oracle literal conversion narrowed which conclusions follow."
  },
  {
    "doc": "doc-K",
    "scores": {
      "ingenuity": 10,
      "creativity": 9,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 7,
      "grounding": 8,
      "padding": 2,
      "overall": 8
    },
    "best_ideas": [
      "Represent an ordered chunk by parity-dependent translations and a validity window. “S → S + D[S mod 2].”",
      "Validate legal regrouping by applying the inverse rewrite. “This proves the candidate adds the same terms.”",
      "Show why passing sampled shapes can conceal a real wrong-axis rewrite. “D and O in mlp” are equal in every native gate case."
    ],
    "novelty_check": [
      "Kapre and DeHon already recover the ordered floating-point result with iterative correction. Raychev and Mytkowicz establish chunk transfer summaries and composition. I found no matching two-parity closed-form summary with a checked binade window. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf), [Raychev et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Mytkowicz et al.](https://www.microsoft.com/en-us/research/publication/data-parallel-finite-state-machines/)",
      "Affine equivalence checking and schedule validation predate the normalizer. The useful contribution is the small inverse split rule, exercised against the real Tix pass and concrete extent-alias mutant. [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [Translation Validation](https://link.springer.com/chapter/10.1007/BFb0054170), [Higham](https://epubs.siam.org/doi/10.1137/0914050)",
      "Ordered tiling follows known schedule separation, with RepDL a close result-level comparator and Exo an antecedent for checked transforms. The paired GB10 timings quantify a useful supported subset. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Formal Halide semantics](https://arxiv.org/abs/2210.15740), [RepDL](https://arxiv.org/abs/2510.09180), [Exo](https://www.cs.cornell.edu/~yuka/pdf/exo_pldi2022_full.pdf), [cuBLAS](https://docs.nvidia.com/cuda/cublas/index.html#results-reproducibility)"
    ],
    "errors": [
      "“Equal normal forms imply equal bits for every shape and every in-domain input.” The implementation stores literal values as JSON numbers. It serializes +0 and −0 identically, although validated native literals can distinguish them. It should encode the actual words and verify the observable signature separately.",
      "“This bound holds for all inputs.” A relative gamma bound needs `(n−1)u < 1` and arithmetic-range assumptions. With finite `M` equal to the largest f32, the eight terms `[M,0,0,0,M,−M,−M,0]` give an infinite left fold and zero for width-four splitting. A local bound also needs propagation through consuming operations.",
      "“A correct split exceeded the fixed tolerance … by a factor of up to 2.49.” The experiment divides `|split−sequential|` by a budget scaled to the sequential result. It does not compare to the f64 origin as the shipped gate does.",
      "“A CPU vectorizer has to break the accumulator chain to use its SIMD lanes.” LLVM documents ordered vector reductions on some targets, and SIMD across independent outputs can preserve each chain. [LLVM vectorizer](https://llvm.org/docs/Vectorizers.html)",
      "“So cuBLAS itself uses different summation orders … and at one size its order is the in-order FMA fold.” A single matching output and other differing shapes identify observable behavior in those calls, not a unique implementation. The ticket itself records the single-input limit and unchecked cuBLAS status.",
      "“CheckResult evidence today is differential evidence.” Its actual field is `evidence?: unknown`, and the framework already has property proof verification. A typed evidence policy is useful, but the prototype need not add a new carrier."
    ],
    "would_fund": "Fund acceptance by structural proof, starting with the inline and split patterns and fixing the normal form’s word and signature encoding. It closes a demonstrated hole in the real gate at low measured cost.",
    "notes": "Speed at a specified result and explicit proof coverage make a good definition once the NaN observation and numerical preconditions are stated. The copied CPU replay reproduced “419,255 elements” of guess-binade drift, and I checked the shape-symbol alias, checked-pass evidence type and the canonicalization defect against the base code."
  }
]

1. **doc-I — 10/10.** The fitted exponential, independent executable audit and paired whole-program controls establish both a new mechanism and a credible path into Tix.
2. **doc-G — 9/10.** The generated row schedules and exercised v6 checker make the strongest implementation handoff, and the integer-routing experiments show exactly when the attractive alternative loses.
3. **doc-A — 9/10.** The broadest performance campaign combines qualified fast intrinsics with an actual planner, while the fingerprint and hardware-ceiling claims need narrower guarantees.
4. **doc-K — 8/10.** The parity transducer is the round’s strongest standalone reduction idea, with a measured niche and a valuable structural mutant despite holes in the proposed proof gate.
5. **doc-D — 7/10.** Exact fusion, paired relaxation measurements and a working inline checker make a useful agenda despite the mislabeled FMA control and certificate gaps.
6. **doc-E — 7/10.** The controlled GEMM comparisons and failed fusions give a practical schedule design, although several performance and validation claims exceed what the tests establish.
7. **doc-F — 6/10.** The explicit split-tree lowering and portability probe are valuable, while a simple literal counterexample defeats the leading certification claim.
8. **doc-C — 6/10.** The real lowering mutant and controlled scheduling comparisons motivate stronger checking, but the main certificate remains unbuilt and the scalar sweep double-counts its domain.
9. **doc-J — 6/10.** Strong exact kernel timings and a useful deployment-scale experiment are weakened by the contradictory attention result and the proxy used for the shipped split gate.
10. **doc-H — 5/10.** The tiling and width probes are actionable, while the leading full-scale certificate confuses inexpensive compensation with a rigorous error bound.
11. **doc-B — 5/10.** The real-gate audit and magnitude-program idea are worth retaining, but incorrect arithmetic, a misindexed control and excessive completeness claims undermine the proposed sequence.