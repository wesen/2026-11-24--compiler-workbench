---
Title: Investigation diary
Ticket: IRWB-023-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
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
