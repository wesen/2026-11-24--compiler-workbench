---
Title: Research diary
Ticket: IRWB-023-A
Status: complete
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Research chronology with replay commands, measurements, counterexamples and fixes.
LastUpdated: 2026-11-26T18:26:44.290808056-05:00
WhatFor: ""
WhenToUse: ""
---

# Research diary

## Step 1 — Read the stage handoffs and set the research question

The stage handoffs establish two relations with different jobs. Stage 1 can intentionally change an ordered f32 tree. Stage 2 aims to execute that tree faithfully and currently checks it with a sampled f64 tolerance. This ticket measures what can be gained by turning the f32 tree itself into a knowledge boundary for scheduling and verification.

### Prompt context

**User prompt (verbatim)**

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`);
> - **Tix,** an index-notation language for tensor programs (`src/tensor/`, `corpus/tensor/`).
>
> Tix has been built in two stages, each merged from one of several independent implementations:
> - **Stage 1** (ticket IRWB-020-B): the front end, an IR as a v6 artifact, f32 and f64 evaluators, a meaning contract, and two checked passes (`inline`, `split-sum`).
> - **Stage 2** (ticket IRWB-022-I): lowering to CUDA, one kernel per statement and one thread per output element, run and checked on an NVIDIA GB10.
>
> Both tickets are under `ttmp/2026/11/26/`. Read their designs and final reports first, then the code.
>
> Your ticket is IRWB-023-A. This is a **research round: design and experiment, no changes to the product code.**
>
> ## The question
> What compiler work would make Tix best in class? "Best in class" is yours to define and defend. It could be speed against vendor libraries, the strength of the correctness guarantees, compile or check time, expressiveness, portability, what the compiler can prove, or something else you can argue for. Propose the work you would do, and back it with theory, literature and experiments.
>
> **This round measures ingenuity, creativity and scientific depth.** What scores well:
> - ideas that exploit what is specific to Tix: an exactly specified f32 meaning, index notation, every transformation a checked pass in the v6 framework, and a GPU available for experiments;
> - a familiar technique, when you find something new to say about it here;
> - claims tested by experiments you design and run, including the ones that refute your idea.
>
> What scores poorly: a long list of standard techniques, breadth without depth, and claims without evidence.
>
> ## What you may do
> - **Research:** search the web, and read papers and documentation. Cite what you use (authors, title, year, link). Citations will be checked.
> - **Experiment:** write probes, prototypes and benchmarks in your ticket's `scripts/` directory (or `prototypes/`). Run them on this machine, and on the GPU machine through `tools/cuda-remote.mjs` (read its header). Prototypes may import from `dist/` after `npm run build`. Report every experiment's result.
> - **Do not change** `src/`, `tests/`, `corpus/` or `tools/`. Prototypes live in your ticket.
>
> ## Deliverables
> 1. **A ticket, IRWB-023-A,** created with your docmgr skill, containing a design document (`design-doc/01-….md`) that covers:
>    - what "best in class" means for Tix, and how it would be measured;
>    - your proposals, ranked. For each: the idea; why it works (the theory); what is new; the evidence you gathered (experiments and results); the risks; how success would be measured; and what it needs from `src/framework`;
>    - a staged plan: what to build first, and why;
>    - what you tried that did not work.
>
>    Include at least two Mermaid diagrams. Length is not scored. 4,000 to 10,000 words is a reasonable range.
> 2. **A diary** (your diary skill) recording your research, experiments and decisions, failures included.
> 3. **Commits** on your current branch, with messages starting `IRWB-023-A:`. Commit as you go, so that your last commit always holds a complete document. The session ends after about three hours. Do not push.
>
> **Final message:** the design's path; your top three proposals, one line each; the experiments you ran, one line each with its result; and the commit hash.
>
> ## Facts measured on the GB10 by the coordinator
> - **cuBLAS SGEMM** (FP32 math, no TF32), median of 20 event-timed runs: 0.0329 ms at 512³ (8.15 TFLOP/s); 19.2 TFLOP/s at 4096³.
> - **A streaming kernel** `y = 2x` reaches 244 GB/s.
> - **The merged stage-2 kernels,** single timed runs at stage 2's sizes:
>
>   | program | time |
>   |---|---|
>   | matmul 512³ | 0.197 ms |
>   | softmax 4096×1024 | 0.785 ms |
>   | layernorm | 0.563 ms |
>   | attention | 1.81 ms |
>   | mlp | 1.05 ms |
>   | conv2d | 0.341 ms |
>
>   Single runs vary by up to 2×.
> - **The merged lowering is bit-identical** with the f32 meaning on every case measured. For all 2³² f32 inputs, CUDA's double-precision `exp`, `log` and `tanh`, rounded to f32, equal `Math.fround(Math.exp(x))` and so on.
>
> ## Repository facts
> - **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`): other agents share this machine.
> - **The GPU machine is shared with three other agents.** Use `--timed` (it takes a lock) only for measurements, and keep each timed run short.
> - **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
> - **Outside your worktree,** use only the web and the GPU machine.

