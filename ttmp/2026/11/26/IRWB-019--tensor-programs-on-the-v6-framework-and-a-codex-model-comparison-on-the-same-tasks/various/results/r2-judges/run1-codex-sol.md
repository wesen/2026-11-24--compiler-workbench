[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 9,
      "creativity": 8,
      "scientific_depth": 7,
      "evidence": 8,
      "correctness": 5,
      "grounding": 7,
      "padding": 2,
      "overall": 7
    },
    "best_ideas": [
      "Represent an ordered f32 chunk as “a two-entry summary” indexed by incoming significand parity, with a validity window and local replay.",
      "Expose a blind spot in the real pass gate using “pairs of symbols that are equal in every sampled case.”",
      "Validate the structural part of reassociation by applying “the inverse of the declared rule” and comparing the resulting term tree."
    ],
    "novelty_check": [
      "The parity-indexed displacement and validity window appear original. Kapre and DeHon already recovered the sequential floating-point result by iterative repair, while SYMPLE and Data-Parallel Finite-State Machines already composed summaries of unknown incoming state. [Kapre and DeHon](https://ic.ese.upenn.edu/abstracts/fpaccum_arith2007.html), [SYMPLE](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Data-Parallel Finite-State Machines](https://www.microsoft.com/en-us/research/publication/data-parallel-finite-state-machines/)",
      "Canonical read-and-operation-tree comparison and inverse-rule checking are Tix applications of established equivalence validation. The missed close precedent is Clément and Cohen’s affine Halide validator, which reasons about storage mappings and symbolic value expressions. The shape-aliasing mutant is a concrete Tix contribution. [Shashidhar et al.](https://link.springer.com/chapter/10.1007/978-3-540-31985-6_15), [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [Higham on summation](https://epubs.siam.org/doi/10.1137/0914050)",
      "Halide and Exo establish schedule separation and checked scheduling. Yang et al. also measured the cost of fixing GPU reduction order and verified bit-equivalence between schedules. The new result here is the measured cost of Tix’s particular split-rounded fold on the GB10. [Halide](https://people.csail.mit.edu/jrk/halide-pldi13.pdf), [Formal Semantics for Halide](https://arxiv.org/abs/2210.15740), [Exo](https://www.cs.cornell.edu/~yuka/pdf/exo_pldi2022_full.pdf), [Yang et al.](https://arxiv.org/abs/2609.11356)"
    ],
    "errors": [
      "“Tix defines every bit of its f32 result” and “the same on the interpreter, on this GPU, and on the next one” overstate the current contract. Stage 2 records distinct NaN words for sqrt(-2^-149), and the evaluator delegates transcendentals to implementation-approximated JavaScript functions. Define the NaN observation and pin the reference profile before claiming portability. [ECMAScript Math.exp](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.exp)",
      "“The check is sound and incomplete” fails for the supplied normalizer. It serializes rounded literals as JSON numbers, collapsing native-IR literal texts `0` and `-0`, both accepted by `src/tensor/ir.ts`. A local check returned identical JSON and distinct f32 words, `00000000` and `80000000`. Encode literal words and check the interface explicitly. “Giving up the algebra makes equivalence decidable by normalization” also overstates a sufficient structural test as a decision procedure for semantic equivalence.",
      "“This bound holds for all inputs” omits the finite-arithmetic and `(n−1)u < 1` hypotheses. With M equal to the largest finite f32, the ordered fold of `[-M,0,0,0,M,M,-M,-M]` returns `-M`, while the actual width-four split returns infinity. A valid bound at a reassociation site also needs propagation through downstream operations before it can bound the returned tensor. [Higham on summation](https://epubs.siam.org/doi/10.1137/0914050)",
      "“A correct split exceeded the fixed tolerance ... by a factor of up to 2.49” refers to a comparison against the sequential f32 fold. The real split gate compares against the f64 origin. Recomputing the same seeded trials gave 2.488 against f32 and 0.9985 against f64, so this experiment does not establish the claimed false rejection.",
      "“If the exact value of `s + x` has magnitude in `[2^e, 2^(e+1)]`” includes the overflow boundary of the top binade. The largest finite f32 plus `2^104` rounds to infinity. State the lemma on the signed interior with the endpoint rules made explicit. The prototype’s conservative window already excludes this case.",
      "“A CPU vectorizer has to break the accumulator chain to use its SIMD lanes” is too broad. LLVM supports ordered vector reductions on targets including AArch64 and RISC-V, with limited vectorization and usually lower performance. [LLVM Vectorizers](https://llvm.org/docs/Vectorizers.html)",
      "“At one size its order is the in-order FMA fold” goes beyond one tested input. The retained receipt establishes agreement on that input at 4096³, and the harness does not check the SGEMM return status. Different accumulation orders can be distinguished with purpose-built probes. [FPRev](https://arxiv.org/abs/2411.00442)"
    ],
    "would_fund": "Fund the structural gate for `inline` first, with word-preserving literal encoding and the existing signature check. The demonstrated shape-aliasing mutant gives it an immediate acceptance test, and the narrow checker can ship independently of a new GPU artifact.",
    "notes": "Price of exactness and proof coverage make a good competitive definition once the observation and reference profile are explicit, and the long-fold speedup gives the plan a distinctive research result despite its losses at corpus shapes. Padding is low, with occasional framing that repeats the preceding comparison, such as “Speed alone is the wrong target.”"
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 8,
      "evidence": 7,
      "correctness": 8,
      "grounding": 9,
      "padding": 2,
      "overall": 8
    },
    "best_ideas": [
      "Prove when integer tensor cores return the existing ordered f32 dot using “a one-grid theorem” and a bound on every partial sum.",
      "Make reuse depend on “a device allocation, slice, layout and write epoch,” so packed-data evidence follows the actual operands.",
      "Check a row schedule against “the producer’s actual row coordinate,” with independent coverage, barrier and recurrence obligations."
    ],
    "novelty_check": [
      "Row residency, cooperative reductions and fusion are established. The contribution is deriving ownership from resolved index maps and permitting reorder by operation, demonstrated by generated normalization kernels. The attention discussion correctly distinguishes online normalization from preserving Tix’s rounded denominator and value fold. [Triton softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Online Normalizer](https://arxiv.org/abs/1805.02867), [FlashAttention](https://proceedings.neurips.cc/paper_files/paper/2022/hash/67d57c32e20fd0a7a302cb81d36e40d5-Abstract-Conference.html), [CUDA synchronization](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-c-programming-guide/index.html#synchronization-functions)",
      "The separation of abstract schedule verification from executable conformance is credible. In addition to the cited verified affine scheduling work, GPUVerify and VeriTile, the design misses Clément and Cohen’s validation across Halide scheduling and storage changes and Yang et al.’s compiled GPU bit-equivalence checks. Tix’s restricted phase checker and revision binding remain distinct engineering contributions. [Li, Liang and Feng](https://plax-lab.github.io/publications/polyhedral/index.html), [GPUVerify](https://www.doc.ic.ac.uk/~afd/papers/2012/OOPSLA.pdf), [VeriTile](https://veriinfra-lab.github.io/VeriTile/proofs/coverage/), [Clément and Cohen](https://storage.googleapis.com/gweb-research2023-media/pubtools/6569.pdf), [Yang et al.](https://arxiv.org/abs/2609.11356)",
      "Integer MMA on scaled floating-point data has direct prior art in Ozaki-style slicing. I found no matching result that uses this per-dot f32 representability proof to preserve an existing left fold and makes a checked, reusable packed operand the dispatch condition. The documented signed integer MMA types support the proposed computation. [Ootomo, Ozaki and Yokota](https://arxiv.org/abs/2306.11975), [Abdelfattah et al.](https://arxiv.org/abs/2506.11277), [PTX MMA](https://docs.nvidia.com/cuda/archive/13.0.0/parallel-thread-execution/index.html#warp-level-matrix-instructions-mma)",
      "The one-shot carry experiment acknowledges Kapre and DeHon’s prior art and adds a useful negative result about Tix softmax distributions. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)"
    ],
    "errors": [
      "“It rejects stale revisions, verifies operation and index identity” describes a checker that is broader than its emitter. The verifier accepts scalar shape expressions without restricting their symbols, while the emitter only handles the first input’s row and column symbols. A valid `y[i,j] = x[i,j] + T` with T bound by an additional `f32[T]` parameter can pass the verifier and fail emission with `Unemittable shape T`. Match the two domains or dispatch to the fallback at emission.",
      "“One full pass out of 4,608 chunk proposals” misidentifies the unit. One full pass means every boundary checked out for one row and chunk-width configuration. The denominator counts row-and-width configurations, each containing multiple individual chunk proposals.",
      "“Raw logs retain events, runner hashes, exit status and word counts” describes records absent from the supplied pack. The cited `scripts/results/*.jsonl` files are missing, including the generated-row timings and integer ablations. The scripts and diary remain available, but the raw timings and proof receipts could not be checked from the pack."
    ],
    "would_fund": "Fund the checked row schedule and emitter for softmax and layernorm together. The prototype already exercises the v6 postcondition and a real fallback, and the reported ablations isolate which scheduling changes are worth carrying into production.",
    "notes": "Auditable ordered execution is a good definition, and the two leaderboards distinguish a comparable exact baseline from an application-performance comparison while the INT8 experiments show why provenance must pay for itself. Padding is low, with some repeated assurance language such as “The current manager’s `checked` means a checker ran.”"
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 8,
      "creativity": 8,
      "scientific_depth": 6,
      "evidence": 8,
      "correctness": 4,
      "grounding": 7,
      "padding": 3,
      "overall": 6
    },
    "best_ideas": [
      "Instantiate “the same kernel source” at a symbolic scalar type to exercise actual tiled control flow and detect changes to rounded operation trees.",
      "Derive adversarial shapes from tile residues after “my first tile-aware recipe missed two” tail mutants.",
      "Qualify guarded float-float transcendental fast paths against “the language meaning,” with an exhaustive sweep that exposed a defect in tanh’s division correction."
    ],
    "novelty_check": [
      "The automated split between row fusion and ordered contraction tiles is valuable on this corpus. Bit-preserving schedule search and the idea of pinning order for invariance have direct precedents the design understates, particularly Yang et al.’s bit-equivalence-constrained Triton tuning. [Boehm’s CUDA GEMM worklog](https://siboehm.com/articles/22/CUDA-MMM), [Thinking Machines batch invariance](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [LLM-42](https://arxiv.org/html/2601.17768v2), [Yang et al.](https://arxiv.org/abs/2609.11356)",
      "Ziv, CORE-MATH and RLIBM establish rounding tests and exhaustive binary32 qualification. The design misses LLVM libc’s October 2026 float-only, correctly rounded GPU expf implementation and benchmark. Pinning the result to Tix’s executable reference and testing the tanh composition are separate contributions. [Ziv](https://research.ibm.com/publications/fast-evaluation-of-elementary-mathematical-functions-with-correctly-rounded-last-bit), [CORE-MATH](https://core-math.gitlabpages.inria.fr/), [RLIBM-32](https://arxiv.org/abs/2104.04043), [LLVM libc GPU expf](https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libc/%2B/7b6975394c0595cadda988bf8c50f8567f62ee42)",
      "Translation validation and hash-based reasoning about tensor reductions have prior art. I found no matching implementation that executes a CUDA kernel’s templated control flow with a word-sensitive symbolic scalar on the GPU. The particular residue-mutant campaign is a contribution as testing, independent of the proposed small-model theorem. [Pnueli et al.](https://link.springer.com/chapter/10.1007/BFb0054170), [Necula](https://people.eecs.berkeley.edu/~necula/Papers/tv_pldi00.pdf), [mlir-tv](https://link.springer.com/chapter/10.1007/978-3-031-13188-2_19)",
      "Named rounded computation graphs, FMA emulation, fixed split sizes and identifying cuBLAS accumulation orders all have precedents. The GB10 SGEMM observation and the constructed JavaScript midpoint tests are useful specific results. I found no matching prior formulation of the proposed origin-relative norm plus half-ULP floor. [RepDL](https://arxiv.org/html/2510.09180v1), [Boldo and Melquiond](https://guillaume.melquiond.fr/doc/08-tc.pdf), [Thinking Machines fixed splits](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/), [FPRev](https://arxiv.org/abs/2411.00442)"
    ],
    "errors": [
      "“Batch invariance is a theorem of the Tix meaning” and “never on the extents of free axes” are false as general claims. The parser and evaluator support shape symbols as scalar expressions. For `y[i,j] = x[i,j] + M`, the same input word 10 yields 11 or 12 as M changes from 1 to 2. Require a proof that the observed row’s operands, scalar shape dependencies and reduction domains are invariant.",
      "“Identical across devices” and “does not depend on ... interpreter” require a portable numerical reference. The tested Node and CUDA profiles agree on the stated cases, while ECMAScript permits implementation-approximated transcendental results. [ECMAScript Math.exp](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-math.exp)",
      "“No implementation of the current meaning can exceed 14.39 TFLOP/s” and “compute-bound contractions pay at most 2×” turn a measured SIMT instruction mix into universal bounds. That probe is a useful denominator for the tested implementation family. Algorithms that prove exactness on a narrower operand domain can use other execution units, and a two-instruction count alone gives no upper bound on a kernel’s slowdown.",
      "“No schedule can parallelize it” is only true of directly executing that serial instruction chain. Exact sequential accumulation was parallelized by Kapre and DeHon. The benchmark establishes the cost of the tested owner schedule, not a lower bound on all sequential-equivalent algorithms. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf)",
      "“Up to a 2^-64 collision probability per comparison” and “negligible for n < 10^9” are unsupported for the fixed, deterministic mixer in the scripts. Even ideal independent 64-bit hashes give about a 2.67% probability of some collision among one billion distinct terms. A matching fingerprint is evidence about the symbolic instantiation, and does not validate float-specific code generation. Use canonical terms for proof or specify a randomized model and report probabilistic assurance.",
      "“Every extent r, T + r and 2T + r for r = 0…T−1” differs from the implementation, which uses 1 through 3T and omits zero. R1 also omits the all-zero assignment in `cudaCases`. A branch at 3T or a joint residue condition is enough to defeat the proposed extrapolation absent additional restrictions.",
      "“The exhaustive run also calibrates the error bound E” confuses observed output agreement with validation of the approximation-error bound. Enumeration qualifies the tested output mapping. It does not show that intermediate error stays inside E. Also, the standalone qualification does not enumerate the separately compiled planner and fused binaries, despite the design’s own binary-specific qualification rule.",
      "“The worst case equals Stage 2’s cost, never worse” omits the work already done by the fast path before an undecided warp executes the double fallback. “Outside (−87, 88.5), where results are subnormal or overflow” also overstates the cutoff. For example, exp(−87.1) still rounds to a normal f32.",
      "“Bit-compatible with cuBLAS where cuBLAS runs at full speed” extrapolates from one seeded 4096³ input. The direct result establishes agreement for that experiment. It does not identify the implementation for every input, shape or profile. [cuBLAS reproducibility](https://docs.nvidia.com/cuda/cublas/index.html#results-reproducibility), [FPRev](https://arxiv.org/abs/2411.00442)",
      "“Linear programs are homogeneous” does not justify covariance for the scaled corpus. Softmax, GELU and layernorm are not homogeneous, and scaling both operands of a matrix product changes scale quadratically. The comparator also needs a finite-domain condition or explicit nonfinite comparisons. In the script an infinite ULP floor can produce a NaN ratio, which never satisfies `ratio > K_NORM`. Higham and Mary’s probabilistic bounds do not explain this ticket’s observed relative ratios without establishing their assumptions. [Higham and Mary](https://eprints.maths.manchester.ac.uk/2731/)",
      "“Attention: three kernels” omits the transpose launch inside the timed sequence in `03-fused/fused.cuh`. The timing covers four launches. “Equalled its tree oracle in 0 words” should read zero differing words.",
      "“Their outputs are in `scripts/results/`” overstates the supplied evidence. The standalone JSON results are present, but the cited JSONL for the corpus-wide benchmark, accuracy relation, row generator and planner, including the interpreter comparison, is missing."
    ],
    "would_fund": "Fund the exact scheduling planner, starting with its row and ordered-contraction templates. It has the broadest reported compiler-generated performance gain in the pack, and the first implementation can use explicit legality checks and practical f32 conformance tests while the fingerprint assurance is repaired.",
    "notes": "Fast execution of a specified observation is a good goal, and the five-program planner is a meaningful advance, but the plan promotes several measurements and conditional arguments into guarantees before their premises are established. Padding is modest for the breadth, with repetition such as “The sequential-fold wall and K-only chunk trees” appearing again after the summary and proposal discussion."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 9,
      "creativity": 9,
      "scientific_depth": 9,
      "evidence": 9,
      "correctness": 9,
      "grounding": 9,
      "padding": 1,
      "overall": 9
    },
    "best_ideas": [
      "Find an exact table coefficient by intersecting discrete constraints, or return “two source-level f32 inputs demonstrating why that table family cannot work.”",
      "Derive a scalar qualification domain from “lexical binder identities” and audit the out-of-line routine shared by the timed kernel and the enumerator.",
      "Translate an ordered chunk trace by an even number of grid steps, using “its minimum and maximum raw word along the entire path” as the guard."
    ],
    "novelty_check": [
      "Tang supplies table-driven exponential and RLIBM supplies synthesis from rounding intervals. LLVM libc also supplies a missed fast GPU expf comparison under a mathematical rounding contract. I found no close precedent for this combination of a Node-word oracle, intersections over the actual binary64 table words of a fixed CUDA evaluation sequence, and pairs of source inputs certifying an empty intersection. [Tang](https://doi.org/10.1145/63522.214389), [RLIBM-32](https://arxiv.org/abs/2104.04043), [NVIDIA floating-point guide](https://docs.nvidia.com/cuda/floating-point/index.html), [LLVM libc GPU expf](https://chromium.googlesource.com/external/github.com/llvm/llvm-project/libc/%2B/7b6975394c0595cadda988bf8c50f8567f62ee42)",
      "Resident-row softmax and checked loop scheduling have prior art, which the design acknowledges. The Tix-specific result is recognizing a region by binder and escape checks and using the resulting argument-domain fact to reuse scalar evidence inside attention. [Triton softmax](https://triton-lang.org/main/getting-started/tutorials/02-fused-softmax.html), [Exo](https://www.cs.cornell.edu/~yuka/pdf/exo_pldi2022_full.pdf)",
      "Kapre and DeHon previously achieved sequential-equivalent optimistic accumulation, and symbolic chunk summaries predate Tix. Demmel, Ahrens and Nguyen establish a different, order-independent result. I found no matching adjacent-seed, path-extrema certificate with the direction-aware binade-boundary refinement. [Kapre and DeHon](https://nachiket.github.io/publications/fp-accum_arith-2007.pdf), [SYMPLE](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/143-raychev.pdf), [Demmel, Ahrens and Nguyen](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2016/EECS-2016-121.html)"
    ],
    "errors": [
      "“The stored receipts support review without GPU access” is only partly true of the supplied pack. The retained JSON lets an offline check confirm all three scalar partitions for each executable and the two independent attention results. The softmax public-evaluator JSONL files required by `14-verify-receipts.mjs`, and the cited JSONL for the lowering mutants and v6 gate, are absent. The complete offline replay requires those records."
    ],
    "would_fund": "Fund the domain-qualified exponential fitter and executable audit, using the ordered row owner as its first integration. The matched streaming control, independent oracle and counterexamples to smaller table families make the choice testable, and the attention experiment demonstrates reuse across two programs.",
    "notes": "Time to a reproducible source answer is a strong definition because it names the reference, assurance scope, check cost and competitive latency control, and the plan makes substantial progress on that first domain. Padding is minimal, with a little repeated boundary-setting such as “No cross-vendor performance record is claimed.”"
  }
]

1. **doc-D** — The fitted exponential and independent executable audit provide the strongest combination of original mechanism, falsification and measured benefit.
2. **doc-B** — The checked row emitter offers the clearest path into the current compiler, and its stronger control correctly demotes fresh INT8 packing.
3. **doc-A** — The binade summary delivers the most distinctive ordered-fold result, while the proposed proof gate needs repairs and the fast fold has limited corpus applicability.
4. **doc-C** — The planner has the widest reported coverage, but its portability, throughput and fingerprint guarantees exceed what the experiments establish.