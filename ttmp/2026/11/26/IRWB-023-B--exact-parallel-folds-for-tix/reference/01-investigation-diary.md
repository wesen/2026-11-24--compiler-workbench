---
Title: Investigation diary
Ticket: IRWB-023-B
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
Summary: Research sequence, falsifiers, measured deployments, failures and recovery.
LastUpdated: 2026-11-26T18:27:33.028288216-05:00
WhatFor: ""
WhenToUse: ""
---

# Investigation diary

## Step 1. Establish the executable question

I read IRWB-020-B and IRWB-022-I's designs and reports, then the evaluator, CUDA generator, lowering invariant, runner, and corpus definitions. The stage reports distinguish a sampled f64 acceptance condition from the f32 output actually computed by CUDA. I chose the ordered fold because changing a denominator changes a whole row of observations, and because parallel execution of this recurrence has a literature against which to test novelty.

### Prompt context

User request, verbatim:

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
> Your ticket is IRWB-023-B. This is a **research round: design and experiment, no changes to the product code.**
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
> 1. **A ticket, IRWB-023-B,** created with your docmgr skill, containing a design document (`design-doc/01-….md`) that covers:
>    - what "best in class" means for Tix, and how it would be measured;
>    - your proposals, ranked. For each: the idea; why it works (the theory); what is new; the evidence you gathered (experiments and results); the risks; how success would be measured; and what it needs from `src/framework`;
>    - a staged plan: what to build first, and why;
>    - what you tried that did not work.
>    
>    Include at least two Mermaid diagrams. Length is not scored. 4,000 to 10,000 words is a reasonable range.
> 2. **A diary** (your diary skill) recording your research, experiments and decisions, failures included.
> 3. **Commits** on your current branch, with messages starting `IRWB-023-B:`. Commit as you go, so that your last commit always holds a complete document. The session ends after about three hours. Do not push.
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

**Interpretation and intent.** Deliver a ranked, falsifiable research design, calibrated against a competitive exact GPU control. Base revision `12bc661`.

### Actions and reasons

Used docmgr's help, ticket creation and document creation in this worktree. Ran `npm run build`, then exercised the public evaluator with a three-term half-ULP row. Checked a warp shuffle and an explicit rounded add with `node tools/cuda-remote.mjs <ticket>/scripts/00-probe`. The purpose was to test the features before depending on them.

### Outcomes, failures and review

Build exit 0, Node 24.18.0, evaluator result 1; NVIDIA GB10 sm_121 reported `tie 3f800000`. No execution failures in these probes. A novelty search turned up Kapre and DeHon's 2007 sequential-equivalent parallel accumulation. I dropped the broad priority claim and chose to test a sufficient local certificate. The difficult point to review is translation at exponent boundaries and half-way ties. The next steps are to break that certificate in miniature and to time its actual cost on the board. The design links the paper, the CUDA source is small enough to inspect in full.

## Step 2. Try to break translation and measure an exact control

I implemented two adjacent predicted paths and compared *every chunk boundary* with a separately executed sequential fold. For 54 chosen rows I also called the public evaluator. Then I replaced the materialized GPU stages by a cooperative row block and compared the exact owner, chunk transfer, and conventional tree on the same inputs. The simplest strict schedule delivered most of the available benefit.

**Prompt context.** See Step 1. Previous checkpoint `090faaa`. The goal was to isolate changing the sum from changing the memory schedule.

**Actions and evidence.** Ran `01-transfers.mjs` and `03-miniature.mjs` locally after the build. Ran `02-benchmark.mjs 4096 1024 2 11` and `02-benchmark.mjs 127 997 80 11` through the locked runner. Reports live beside each script. The harness extracts actual generated kernels and interleaves variants after warmup. Captured original source hash in each remote receipt.

**What worked.** All exact GPU outputs matched the generated outputs, including the odd-width tail. Removing the parity, interior or full-path guard independently produced a concrete wrong answer in the four-bit model. Full-size owner and translated softmax both took about 0.36 ms, versus about 0.74 ms for Stage 2.

**What failed.** The prediction-only approach frequently returned wrong chunk ends. With width 32 it missed 3,374 endpoints out of 4,138 for the narrow exponential stream. Translation slowed the short-row workload relative to the owner. No tool failures in these runs.

**What was tricky.** The predecessor below an exact power of two is closer than the successor above. Repeating the calculation after shifting by an even number of ULPs can land in that asymmetry. Excluding the low boundary fixes it. Nonnegative terms also permit a directional proof because every exact pre-round sum stays above the start.