**Interpretation** Deliver a research program with a measured performance axis and explicit evidence boundaries. Work from branch base `12bc661`.

### What I did

- Read the designs and final reports for IRWB-020-B and IRWB-022-I before tracing `src/tensor/`, the strategy registry, and the contract and pass interfaces. Read the CUDA runner header.
- Created the ticket, design, diary and task list with docmgr. The installed CLI mapped the documented `create-ticket` alias to `ticket create` and honored the explicit dated path.
- Read literature on the Halide schedule model, FlashAttention's online algorithm, optimistic ordered accumulation and integer contraction. See the design for source attribution and the connection to Tix.
- Probed Node 24.18.0 with `npm run build` and a minimal `compileTix`, `runTix`, `cudaSource` call. It returned 3 and found the emitted `__fadd_rn`.
- Used `node tools/cuda-remote.mjs <ticket>/scripts/00-gpu-smoke --host manuel@bling` without a timed lock for the single correctness result. It reported `NVIDIA GB10 sm_121 nvcc 13.0.88 value 1.5`, exit 0, from a fresh compile.

### Why and what I learned

The actual CUDA invariant in `cuda-contract.ts` references f64, despite the stage report's observed f32 agreement. The framework can express a richer invariant through its existing typed ports. Its `assuranceOf` helper treats an absent or unknown method as `checked-exact`. A proof-carrying experiment needs an explicit method and profile to keep unknown evidence from inflating a claim.

### What did not work

A detached tmux server created in a short-lived invocation was gone on the next tool call. `tmux -L irwb023a list-sessions` returned `no server running on /tmp/tmux-1000/irwb023a` and the first redirected output was absent. Keep the initiating command alive using `tmux wait-for` while the benchmark runs. Code inspection also caught competing writes of the parallel maximum to one shared scalar before a successful measurement. Only lane zero now writes that slot.

### Review and next experiment

Start with the generated-kernel signature probe and the paired `01-row-bench.mjs` harness. The first three CUDA variants preserve distinct rounding points and compare output words individually. Audit barriers, domain exceptions and what a GPU sample establishes before drawing a performance conclusion.

## Step 2 — Complete paired residency and schedule-certificate experiments

The first correct paired runs made the serial memory paths visible. Softmax's shared maximum and layernorm's staged mean mattered much more than kernel count alone. The initial integer benchmark also found an expensive guard miss, a counterexample to treating the fallback as a free clause.

### Prompt context

See Step 1. The first research checkpoint is `f1d92a6`, `IRWB-023-A: establish exact scheduling research and paired GPU probes`.

### What I did

