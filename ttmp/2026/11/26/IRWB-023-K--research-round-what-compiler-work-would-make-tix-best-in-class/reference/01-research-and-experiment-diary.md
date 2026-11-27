---
Title: Research and experiment diary
Ticket: IRWB-023-K
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research diary for the best-in-class round: definition, proposals, experiments on Node and the GB10, failures included.
LastUpdated: 2026-11-26T21:40:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Research and experiment diary

## Step 1. Ticket setup, reading the two stages, and the definition of the round

I created ticket IRWB-023-K with docmgr, read the Stage 1 design and final report (IRWB-020-B) and the Stage 2 design, diary, final report and coordinator facts (IRWB-022-I), then read the tensor sources (`model.ts`, `evaluate.ts`, `passes.ts`, `contract.ts`, `cuda-source.ts`, `cuda-contract.ts`, `index.ts`) and the corpus. This entry records the verbatim prompt and my working plan; later steps record research, experiments and decisions with their evidence.

### Prompt context

<details>
<summary>User prompt, verbatim</summary>

You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
- **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`).

Tix has been built in two stages, each merged from one of several independent implementations:
- **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
- **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.

Both tickets are under `ttmp/2026/11/26/`. Read their designs and final reports first, then the code.

Your ticket is IRWB-023-K. This is a **research round: design and experiment, no changes to the product code.**

## The question
What compiler work would make Tix best in class? "Best in class" is yours to define and defend. It could be speed against vendor libraries, the strength of the correctness guarantees, compile or check time, expressiveness, portability, what the compiler can prove, or something else you can argue for. Propose the work you would do, and back it with theory, literature and experiments.

**This round measures ingenuity, creativity and scientific depth.** What scores well:
- ideas that exploit what is specific to Tix: an exactly specified f32 meaning, index notation, every transformation a checked pass in the v6 framework, and a GPU available for experiments;
- a familiar technique, when you find something new to say about it here;
- claims tested by experiments you design and run, including the ones that refute your idea.

What scores poorly: a long list of standard techniques, breadth without depth, and claims without evidence.

## What you may do
- **Research:** search the web, and read papers and documentation. Cite what you use (authors, title, year, link). Citations will be checked.
- **Experiment:** write probes, prototypes and benchmarks in your ticket's `scripts/` directory (or `prototypes/`). Run them on this machine, and on the GPU machine through `tools/cuda-remote.mjs` (read its header). Prototypes may import from `dist/` after `npm run build`. Report every experiment's result.
- **Do not change** `src/`, `tests/`, `corpus/` or `tools/`. Prototypes live in your ticket.

## Deliverables
1. **A ticket, IRWB-023-K,** created with your docmgr skill, containing a design document (`design-doc/01-….md`) that covers:
   - what "best in class" means for Tix, and how it would be measured;
   - your proposals, ranked. For each: the idea; why it works (the theory); what is new; the evidence you gathered (experiments and results); the risks; how success would be measured; and what it needs from `src/framework`;
   - a staged plan: what to build first, and why;
   - what you tried that did not work.
   
   Include at least two Mermaid diagrams. Length is not scored. 4,000 to 10,000 words is a reasonable range.
2. **A diary** (your diary skill) recording your research, experiments and decisions, failures included.
3. **Commits** on your current branch, with messages starting `IRWB-023-K:`. Commit as you go, so that your last commit always holds a complete document. The session ends after about three hours. Do not push.

**Final message:** the design's path; your top three proposals, one line each; the experiments you ran, one line each with its result; and the commit hash.

## Facts measured on the GB10 by the coordinator
- **cuBLAS SGEMM** (FP32 math, no TF32), median of 20 event-timed runs: 0.0329 ms at 512³ (8.15 TFLOP/s); 19.2 TFLOP/s at 4096³.
- **A streaming kernel** `y = 2x` reaches 244 GB/s.
- **The merged stage-2 kernels,** single timed runs at stage 2's sizes:

  | program | time |
  |---|---|
  | matmul 512³ | 0.197 ms |
  | softmax 4096×1024 | 0.785 ms |
  | layernorm | 0.563 ms |
  | attention | 1.81 ms |
  | mlp | 1.05 ms |
  | conv2d | 0.341 ms |

  Single runs vary by up to 2×.
- **The merged lowering is bit-identical** with the f32 meaning on every case measured. For all 2³² f32 inputs, CUDA's double-precision `exp`, `log` and `tanh`, rounded to f32, equal `Math.fround(Math.exp(x))` and so on.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`): other agents share this machine.
- **The GPU machine is shared with six other agents.** Use `--timed` (it takes a lock) only for measurements, and keep each timed run short.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Outside your worktree,** use only the web and the GPU machine.

