```json
[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 7,
      "evidence": 7,
      "correctness": 7,
      "grounding": 8,
      "padding": 2,
      "overall": 7
    },
    "best_ideas": [
      "Binade parity transducer: inside one binade a rounded add is an integer add that depends on the accumulator only through its parity, so a chunk has a two-entry composable summary: \"a rounded addition is an integer addition whose only dependence on the accumulator is its parity. A chunk of the input therefore has a two-entry summary.\"",
      "Equivalence by normalization, because the exact meaning drops real-number algebra: \"Giving up the algebra makes equivalence decidable by normalization.\" A 60-line normalizer proves inline on all six programs and rejects a mutant the merged sampled gate accepts.",
      "Accept reassociating passes by an inverse-rule proof plus a theorem-derived budget instead of a fixed tolerance: \"Apply the inverse of the declared rule to the candidate ... and compare normal forms with the original\", with the budget \"2·γ(n-1)·Σ|t|\"."
    ],
    "novelty_check": [
      "Parity transducer (claimed new): related but distinct. Kapre & DeHon, ARITH 2007, reach the same goal by iterative error propagation with no chunk summary. Mytkowicz et al., ASPLOS 2014, enumerate start states (this summary is a two-state instance), and Raychev et al., SOSP 2015, build symbolic chunk summaries. The document cites all three. Our search found no parity- or translation-based summary of rounded accumulation, so the claim stands.",
      "Normal-form proof of exact passes: the document does not claim novelty for the technique. It is standard translation validation and equivalence checking (Necula, PLDI 2000; Verdoolaege et al., TOPLAS 2012, which the document cites). Its point specific to Tix is correct and useful.",
      "Exact schedules (\"The new statement here is narrow and measured\"): there is prior art the document does not cite. He et al., Thinking Machines 2025, built fixed-order (batch-invariant) GPU kernels at about a 20% cost against cuBLAS. Yang, Riasanovsky, Deng and Sarkar, arXiv:2609.11356 (Sep 2026), enforce a fixed reduction order during Triton lowering and report most kernels within 10% of free-order speed.",
      "Theorem budget: Higham's γ(n-1)·Σ|x| bound is standard (Higham 1993/2002; confirmed). Using it as a pass gate is a modest new application."
    ],
    "errors": [
      "\"Tix's exact meaning has no such laws.\" Overstated. Rounded + and × are still commutative, +0 is an identity for a fold, and max is associative and commutative; the document itself later says \"`max` reductions are exactly associative\". Correction: a small set of word-level laws survives. A normalizer that ignores them is sound but incomplete, which the document concedes only for commutativity.",
      "\"A specified sequential order makes a scalar reduction 730 times slower than a free one.\" This measures `k_seq`, one thread loading global memory element by element (`for (I j = 0; j < L; ++j) s = __fadd_rn(s, p[j]);`, 26.6 ns per term). That is not the best schedule with the same order. A block-staged single-owner fold keeps the identical order at a few ns per term, so the penalty, and the transducer's 33–94× gains, are overstated against a weak baseline.",
      "\"cuBLAS promises the same bits from run to run only for one toolkit version on one GPU architecture\". The documentation (section 2.1.4, confirmed) also requires the same number of SMs and excludes multi-stream and some atomics modes. Minor imprecision."
    ],
    "quotes_for_low_scores": {
      "padding": "Score 2 (low is good). Compact and quantitative throughout, for example \"Where the pass changed the program, the proof is 43 to 75 times faster than the sampled gate, and it covers every shape. The speed matters less than the coverage\"."
    },
    "would_fund": "Proposal 2, acceptance by proof, first. It is a 60-line prototype that closes a hole I reproduced in the merged gate (the sampled cases always alias D and O in mlp, so the extent mutant is accepted), and every later schedule pass needs a gate that covers all shapes rather than sizes up to 7.",
    "notes": "The definition (the smallest price for a bit-specified result, plus the share of passes accepted by proof) is a good one: it is measurable and plays to Tix's exact meaning, and every experiment I re-ran (1, 5, 7) reproduced exactly. The weak points are that the transducer's gains are measured against a naive one-thread fold and that exact schedules are shown only for matmul."
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 6,
      "creativity": 6,
      "scientific_depth": 7,
      "evidence": 7,
      "correctness": 8,
      "grounding": 8,
      "padding": 5,
      "overall": 6
    },
    "best_ideas": [
      "A conditional dyadic-grid theorem that lets integer MMA reproduce the ordered f32 fold exactly (\"B <= 2^24 / e >= -149 / e + floor(log2(B)) <= 127\"), gated on provenance: \"Only positive evidence from an immutable buffer identity can move execution to the integer branch.\"",
      "Make max a lattice join under a NaN-class observation, so a parallel max tree preserves every observed word: \"rank the numeric f32 values with `-0 < +0` and put the one NaN class above positive infinity. The Tix maximum is the join of this total order\".",
      "The schedule certificate as a typed v6 postcondition bound to source revision, schedule revision and emitted-kernel digest, with mutation testing: \"A v6 postcondition accepted two symbolic plans, rejected 16 deliberate mutations, and was followed by GPU execution.\""
    ],
    "novelty_check": [
      "Integer-MMA exactness on a common grid: related but distinct. Every ingredient is known: Ozaki et al. 2012 and Ootomo et al. 2024 (both cited), Demmel–Nguyen pre-rounding, and Chen, arXiv:2608.13756 (2026), which states the |acc| ≤ 2^24 exactness condition for INT8 kernels. We found no lowering that reproduces an ordered f32 fold this way, and the document's novelty claim is appropriately narrow.",
      "Row residency and fusion: standard (Triton fused softmax and layernorm, which the document cites). The document claims novelty only for deriving ownership from index maps.",
      "Schedule validation: translation validation (Pnueli 1998), Halide, Li/Liang/Feng (TASE 2024) and VeriTile are all cited. The claimed distinction, per-pass validation with revision linkage, is modest.",
      "Optimistic carries: Kapre & DeHon 2007, cited."
    ],
    "errors": [
      "\"VeriTile is a close contemporary comparison, with selected exact kernel-pair and ordered-carry proof models and a stated separate compiler/GPU conformance boundary.\" Overstated. The coverage page describes \"kernel-stage pairs\", \"ordered carry\" appears only in matrix-vector rows, and the concurrency page says barriers and shared memory need \"a trace model that does not exist yet\". The conformance disclaimer is on the caveats and coverage pages, not the concurrency page."
    ],
    "quotes_for_low_scores": {
      "padding": "Score 5. There are long generic evaluation-protocol passages, for example \"Pre-register the shape grid and mix common with deliberately awkward extents. ... Rotate order, retain individual samples, repeat on separate runs and report uncertainty across runs before claiming a steady advantage.\" There are also abstract sentences that add little, such as \"Some transformations then need no numerical model beyond congruence. Others need a theorem with a runtime hypothesis.\""
    },
    "would_fund": "Proposal 1, the ordered row schedule with its checker. It already emits certificate-checked kernels with paired 1.98× (softmax) and 2.48× (layernorm) gains, all words matching, from a mutation-tested v6 postcondition, and it is the smallest step that makes the f32 tree a scheduling contract. The INT8 route should wait, as the document's own data show the exact FP32 tile beating guarded INT8 at 512³.",
    "notes": "The definition (fastest auditable ordered-f32 execution, judged on two boards with vendor results kept separate) is sound, the theory (grid theorem, signed zeros, max as a join) checks out, and scripts 02, 05 and 06 reproduced. The writing is dense and abstract, its generated softmax keeps the double exp and so stays slower than it could be, and its negative result on optimistic carries tests only exact-boundary guessing, not a parity- or translation-based summary."
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 9,
      "creativity": 8,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 7,
      "grounding": 8,
      "padding": 3,
      "overall": 8
    },
    "best_ideas": [
      "Symbolic fingerprints with residue-complete shapes: \"The *same kernel source* is compiled at a symbolic scalar type whose loads are hashes and whose arithmetic hashes the expression tree modulo the laws IEEE rounding obeys\". This caught a reassociation that numeric checks missed on integer and zero data, and every residue mutant at 600 shapes.",
      "Exhaustively proven intrinsics whose target is the language meaning rather than the real function: \"The target is the *language meaning*, not the mathematical function.\" The exp and tanh fast paths have 0 mismatches over 2^32 inputs. The bound sweep refutes the error analysis (\"exp is unsound at 2^-40 and below\"), and the exhaustive check found a real tanh bug.",
      "A menu of exactly specified contraction meanings with an exact interpreter reference for FMA: \"cuBLAS's own result at 4096³ is a sequential FMA fold, measured word for word\", and \"`Math.fround(a*b + c)` passed 1.31 million random triples and failed all 65,536 constructed near-midpoint triples\"."
    ],
    "novelty_check": [
      "Fingerprints (\"I have not seen it for tensor compilers\"): prior art for the concept. Yang, Riasanovsky, Deng and Sarkar, arXiv:2609.11356 (Sep 2026), give static checkers for bitwise equivalence of compiled GPU kernels and integrate them into Triton's autotuner, restricting it to one bit-equivalence class; that also anticipates \"autotuning semantically inert\". FPRev (Xie et al., USENIX ATC 2025) recovers accumulation orders. The mechanism here differs: the same source run on the GPU at a symbolic type, with a −0 law.",
      "Proven intrinsics: the method is standard in CORE-MATH and RLIBM (both cited): a fast path, a Ziv rounding test, and an exhaustive binary32 check. What is new is only the target, fround of JavaScript's Math.exp, and the use of the check as pass evidence.",
      "Scale-covariant accuracy relation (\"uses the origin's exact f32 error as the yardstick, which no tolerance chosen in advance can do\"): prior art. PyTorch Dynamo's `same(..., fp64_ref)` accepts if rmse(fp64_ref, res) ≤ 2·rmse(fp64_ref, ref) + tol/10. FlashAttention's tests require the error to be at most twice that of a same-precision PyTorch implementation. The ulp floor is the new part.",
      "Batch invariance as a theorem: an immediate consequence of the meaning, once He et al. 2025 (cited) named the property.",
      "cuBLAS equal to a sequential FMA fold at 4096³: Yang et al. 2026 and FPRev 2025 also reconstruct cuBLAS reduction orders. The observation here was made independently on the GB10."
    ],
    "errors": [
      "\"Hash collisions occur with probability around n²/2^64 for n distinct subterms, negligible for n < 10^9.\" At n = 10^9 the stated formula gives about 0.054 (the birthday bound n²/2^65 gives about 0.027). That is negligible only for n up to about 10^6.",
      "\"CORE-MATH proves binary32 functions correct on all inputs\". The project checks univariate binary32 functions by exhaustive search. Bivariate functions are checked only on known hard cases, and the checking is not a written proof.",
      "\"They therefore build their system to avoid batch-invariant kernels where determinism is not needed\" (Gond 2026). LLM-42 mostly reuses existing kernels for all traffic and obtains determinism by verify-and-rollback on flagged requests. The 194 vs 527 TFLOP/s figure is confirmed.",
      "\"typical errors grow like the square root of the length [Higham 2019]\". Higham and Mary prove a probabilistic bound proportional to √(n log n)·u under independence and mean-zero assumptions. Minor.",
      "The novelty claims for the accuracy relation and the fingerprints overlook the prior art listed in novelty_check."
    ],
    "quotes_for_low_scores": {
      "padding": "Score 3 (low is good). It is long (about 10,400 words), but nearly every section carries measured results, and the failures section is specific, for example \"exp is unsound at 2^-40 and below (66 to 882 mismatches), and tanh's exp path is unsound at 2^-40 (6 mismatches)\"."
    },
    "would_fund": "Exact-meaning scheduling generated by the experiment-12 planner, gated by fingerprints, with the proven exp and tanh as its first milestone. The planner already produces kernels for five of six programs that are bit-identical to Stage 2 and to runTix at off-tile shapes, at a 3.19× geometric mean, and the intrinsics alone halve softmax.",
    "notes": "The definition (the fastest code bit-identical to a portable meaning, with per-step evidence, measured against the exact ceiling) is the best argued of the four. It rests on measured ceilings, cuBLAS batch-variance data and corpus-wide exact kernels, and the result files match the text, including the zero-candidate gate result that I re-ran. The main blemishes are novelty overclaims (the accuracy relation, partly the fingerprints) and a collision-probability slip; the depth and the self-refutation are exemplary."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 9,
      "grounding": 7,
      "padding": 4,
      "overall": 7
    },
    "best_ideas": [
      "Fit one binary64 table coefficient as a discrete variable. Monotonicity makes each input's admissible set an interval: \"the set of consecutive binary64 table words that give x its desired output word is an interval\". Intersecting the intervals either finds a table word or \"their witnesses refute **every choice of that one coefficient**\".",
      "Let the IR bound the intrinsic's domain (\"For a nonempty row of finite f32 logits, its maximum is a row member. For every column, the exact difference from that maximum is nonpositive\"), then certify the deployed executable over all 2,139,095,041 sign-one inputs with SHA-256 receipts against Node.",
      "An even-ulp translation certificate for chunks of the ordered fold, falsified in a 4-bit miniature: \"When d is even, translating a grid value by d steps preserves tie parity.\" The weakened guards fail, for example \"Admitting odd shifts caused 7,680 errors among 25,420 acceptances.\""
    ],
    "novelty_check": [
      "Coefficient fitting: related but distinct. RLIBM (POPL and PLDI 2021, cited) solves an LP over per-input rounding intervals for polynomial coefficients. Gal's accurate tables (Gal 1986; Stehlé & Zimmermann, ARITH 2005) perturb the table abscissae, and Das Sarma & Matula (IEEE TC 1994) choose ROM table entries. We found no work framing a table word as a monotone interval intersection with a two-input refutation.",
      "Translation certificate: Kapre & DeHon 2007 (cited) reach the same goal by another method. The mechanism matches a two-state FSM summary (Mytkowicz et al. 2014). We found nothing closer, and the document makes no broad priority claim.",
      "Row-region fusion: standard (Triton fused softmax, cited). The binder-identity matcher is an engineering contribution."
    ],
    "errors": [],
    "quotes_for_low_scores": {
      "padding": "Score 4. The writing is dense, with some scorecard and protocol material that is generic, for example \"Use three scorecard columns. The first is assurance. ... A backend that spends seconds qualifying every 0.2 ms call will lose even if its kernel wins.\" Evidence-boundary caveats also repeat across sections."
    },
    "would_fund": "Proposal 1: the fitted, exhaustively certified exp for IR-bounded domains. It is the most original mechanism in the document, it has a built-in refutation mode (conflict pairs), and its receipt pipeline already reproduces against an independent Node reference. It applies to every exp whose argument sign the IR can establish.",
    "notes": "The definition (time to a reproducible source answer, with an assurance, latency and evidence-cost scorecard) is good. The plan applies it narrowly, though: softmax 4.25× and attention 1.38×, and nothing for matmul, mlp or conv2d. The evidence is the most rigorous in the pack, and every script I re-ran (03, 07, 09, 12, 14) and every numeric claim I checked (the midpoint word, exp(−104) below half the smallest subnormal, the interval counts) was correct."
  }
]
```

**Ranking by overall score**

1. **doc-C (8)**: It has the widest set of proposals, each with depth. Its experiments are the best designed and most self-refuting: exhaustively proven intrinsics, fingerprints, a planner that generates bit-identical kernels at a 3.19× geometric mean, and a measured exact ceiling. Its errors are novelty overclaims rather than technical faults.
2. **doc-A (7)**: The parity transducer is an original mechanism, and the normal-form gate exposes a real hole in the merged sampled gate (reproduced). The plan improves both assurance and contraction speed. Its transducer and schedule evidence are narrower and rest on a weak sequential baseline.
3. **doc-D (7)**: It has the most rigorous evidence and an original coefficient-fitting mechanism with exhaustive receipts. It ranks below doc-A because its plan only reaches softmax-like regions and leaves the contraction-heavy programs untouched.
4. **doc-B (6)**: Its theory is correct and its framework grounding solid (the grid theorem, NaN-class max, a certificate bound to kernel digests). It is the least distant from the standard fusion playbook, the hardest to read, and its gains are the smallest because it keeps the double-precision exp.
