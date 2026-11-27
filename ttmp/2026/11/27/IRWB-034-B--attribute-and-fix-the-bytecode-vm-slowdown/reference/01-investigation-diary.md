---
Title: Investigation diary
Ticket: IRWB-034-B
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:11.619680727-05:00
WhatFor: ""
WhenToUse: ""
---

# Investigation diary

## Step 1 — Establish the comparison

Committed the design in a3d2f4f. IRWB-012's implementation diary and project test identify coalescing as the lowering option for the published VM counts. All comparisons use the bundled emulator.

### User request (verbatim)

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
> - **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.
>
> Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.
>
> Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.
>
> Your ticket is IRWB-034-B. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.
>
> ## Your task (D1): why `speed` makes the bytecode VM slower
> At `n = 12, seed = 8`, the `speed` pipeline takes the bytecode VM project's Fibonacci from 7,678 to 9,286 RV32 instructions, and its checksum from 6,874 to 8,218. It is the only one of the six programs of IRWB-012 to IRWB-017 that the optimizer makes worse (`ttmp/2026/11/26/IRWB-012--bytecode-vm/`, `corpus/projects/bytecode-vm/`).
>
> - **Find the cause from the compiler's own records, not by guessing.** Every executed instruction maps back through correspondence to the passes and rules that produced it. Build the attribution: credit executed instructions (or their difference against r0) to the decisions that caused them, and show which decision costs the extra instructions (an inline, an unroll, a hoist and its register pressure, or something else).
> - **Then fix it in the compiler:** a guard, a cost check, or a better decision. The bytecode VM's instructions under `speed` at or below r0's, no regression in the corpus totals of the other projects, and parity clean.
> - **The attribution is a tool, not a one-off:** the next stage (missed optimizations from provenance) reuses it. Make it a function or tool other code can call, with a test.
> - **New approaches are welcome,** for example attribution that follows instructions through several passes, or a cost model checked against the emulator's counts. Report what worked and what did not.
>
> ## Measure and report
> - the attribution: method, and the table of decisions and the instructions credited to each, for the bytecode VM under `speed`;
> - the fix and its reason;
> - instructions per corpus project under O2 and `speed`, before and after;
> - the framework changes, each with its reason;
> - which results you measured and which you only argued.
>
> ## Repository facts
> - **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs` and `tests/workbench/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them. If you change anything under `src/framework/` or `src/workbench/`, also check that `node tools/build-site.mjs` still builds (the browser bundle cannot import Node built-ins).
> - **Scope:** you may change `src/typed/`, `tests/typed/`, `tools/` where the task needs it, and `src/framework/` where the framework does not fit, with each change and its reason recorded as a primary result. Do not change `src/tensor/`, the corpus's programs or their expected results, unless your task says so.
> - **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
> - **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
> - **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-034-B:`, as you go, so that your last commit always holds working code. Do not push.
> - **Outside your worktree,** use nothing.
>
> ## Final message
> - the ticket, design and report paths;
> - the cause, and the fix;
> - the bytecode VM's instructions under r0, O2 and `speed`, before and after, and the corpus totals;
> - the framework changes;
> - the last commit hash.

### Setup and failures

Node reported v24.18.0. The worktree had no installed compiler. `npm ci --offline` hit `spawnSync .../esbuild/bin/esbuild EPERM`; the approved offline install succeeded, then `npm run build` succeeded. The first Git staging command failed with `index.lock: Read-only file system`; the approved worktree Git command recorded the design. Initial tmux creation reported `Operation not permitted`; the approved ticket-specific server ran the corpus benchmark.

## Step 2 — Isolate LICM and test its counterfactual

Script 01 replayed both entries for every published revision. r4 was the first increase. Disabling only LICM gave 6,688 and 5,968 at the end of speed. Zero allocator spills and nine blocks inserted for the same header led to testing control-flow placement directly.

Script 03 joined inserted statements to hot machine words and requested the reverse provenance of a frame-address instruction. The nine loop facts each had a different latch. Splitting one fact's incoming edges makes another latch execute its preheader. A shared-header guard is local to LICM and preserves the existing per-backedge facts consumed by other passes. Review the causal table and limitations in the analysis document.

## Step 3 — Validate the guard and retain the evidence

The baseline profiler and the exact compiler it diagnosed are in 3a4cc49. The guard and compiler tests are in ca9e3cd. The same guard improved regex-nfa as well as the VM. The corpus table, individual PC records and fixture-domain measurements are linked from the report.

One after-run started before TypeScript finished emitting the guard and reproduced the old VM counts. I stopped that session, waited for a successful build, checked that dist contained the guard, then reran the entire measurement script. Only the rerun is retained as after evidence.

The tests cover the accounting identity, both dispatch entries and a positive single-latch hoist with provenance. Check the CFG reasoning in passes.ts, then the gross-versus-net table in the report. Further work, if valuable, is to find profitable hoists over the union of a shared header's latch bodies.