</details>

**Assistant interpretation:** This is a design-and-experiment round. No product code changes; probes live in the ticket's `scripts/`. I must define "best in class", propose ranked work backed by theory, literature and experiments, and deliver a 4,000–10,000 word design doc with two Mermaid diagrams, a diary, and incremental commits prefixed `IRWB-023-K:`.

**Inferred user intent:** The interesting Tix-specific facts are (a) the f32 meaning is exactly specified (every rounding site defined, reduction order lexicographic, intrinsics = `Math.fround` of correctly rounded double transcendental), (b) every transformation is a checked pass gated by a meaning contract, (c) Stage 2 is bit-identical with the f32 meaning but slow (matmul 512³: 0.197 ms vs cuBLAS 0.0329 ms, ~6×; the naive kernel is ~1.37 TFLOP/s vs 19.2 TFLOP/s at 4096³). The round rewards finding the compiler work that is *new* given those facts, and testing it.

### What I did

- Created ticket IRWB-023-K (design doc + this diary) with docmgr.
- Read Stage 1 design/report, Stage 2 design/diary/report, and the tensor sources listed above.
- Set tasks in `tasks.md` (below).

### Working definition to be defended (draft, to refine after experiments)

Best in class for Tix = **the strongest verifiable numeric guarantee in the tensor-compiler class, at a defensible fraction of vendor speed**. Tix cannot win peak FLOP/s against cuBLAS/Triton, and does not need to: its distinguishing asset is that its f32 meaning is exact and every transformation is checked. The work that makes it best in class is therefore the work that (1) makes the *checks* stronger (certified per-element error bounds rather than sampled tolerance), (2) makes *exactness cheap* (bit-exact tiling/fusion, tree-parallel reduction evaluation — schedules that provably cannot change bits), and (3) makes checking *scale* (references on the GPU, exact f32 relation as Stage 2's own retrospective proposes). Speed work is included in the exactness-preserving subset: tiling and fusion that provably preserve the f32 meaning, closing a measured part of the cuBLAS gap.

### Plan (to be updated as I learn)

1. Literature pass: reproducible/reproducible-summation and error-bound literature (Higham; Demmel–Nguyen; Iakymchuk exBLAS/ReproBLAS), verified numerics (Gappa, FPTaylor, Rosa, Herbie), tensor compilers (TACO, Tensor Comprehensions, Halide/TVM scheduling, Triton, Finch, DaCe), and reduction-order/accuracy work.
2. Node experiments: a certified forward-error bound analyzer (interval/γ-arithmetic) over the actual Tix IR for the six corpus programs; compare certified bounds to measured sampled errors; test on split-sum and the drop-the-tail mutant.
3. GB10 experiments: (a) bit-exact shared-memory tiled matmul vs Stage 2 kernel vs cuBLAS facts; (b) tree-parallel (chunk-sequential + ordered merge, and butterfly) reduction with bit-exactness checks against a JS evaluation of the same tree; (c) exact fused softmax (one block per row, two-pass, same rounding sites); (d) double-precision transcendental portability probe (CUDA double `exp`/`log`/`tanh` vs Node at double resolution) to test whether an f64 GPU reference is bit-portable.
4. Write the design doc; iterate diary + commits.

### What I learned

- Stage 2's own retrospective proposes exact f32 (NaN-as-class) as the lowering relation; the f64 tolerance "can admit an incorrect f32 result or reject a correctly lowered f32 program". This round can supply the missing piece: make exact checking *affordable* and reassociation *certified*.
- The Stage 2 gap to cuBLAS is ~6× at 512³ and the kernel is one-thread-per-element with redundant global loads; tiling changes no rounding site, so a large part of the speed gap may close without spending any numeric budget. That conjecture is testable this round.

### What warrants a second pair of eyes

- Whether "best in class = certified numerics" is argued from evidence rather than assertion; the bound analyzer's γ-formulas; the bit-exactness arguments for tiling and tree evaluation (they must be checked against the actual f32 meaning rules, especially the reduction order and the `__fadd_rn`/`__fmul_rn` non-contraction sites).

## Step 2. Literature pass

I searched for and collected the citable sources used in the design doc: reproducible summation (Demmel & Nguyen ARITH 2013; Ahrens, Demmel & Nguyen TOMS 2020; Iakymchuk et al. ExBLAS), verified numerics (FPTaylor, FM 2015; Herbie, PLDI 2015), the tensor-compiler class (TACO OOPSLA 2017; Tensor Comprehensions 2018; Triton MAPL 2019; Halide PLDI 2013; FlashAttention NeurIPS 2022), Higham's *Accuracy and Stability of Numerical Algorithms* (2nd ed., 2002) for the γ-error machinery, and NVIDIA's floating-point whitepaper. All links recorded in the design doc's ExternalSources and inline citations.

### What I learned
- The reproducible-summation line (ReproBLAS/exBLAS) buys bitwise reproducibility by *changing* the arithmetic (binning, long accumulators). Tix's complementary position — keep the f32 meaning exactly, certify each deviation — appears unoccupied, which became the core of P1.
- FPTaylor/Herbie certify or improve *expressions* offline. Making the bound the *acceptance evidence of a checked pass*, on the framework's own deterministic case domain, is the Tix-specific move.

## Step 3. Experiment 1: certified forward-error bounds over the real IR (Node)

I implemented `scripts/01-certified-bounds.mjs`: a `(value, e)` analyzer that mirrors `src/tensor/evaluate.ts` node-for-node (f32 meaning values, round-to-nearest γ-model for arithmetic and reduction folds, monotone-interval propagation for exp/log/sqrt/tanh, bounds carried through stored statement outputs), a deterministic case generator mirroring `contract.ts`, width-parameterized split and two mutants built on the real IR, and a simulation of three gates (G1 sampled tolerance, G2 certified ≤ budget, G3 certified monotone) plus soundness assertions S1/S2/S3.

### What worked
- S1/S2/S3 all pass: 23,648 assertions, 0 violations over 5,788 sampled elements across the six corpus programs. The certified bound is sound and ~30× loose (tightness 0.005–0.037).
- Gate table produced (see design doc): the Stage-1 budget cannot be reused for certified bounds (G2 fails on layernorm and on the *identity* candidate for conv2d); strict per-element monotonicity (G3) rejects split on 5/6 programs (max e_c/e_o = 1.6, 151–209 elements above 1.0) while 2× slack accepts 6/6; drop-tail and transpose mutants are caught by the exact semantic-difference term (2.02 on matmul, 16.1 on mlp, inf on softmax).

### What didn't work
- First run: gate `cert` was NaN — I passed whole `BufferValue` objects where `.data[i]` was meant. Fixed.
- The analyzer's f32 values differed from `dist`'s evaluator on 2 layernorm cases: my early-return paths replaced the meaning's value with literal `NaN`, while the meaning propagates the hardware NaN (`Math.sqrt` of a negative in V8 yields `0xffc00000`). This is itself evidence for NaN-class comparisons (Node's own NaN payload is implementation behavior). Fixed by computing the meaning's value before all bound logic.
- The softmax transpose mutant passed all gates — correctly, because softmax is shift-invariant and the row→column max swap changes outputs by only 6e-8. Recorded as a lesson about choosing mutants for the property under test.

