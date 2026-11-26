---
Title: Research diary
Ticket: IRWB-023-A
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