- Ran `01-row-bench.mjs` through a tmux session held by `tmux wait-for`. Saved the corrected 21-event records under `scripts/results/`. The three best paired medians were 0.389248 ms (softmax), 0.171328 ms (layernorm) and 0.770176 ms (attention) against 0.746688, 0.439968 and 1.047776 ms.
- Ran `02-schedule-certificate.mjs` on Node 24.18.0. Bound the prototype to `defineIR`, `defineInvariant` and `AnalysisManager.verifyTransformation`, observed successful checks as `checked`, and rejected all 16 mutations. Demonstrated two distinctions between f64 tolerance and f32 identity and a shape-sensitive mutation invisible to small samples. This also probes that the needed framework extension points already execute in this worktree.
- Ran `03-mma-smoke/main.cu` untimed. GB10 returned all 256 signed products as −96. Ran `04-integer-bench.mjs` through the timed lock. The 512³ checked grid hit ran in 0.069984 ms versus 0.207040 ms stage 2, and the miss ran in 0.484224 ms versus 0.209024 ms. Every comparison was exact, including rectangular and bound-saturating inputs. Recorded the timing samples.

### What did not work

- `git add` under default sandbox permissions reported `Unable to create .../index.lock: Read-only file system`. The authorized escalation granted access. The initial staged whitespace check flagged a space-only line in the quoted prompt. I removed its trailing formatting whitespace and staged again.
- The first paired run printed valid softmax and layernorm results (0.751808→0.387136 ms and 0.427328→0.170240 ms). Attention failed with `Error: undefined` because the wrapper dropped nonzero-exit runner stdout. The diagnostic after preserving runner JSON was exit 134 and `Fatal glibc error: malloc.c:2599 (sysmalloc): assertion failed`. `DeviceBuffer::download` copied Q×K words into a Q×V host vector. The fix allocates Q×V output buffers and checks destination size before download. The replay passed all full, tail and extreme cases.
- The initial 512³ specialization miss was 2.32× slower than stage 2. The different lane mapping made the fallback benchmark a real implementation problem. The next experiment needs both a stronger exact FP32 baseline and a sane miss path.

### Review and next experiment

Replay the local certificate before running CUDA. Review the experimental artifacts separately for verifier scope and CUDA correctness. Use the integer miss result to choose a second baseline and a guard implementation with per-block failure reduction. Check eligibility off the synthetic grid and quantify the speculative sum alternative before making the final ranking.

## Step 3 — Test guard eligibility, alternative carries and a better contraction baseline

Using an unoptimized but correct comparison inflated the INT8 result. The follow-up paired three genuinely different costs. Exact tiling preserves Tix's ordered carries, prepacked WMMA uses a proved subdomain, and the checked variants include scanning and dispatch. This changed the recommendation to ship ordered tiling and conditionally pursue INT8 when provenance can remove recurring packing.

### Prompt context

See Step 1. The second checkpoint is `f2809f4`, `IRWB-023-A: measure exact residency, schedule witnesses and integer contraction`. It retains the original CUDA integer source corresponding to the first timing hash.

### What I did

- Ran `node <ticket>/scripts/05-dyadic-domain.mjs`. It evaluated four synthetic value families of 1,200 dots each, proved and matched 2,400 grid examples, and declined all 2,400 off-grid examples. Cross-checked 32 dots and the boundary witnesses with the interpreter. Added the case where distinct row and column grids give 16 exact results despite both whole-tensor grids failing.
- Ran `node <ticket>/scripts/06-prefix-witness.mjs`. Varied both width and distribution across 4,608 rows. The chunk-level guess looked promising on uniform data but verified only one of 4,608 nonuniform candidate pairs at width 1024 and none at width 4096. The four-element softmax witness reproduced precisely one ULP of denominator difference. I dropped this from the near-term GPU plan.
- Reran `04-integer-bench.mjs` with an exact tiled FP32 control, separate predicated fallback, and per-block guard failure reduction. For 512³, the tiled control gave 0.055456 ms against 0.210656 ms stage 2, 0.049472 ms packed and 0.070016 ms checked inline on the same grid. The routed miss took 0.076448 ms instead of 0.484448 ms inline. It still cost more than the unconditional tile. At K=64, the tile and prepacked device times tied at about 0.0106 ms. All outputs matched.
- Cross-checked the dyadic range argument against IEEE 754 and the documented s32 WMMA accumulation semantics. Read Ozaki-style slicing and binned summation for their distinct numerical goals. Read Kapre and DeHon to frame the difference between the one-shot guess and iterative recovery.