**Review and follow-up.** Compare the three mutations and their signed witnesses in `03-results.json`; inspect the clamps in `relocate`. The tree is numerically wrong but hardly faster at the large shape. Next isolate the exponential cost and try a target-specific exact fast path.

## Step 3. Enumerate the discrepancy and deploy the repair

The timing ablation pointed toward the exponential. I tried a small Taylor polynomial after table-based range reduction and compared each candidate with the existing rounded-double GPU oracle. An isolated sample near −1 made a cubic look exact. The complete active range found 903 exceptions with 128 cells and one with 1,024 cells. Correcting the last one made a large enough performance difference to move this proposal ahead of speculative reduction.

**Prompt context.** See Step 1. Previous checkpoint `f0b392a`. Build `npm run build` before the drivers. Minimal probes checked explicit FP64 FMA/range reduction over 1,024 words, Python Decimal.exp and BigUint64 table serialization. The public framework's simple `verifyTransformation` invariant probe also passed.

**What I ran.** `04-run.mjs sweep` enumerated the central range, with separate sweeps of the two constant-output bands. `07-midpoint.py` located the rare failure at both 60 and 100 decimal digits. `06-cross-check.sh` streamed device bytes to SHA-256, recomputed every word on Node, and checked the digests across three adjacent intervals. `04-run.mjs bench` used the same executable with rotating order and 15 measurements per variant. `08-meaning-gap.mjs` actually executed two incorrect CUDA candidates through the current checker. All raw data, versions and commands accompany the design.

**Failures and recovery.** CUDA expf and every unpatched polynomial had counterexamples in the active interval. The initial detached invocation `tmux -L irwb023b new-session -d -s exp-audit ...` left no audit receipts. `tmux -L irwb023b list-sessions` returned `no server running on /tmp/tmux-1000/irwb023b`. I reran with explicit working directory and a foreground `tmux wait-for audit-finished` attached to the calling shell. All three intervals then completed. The interval checker explicitly compares both endpoints, word count and digest.

**What worked and why.** The cubic absolute approximation error usually stays in the target rounding cell. A one-word change for the exception preserved the hot path. All negative normal/subnormal words, −0 and −∞ were exercised on both machines. The f32 scalar scope and exact coverage make this stronger than testing a large random tensor.

**Review and next decision.** Inspect `04-exp.cuh` for operation order and bit scaling, `05-kernels.cu` for the shared out-of-line device routine, and `06-*-node.json` for independent reference bytes. The single bad input maps to the same table coefficient for both successful polynomials. Try correcting the coefficient under full-domain constraints instead of branching on a rare argument.

## Step 4. Fit a table or exhibit a pair of incompatible inputs

Both polynomial kernels addressed the same fractional-octave table entry at the rare failure. I treated the last f32 word as an interval constraint on one binary64 coefficient. A 32-input probe found that moving the 1,024-cell cubic entry up by five raw double-word steps sufficed locally. The full run established the admissible interval and returned contradictory pairs for the cheaper small tables.

**Prompt context.** See Step 1. Last completed checkpoint `4f30afe`. Git staging on the preceding checkpoint first reported `fatal: Unable to create .../index.lock: Read-only file system`; the approved scoped `git add -- <ticket>` retry succeeded.

**Actions and evidence.** `10-run.mjs fit` computed lower/upper coefficient bounds over all 265,289,728 central input words. I compiled the selected tables into separate executables. In that harness the row named `cubic` denotes the selected polynomial, including the quadratic and quartic runs. The dedicated `11-deploy.cu` uses the unambiguous name `quadratic`. It contains one out-of-line routine, called by both the exhaustive auditor and the timed kernel. Each benchmark also runs the actual generated code. `11-qualify.sh` repeated the independent scalar audit, then compared three entire tensors with the public evaluator. The SHA of the exact binary is in each receipt.

**What worked.** The 16,384-cell quadratic needs one changed coefficient, at index 16,124. Its only coefficient change is +4. The final kernel took 0.175072 ms at the main size against 0.744544 ms for generated kernels. A 12-case width/shape sweep also passed. The 1,024-cell quadratic has 659 intrinsically conflicted cells under this one-coefficient formulation. It is possible to refute optimization families, not just individual binaries.

