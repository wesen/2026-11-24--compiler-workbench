```json
[
  {
    "doc": "doc-A",
    "scores": {
      "ingenuity": 8,
      "creativity": 8,
      "scientific_depth": 7,
      "evidence": 8,
      "correctness": 7,
      "grounding": 8,
      "padding": 2,
      "overall": 8
    },
    "score_quotes": {
      "padding (2, low is good)": "\"The short version, with every number measured in this round:\" The only repetition is this summary of results that the sections restate. Each section carries a mechanism, a measurement or a negative result."
    },
    "best_ideas": [
      "Binade (parity) transducer: an f32 fold computed in parallel while staying bit-identical to the sequential fold, via two-entry chunk summaries that compose as a monoid: \"a rounded addition is an integer addition whose only dependence on the accumulator is its parity\"",
      "Acceptance by normalization: the meaning has no algebraic laws, so for this IR equivalence reduces to comparing inlined, alpha-renamed trees: \"Giving up the algebra makes equivalence decidable by normalization.\"",
      "Found a real hole in the merged sampled gate by reading its case generator, and built a mutant that the gate accepts: \"A function with four or more shape symbols therefore has pairs of symbols that are equal in every sampled case\""
    ],
    "novelty_check": [
      "Parity transducer (claimed new): I found no published closed-form parity summary. The closest prior art is Kapre & DeHon, ARITH 2007 (iterative optimistic sequential-identical accumulation), and Raychev, Musuvathi & Mytkowicz, SOSP 2015 (symbolic chunk summaries); the document cites both. doc-D in this pack derived an equivalent even-translation lemma independently, so the idea is natural, but I found it nowhere in print.",
      "Normal-form proof of passes: partial prior art. Collingbourne, Cadar & Kelly, 'Symbolic crosschecking of floating-point and SIMD code', EuroSys 2011 (KLEE-FP), already proves FP equivalence by expression matching with FP operations as terms and a few canonicalization rules. Translation validation (Pnueli et al. 1998; Necula 2000) is the general frame. The document cites only Verdoolaege et al. and Shashidhar et al.",
      "Exact schedules: Halide's algorithm/schedule separation is prior art (cited). The claimed novelty is only the measured price of exactness, which is fair.",
      "Theorem budget for reassociation: the Higham (2002, ch. 4) bound is standard and cited. Using it as a gate in place of a fixed tolerance is a small, sound application."
    ],
    "errors": [
      {
        "quote": "Kapre and DeHon parallelize floating-point accumulation on an FPGA while \"obtaining results identical to the sequential ordering\"",
        "correction": "The quoted words are not in the paper. It says \"obtaining the same answer as the simple, sequential specification\". The substance is right, but the quotation is not verbatim."
      },
      {
        "quote": "A single GPU thread is very slow: 26.6 ns per element. A specified sequential order makes a scalar reduction 730 times slower than a free one.",
        "correction": "The k_seq baseline is one thread reading global memory, with no staging. On the same GB10, a block that stages tiles in shared memory and folds with one thread runs at about 4.45 ns per term (doc-C experiment 11: 18.67 ms for 2^22 terms per row). The inherent penalty is therefore about 6x smaller than stated. Against that baseline, the transducer's '33x' at 2^24 would be roughly 5-6x (13.4 ms against about 75 ms extrapolated). doc-A did not test this."
      },
      {
        "quote": "cuBLAS promises the same bits from run to run only for one toolkit version on one GPU architecture",
        "correction": "cuBLAS documentation section 2.1.4 also requires 'the same number of SMs'. Minor."
      },
      {
        "quote": "the same on the interpreter, on this GPU, and on the next one",
        "correction": "Tix's exp, log and tanh are Math.fround of JavaScript Math.exp and the like. ECMA-262 leaves these 'implementation-approximated', so the specified function is pinned to a JS engine version. Minor overreach in the class definition."
      }
    ],
    "would_fund": "Proposal 2 (acceptance by proof). It closes a hole the document demonstrated in the merged gate: the D/O-aliasing mutant passed the sampled gate and the normalizer rejected it, which I reproduced. It costs about 60 lines, and it is the gate every later schedule pass needs.",
    "notes": "This is the most original document in the pack: a precise lemma, a composable summary, honest refutations (it loses on corpus shapes, two levels disappoint, and the f64 guess-drift explains why), and every local experiment I re-ran reproduced exactly. The best-in-class definition (the smallest price for a specified result, plus proof coverage) is a good one, but the transducer's headline speedups are measured against an unstaged one-thread baseline."
  },
  {
    "doc": "doc-B",
    "scores": {
      "ingenuity": 6,
      "creativity": 5,
      "scientific_depth": 7,
      "evidence": 7,
      "correctness": 9,
      "grounding": 8,
      "padding": 5,
      "overall": 6
    },
    "score_quotes": {
      "creativity (5)": "\"Row residency itself is well established. Triton's tutorials fuse the same row operations\" and \"Tile and reuse input blocks, keep several output carries per lane\". Two of the three ranked proposals are the standard fusion and tiling playbook. Only the INT8 grid theorem sits far from it.",
      "padding (5, low is good)": "\"Pre-register the shape grid and mix common with deliberately awkward extents... Report median and p90 for warmed device time and host-to-host invocation time... Report workspace peak, covered input and shape volume, fallback frequency by reason, and rejection latency.\" This is a generic benchmarking protocol, and the long framework and assurance paragraphs restate process rather than adding findings."
    },
    "best_ideas": [
      "Conditional exact INT8 tensor-core route that reproduces the ordered f32 fold on a proved dyadic grid: \"B <= 2^24, e >= -149, e + floor(log2(B)) <= 127 ... Every sequential partial sum is exact by induction\"",
      "max as a lattice join over f32 words, with a NaN observation class, which licenses tree reductions: \"rank the numeric f32 values with -0 < +0 and put the one NaN class above positive infinity. The Tix maximum is the join of this total order\"",
      "A schedule certificate as a v6 postcondition, bound to the source revision and the emitted kernel digest: \"A v6 postcondition accepted two symbolic plans, rejected 16 deliberate mutations, and was followed by GPU execution.\""
    ],
    "novelty_check": [
      "INT8 grid route: related prior art is the Ozaki scheme (Ozaki et al. 2012; Ootomo, Ozaki & Yokota 2023/24; Abdelfattah et al. 2025), and the document cites all three. Framing the condition as identity with an arbitrary given left fold is a modest but real twist; the exactness argument (all partial sums representable) is classical.",
      "Certified row schedule: translation validation (Pnueli et al. 1998) and Halide scheduling are prior art, and VeriTile is a contemporary comparison; all are cited. The claimed distinction (automatic per-pass validation, revision linkage) is narrow and honestly stated.",
      "Row residency and parallel max: folklore and Triton tutorials, acknowledged in the document."
    ],
    "errors": [],
    "would_fund": "Proposal 1 (row-resident schedule plus its checker). It gave bit-identical 1.98x softmax and 2.48x layernorm speedups from generated code, and the checker caught all 16 mutants in submillisecond time, which I reproduced locally.",
    "notes": "This is careful, correct and well grounded work: every number I recomputed matched, and the INT8 negative result (a fresh scan and pack loses to exact FP32 tiling) is reported honestly. Most of the measured gain comes from standard fusion and tiling. The speculative-sum test used exact-word guesses only and so missed the parity insight that makes speculation robust, and the prose is dense to the point of obscuring the ideas."
  },
  {
    "doc": "doc-C",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 7,
      "grounding": 9,
      "padding": 3,
      "overall": 9
    },
    "score_quotes": {
      "padding (3, low is good)": "\"Hand-written kernels in this space were bit-identical to the unmodified Stage 2 code on all six corpus programs at full size. They were 2.0x to 7.6x faster (geometric mean 3.76x)\" The same figures recur in section 1, section 4.1 and section 7. At over 10k words there is some repetition, but nearly every section carries an experiment."
    },
    "best_ideas": [
      "Data-universal per-shape checking by instantiating the same kernel source at a symbolic hash type, modulo exactly the laws that RN arithmetic obeys: \"Instantiate them a second time at a type Sym. Its loads are hashes of (tensor, flat index), its mul and add are commutative hash combiners, and it carries one bit recording 'may be -0'\"",
      "Fast exp and tanh proved equal to the language meaning by GPU enumeration of all 2^32 inputs, with Ziv-test fallback: \"The equality is then proved by running the fast path and the meaning's GPU implementation on all 2^32 inputs.\"",
      "Batch invariance and inert autotuning as consequences of the fixed-order meaning, plus the measurement that cuBLAS at 4096^3 is exactly a sequential FMA fold: \"Batch invariance is a theorem of the Tix meaning... It also makes autotuning semantically inert.\""
    ],
    "novelty_check": [
      "Symbolic fingerprints (claimed: 'I have not seen it for tensor compilers'): prior art was missed. Collingbourne, Cadar & Kelly, EuroSys 2011 (KLEE-FP), and KLEE-CL ('Symbolic Crosschecking of Data-Parallel Floating-Point Code', IEEE TSE 2014) crosscheck scalar against SIMD and OpenCL FP code by symbolic execution, treating FP operations as terms under canonicalization rules. Running a hash instantiation on the GPU, with an RN-law algebra and residue-complete shapes, is still a new twist.",
      "Exhaustively proven intrinsics: CORE-MATH (Sibidanov et al. 2022), RLIBM-32 (Lim & Nagarakatte 2021) and Ziv (1991) are cited. Targeting fround(Math.exp) rather than the correctly rounded value is a small but genuine difference.",
      "Exact FMA reference in JS: the double-arithmetic-plus-halfway-check technique is folklore (for example FreeBSD/musl fmaf), and Boldo & Melquiond 2008 is cited. Not claimed as new beyond its use here.",
      "Batch invariance from the meaning: He et al. 2025 (cited) frame the problem. Deriving it as a theorem of fixed-order semantics is an observation, not contradicted by prior art.",
      "cuBLAS equal to a sequential FMA fold at 4096^3: an empirical finding, replicated independently by doc-A in this pack."
    ],
    "errors": [
      {
        "quote": "A fold is a dependent chain of RN additions in one thread, and no schedule can parallelize it.",
        "correction": "This is false. Sequential-identical parallel accumulation exists (Kapre & DeHon, ARITH 2007, not cited). Inside a binade, a rounded add depends on the accumulator only through its parity, so chunk summaries reproduce the fold bit for bit in parallel; doc-A and doc-D measured this. The 'fold wall' is a property of the schedule, not of the meaning, so routing long reductions to a meaning change (Proposal 4) is not forced."
      },
      {
        "quote": "the result does not depend on the GPU, batch composition, library version or interpreter",
        "correction": "The meaning of exp, log and tanh is Math.fround of JavaScript's Math.exp and the like, which ECMA-262 leaves 'implementation-approximated'. Results are pinned to a JS engine version; doc-D, for example, records the V8 version in its receipts."
      },
      {
        "quote": "Translation validation and symbolic execution are standard. The specific combination is to reuse the very kernel source at a symbolic scalar type... I have not seen it for tensor compilers.",
        "correction": "The novelty claim misses close prior art: KLEE-FP (EuroSys 2011) and KLEE-CL (TSE 2014) symbolically crosscheck FP and data-parallel (OpenCL) kernels against reference code, modulo FP canonicalization rules."
      }
    ],
    "would_fund": "Proposal 1 (exact-meaning scheduling, starting from the experiment-12 planner and a full-size f32-word lowering relation). It is the only proposal with corpus-wide evidence: six programs bit-identical at 1.98-7.56x by hand and 3.19x generated from the IR. Every other proposal (intrinsics, fingerprints, tuning) plugs into it.",
    "notes": "This document has the deepest and broadest evidence in the pack: twelve experiments with exhaustive 2^32 proofs, mutants, refuted recipes and relations, and a planner checked directly against runTix. The theory (laws L1-L3, the FMA midpoint argument) is stated precisely, and its definition of best in class is well argued with external demand. It overstates the impossibility of a parallel exact fold and misses KLEE-FP/KLEE-CL as prior art."
  },
  {
    "doc": "doc-D",
    "scores": {
      "ingenuity": 8,
      "creativity": 7,
      "scientific_depth": 8,
      "evidence": 9,
      "correctness": 9,
      "grounding": 8,
      "padding": 4,
      "overall": 7
    },
    "score_quotes": {
      "padding (4, low is good)": "\"Use three scorecard columns. The first is assurance... The second is paired device latency... The third is the cost and reuse of evidence.\" Together with the 'assurance boundary' section (\"Persist an explicit proposition with every result...\"), this is process prose with little new content, and the dense phrasing often hides the mechanism."
    },
    "best_ideas": [
      "Fit the exp table coefficients against the actual f32 reference: monotonicity turns each input into an interval constraint on one binary64 word, and a crossing pair refutes the whole table family: \"If two actual constraints cross, their witnesses refute every choice of that one coefficient with the other operations fixed.\"",
      "Use the IR to shrink the enumeration domain (softmax's exp argument is always <= 0) and certify the deployed binary by digest against Node: \"For every column, the exact difference from that maximum is nonpositive... The relevant scalar domain therefore has roughly half the binary32 encodings\"",
      "Even-translation chunk certificate for the ordered fold, falsified in a 4-bit float model before binary32: \"When d is even, translating a grid value by d steps preserves tie parity\" and \"Admitting odd shifts caused 7,680 errors among 25,420 acceptances.\""
    ],
    "novelty_check": [
      "Coefficient fitting: related prior art is RLIBM-32 (cited; per-input rounding-interval constraints), Gal's accurate tables (Gal 1985/86; Gal & Bachelis, TOMS 1991; not cited), and fpminimax discrete coefficient search (Brisebarre & Chevillard 2007; not cited). The single-coefficient interval intersection with two-input infeasibility witnesses, aimed at an engine's observed output, appears new in this framing, and the document makes only a modest claim.",
      "Even-translation certificate: equivalent to doc-A's parity transducer. Kapre & DeHon 2007 is cited, and the document explicitly declines a priority claim. I found no published version.",
      "Row-local fusion: Triton tutorial and Exo (both cited). Recognizing the region by binder identity is an incremental contribution."
    ],
    "errors": [],
    "would_fund": "Proposal 1 (the fitted, enumerated exp intrinsic with receipts). It halved the fused softmax again, to 4.25x over Stage 2 at 80.6% of matched streaming throughput, with no runtime fallback branch. Its evidence is independently checkable: I recomputed the Node SHA-256 for the 265M-word active interval and it matched the GPU receipt.",
    "notes": "This is the most rigorous experimental craft in the pack: paired, rotated timings, exhaustive receipts with digests, a miniature-precision falsification of the fold lemma, and a high-precision explanation of the single failing input, all of which I reproduced where it could be done locally. The scope is narrow (softmax and the middle of attention), and 'time to a reproducible source answer' is a defensible but narrower definition of best in class than the others."
  }
]
```

**Ranking by overall score**

1. **doc-C (9).** It has the broadest and deepest evidence: corpus-wide bit-identical speedups, a planner generated from the IR, exhaustively proven intrinsics and data-universal fingerprints, all tied to a well-argued definition. It is held back only by the false "no schedule can parallelize the fold" claim and by missed KLEE-FP prior art.
2. **doc-A (8).** It has the most original mechanisms: the parity transducer, proof by normalization, and a demonstrated hole in the sampled gate. Its refutations are honest and its results reproduce exactly, but the transducer's speedups rest on an unstaged sequential baseline.
3. **doc-D (7).** It has the most rigorous evidence and the cleverest intrinsic synthesis (a fitted table coefficient with refutation witnesses and digest receipts), but it covers only softmax and attention.
4. **doc-B (6).** It is correct and well grounded, with measured, certified row schedules and an elegant INT8 exactness theorem, but most of its gain comes from standard fusion and tiling, and its prose buries the ideas.