### What did not work

The exact tile invalidated the premise that the whole-input guard was a speed win. For the synthetic hit it added more latency than the tensor-core compute saved. The first inline fallback remained slow in the follow-up run. The second CUDA compile emitted `main.cu(40): warning #128-D: loop is not reachable` on the compile-time-disabled inline fallback in the routed template instantiation. GB10 compiled and ran the intended branches. The diagnostic is retained with the raw timing log.

### What warrants a second pair of eyes

Review the signed-zero proof and both exponent boundaries with the actual target's gradual underflow behavior. Reuse must attach to an immutable packed operand and its aliasing and synchronization discipline. The trial hit rates are synthetic, and the timing comparison does not answer whether real production data offers enough persistent packed reuse.

## Step 4 — Emit from the certificate and exercise fallback

The local structural check proved a narrow plan. To connect it to the performance result, I split the verifier into a reusable module and compiled the verified phase trees into executable CUDA for both normalizations. A shape sweep ran the approved path, the baseline and both handwritten controls on identical buffers.

### What I did

- Probed the refactored module by rerunning `02-schedule-certificate.mjs`. It preserved all 16 mutant failures and real v6 postcondition behavior. The final replay's manager p95 was 0.342 ms for softmax and 0.203 ms for layernorm.
- Ran `node <ticket>/scripts/01-row-bench.mjs --certified --sweep softmax layernorm`. Accepted certificates were keyed by immutable source and schedule revisions and recorded with the generated CUDA kernel digest. The final GB10 replay matched all observed outputs in full, tail, finite-edge, 4096×63, 16×1024 and over-cap configurations. Full-size generated medians were 0.387232 and 0.179456 ms against 0.767328 and 0.444576 ms. The cap at 2048 deliberately exercised the stage-2 fallback at width 4096. Handwritten wider-row variants showed opportunity beyond the cap.
- Read current framework evidence handling, including the externally checked `proofVerifier` path. Reviewed Halide scheduling semantics, affine translation validation, GPUVerify, Alive-FP and VeriTile. Identified the checked abstract phase model and the executable/toolchain boundary as separate engineering milestones.
- Ran `node --test tests/tensor/language.test.mjs tests/tensor/passes.test.mjs tests/tensor/corpus.test.mjs tests/tensor/cuda.test.mjs` after the clean build. All 19 focused local tests passed. The full suite and extra shared-GPU tests were outside the research measurement needs.

### What did not work

The initial `--certified --sweep` run passed emitted in-cap cases and the softmax fallback. Layernorm's fallback reported `0/4194304` and first mismatch reference `be060279`, candidate `00000000` at index 0, followed by `result differs` and exit 1. The launch wrapper's copied `k3` call wrote `expected.ptr` instead of its `out` parameter. An initial search-and-replace missed the argument spelling because gamma and beta occur before the destination. The corrected `beta.ptr, out, cells` call made the next full replay pass. This was a test of why schedule evidence must be paired with executable validation.

### Review instructions

Use the design's Replay section. The last generated evidence link binds matching source and schedule revisions and the emitted kernel digest. The earlier handwritten record establishes performance for a broader set of owners than the certificate currently supports. Timing measurements are device events and snapshots on a shared GB10. The final plan leaves the generality and target-side assurance questions explicit.

## Step 5 — Verify the research handoff

The design now contains three ranked proposals, two Mermaid diagrams, primary-source citations, paired measurements, counterexamples and replay commands. Verified all 21 local design links and parsed every JSONL observation. Checked each ticket JavaScript script with `node --check`. The fresh TypeScript build and the 19 focused tensor tests passed again.

Docmgr closed all three tasks and the ticket. `docmgr doctor --ticket IRWB-023-A --stale-after 30` reported all checks passed. Both design and diary frontmatter validated, and `git diff --check` passed. The final commit is limited to the ticket directory.