**What failed.** The first run of `09-plan-gate.mjs` returned `Error: IR data cannot contain undefined` when the success result included an absent reason. Omitting that field on success let the manager record the invariant. It accepted two valid submissions and rejected ten mutations for both calibrated and patched manifests. The small-window 4,096-cell quadratic had seven conflicting cells and two whose allowed shift lay outside the searched window; only the former have two-input impossibility evidence.

**Review and next decision.** Inspect the packed witness/offset atomics in `10-calibrate.cu`, the independent SHA check and the actual v6 postcondition. The result depends on monotonicity in a *single* coefficient with all other instructions fixed. A different basis or mixed degree could resolve an empty intersection. The next transfer test is the four-statement region in attention with the original score and value contractions retained.

## Step 5. Transfer to attention and independently check both executables

I extracted the four-definition affine pattern into the reusable region matcher. It found softmax and the middle of attention, rejected an escaping private temporary and declined a split attention revision. The GPU attention probe kept the generated score and value contractions and replaced only the four middle launches by the row template. This tested the value of the proposal inside a larger program and the price of rebinding the evidence after a link.

**Prompt context.** See Step 1. Prior checkpoint `a2dae6e`. The same-shape softmax comparison used an actual streaming kernel in the deployment executable. The remaining question was whether that gain survives integration.

**What I ran.** Corpus discovery `12-discover.mjs`, the real attention benchmark at 7/33/5/3 and 1024/1024/64/64, the public f32 attention evaluator at both shapes, and a second complete qualification of the newly linked scalar routine. The full attention CPU oracle took 40.64 s here. The full logits and outputs used independent input generation in CUDA host code and Node; their common seed is 23023.

**What failed and how I verified recovery.** The first attention executable gave numerically equal outputs and showed 1.048160 versus 0.759008 ms at full size. At the smaller shape it gave 0.019840 versus 0.010624 ms; the isolated regions took 0.047360 and 0.004416 ms. Its subsequent `10-run.mjs attention-audit quadratic 00000000 33000000` printed the expected byte digest but exited 134 with `*** stack smashing detected ***: terminated`. I discarded that executable's qualification. Inspecting the joined source showed that I had renamed the softmax `main` to a non-main function that could reach its closing brace without returning an int. Only C++ main receives an implicit successful return. I removed the renamed entry point, called the audit helper directly and returned explicitly. A 1,024-word device/Node probe then passed. I repeated both benchmarks, all three scalar intervals and both whole-program oracle comparisons with the corrected executable. The first error text is preserved in `13-failed-audit.log`.

**What worked.** The corrected 15-interval measurements were 1.045792 and 0.757056 ms for full generated and selected attention. The isolated fused region took 0.047264 ms. At the asymmetric small size the respective medians were 0.019840, 0.011520 and 0.004480 ms. All 65,536 or 21 returned words agreed with the public evaluator. The attention executable SHA-256 begins `84d9d70f`; its three exhaustive output hashes match Node as well. This supplies a second measured integration while preserving the exact contraction order. A separate local replay added the direction-aware boundary ablation to the chunk study. It recovered all 4,010 half-ULP replays at width 32 and zero extra narrow-exponential chunks.

**Review and decision.** Compare `12-row-region.mjs` with the source/evaluation rules and inspect `13-attention.cu` to see precisely which generated kernels survive. The schedule checker proves restricted source obligations. It trusts the template implementation. The strongest empirical evidence is per deployed scalar binary; the whole-program observations cover the named inputs. Rank domain-specific intrinsic fitting first, exact region fusion second, and leave speculative folds behind a performance gate.

## Step 6. Verify the delivered evidence

The offline receipt checker tied each complete scalar sweep to the binary and execution profile timed in its own campaign. It also matched the independent public-evaluator outputs for 15 softmax calls (8,544,452 words) and two attention calls (65,557 words). This is the final review entry for the Step 1 request.

`npm run build` had passed before the experiments. The final `node --test tests/tensor/corpus.test.mjs` passed all six corpus tests. Syntax checks passed for every ticket MJS file; all JSON receipts parsed. During the link check, `A[t](1+u)` was interpreted as a Markdown link. I added explicit multiplication symbols and reran the check. All local links now resolve, the design contains three Mermaid diagrams, frontmatter validated and `docmgr doctor --ticket IRWB-023-B` passed. All three ticket tasks are checked and the ticket is complete. Review the final results with `node <ticket>/scripts/14-verify-receipts.mjs`.