## Step 4. Experiment 2: exactness-preserving scheduling and reference portability (GB10)

I wrote `scripts/cuda-exp2/main.cu` (naive Stage-2 replica, bit-exact 32×32 shared-memory tiling, 2×2 register-blocked tiling, fmaf variant, double-precision matmul, fused softmax/layernorm kernels implementing the split-sum(width 4) tree with parallel max and in-order merges, double exp/log/tanh probes, full-size word-diff counters) and `scripts/02-cuda-exactness.mjs` (input generation, remote invocation with `--timed`, bit-comparisons against `dist` evaluators, split-lib for IR-level splits).

### What worked (results, GB10 sm_121, medians of 3)
- Tiled vs naive at 512³: **0 of 262,144 words differ** (bit-exact), 0.2140→0.1949 ms. Register-blocked (4 chains): **0 words differ vs tiled**, **0.1047 ms (2.0×)**. `fmaf`: **222,332 words differ (85%), 0.1952 ms** — contraction changes almost every output and buys nothing here.
- Fused softmax (4096×1024): 0.378 ms vs Stage-2's 0.785 (2.1×); fused layernorm: 0.131 ms vs 0.563 (4.3×). Both **bit-identical to the f32 meaning of the real `optimizeTix(['split-sum'])` IR** on cross-checked small cases; deviations from the origin IR are ≤3e-9 (softmax) and ≤2.5e-7 (layernorm) vs f64.
- f64 matmul reference on GPU: 1.60 ms at 512³ (vs 781 s on Node, ≈488,000×) and **bit-identical to Node's f64 meaning** (pure arithmetic).
- Double transcendentals are NOT bit-portable: exp 107,636/1,048,576 mismatches vs Node (10.3%), tanh 60,934 (5.8%), log 16,921/524,288 (3.2%) — all sub-f32-resolution, consistent with the coordinator's exhaustive f32-level agreement fact. This substantiates "f32 meaning as the portable anchor; f64 reference as measurement".

### What didn't work (three engineering failures, all found by bisection)
1. The first "short mm_a.f32: got 1" failure sent me chasing a phantom remote-upload truncation: I reproduced the tool's tar and ssh steps in isolation (both fine), uploaded manually (fine), and finally added a size preflight to the CUDA binary — which showed the file complete while the very next `fread` returned 1. The real cause was **my own UB lambda**: the `check()` macro contains `return 1`, so the lambda deduced an int return type and fell off the end on the success path (nvcc warning #940 — which I had seen and ignored). Replacing it with a proper function fixed the reads.
2. `f32file('ln_eps.f32', [1e-5])` still passed an array as the length after my first fix — `ToLength([1e-5]) = 0` — writing **empty** files. The "got 0" failure was my generator, not the transport.
3. All small-case bit-comparisons came back garbage (7.4e28 everywhere): Node's `readFileSync` returns **pooled Buffers** for small files, and `new Float32Array(buf.buffer)` read pool bytes instead of the file. Fixed by slicing to an aligned copy (`buf.buffer.slice(byteOffset, ...)`).
- Also: my first kernel design used width-32 chunks, which the Stage-1 evaluator cannot express (the `blocks`/`tail` extents hardcode width 4 from `model.ts`); I rebuilt the kernels around width 4 — the tree the real pass emits — and recorded the IR limitation as design input.

### What I learned
- At 512³ the matmul bottleneck is the accumulator dependency chain, not memory: bit-exact register blocking (independent chains per output element) is both exact and the actual source of the 2×. FMA is all cost, no benefit.
- The exactness story composes: parallel max is order-free under the meaning's rules (proved + verified), tree evaluation of a checked reassociated IR is exact, and tiling/fusion on top preserve bits — all confirmed at full size or cross-checked against Node.

## Step 5. Design document written

I wrote `design-doc/01-best-in-class-for-tix-certified-numerics-at-competitive-speed.md` (~5,900 words): the definition of best in class with measurable properties, ranked proposals P1 (certified error budgets), P2 (exactness-preserving scheduling behind an exact-f32 gate), P3 (GPU-resident references and the f32 anchor), a staged plan (A: exact gate + GPU references; B: certified budgets; C: Class-E schedules; D: autotuning/search) with two Mermaid diagrams, per-proposal risks/success metrics/framework needs, and the failures above. Tasks updated; final commit follows.
