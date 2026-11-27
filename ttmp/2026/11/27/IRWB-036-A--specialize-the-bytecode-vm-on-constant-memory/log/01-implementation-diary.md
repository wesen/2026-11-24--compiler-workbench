---
Title: Implementation diary
Ticket: IRWB-036-A
Status: active
Topics: []
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:51.632088609-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1. Inspect the lifted VM and design the pass

Node v24.18.0 built the current worktree. The lift probe reproduced two `load16u(caddr(...), 4)` bytecode reads and two frame arrays totaling 32 bytes. Both the bytecode PC and the stack index are ordinary Typed locals, so the residualizer can use existing liveness and transactions.

The current ticket tree has the bytecode design in IRWB-012 and prior constant-memory research in IRWB-007. IRWB-009 concerns function-incremental analyses and IRWB-010 concerns rewrite search in this checkout. The scalar and field implementation is in `src/typed/specialize.ts`.

`npm ci` first failed with `spawnSync .../node_modules/esbuild/bin/esbuild EPERM`. The escalated retry installed the locked dependencies. The first lift probe resolved imports under `ttmp/tools` and failed with `ERR_MODULE_NOT_FOUND`. Correcting the relative imports to reach the worktree root made the probe pass.

### Prompt context

The user requested the following.

```text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.

Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.

Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.

Your ticket is IRWB-036-A. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.

## Your task (B1): specialize the bytecode VM on its bytecode, a first Futamura projection
The bytecode VM (`corpus/projects/bytecode-vm/`, ticket `ttmp/2026/11/26/IRWB-012--bytecode-vm/`) runs a bytecode program from a buffer. Hand-specialized loops for its two programs take 75 and 74 instructions, against 7,678 and 6,874 for the general VM. The existing specialization (IRWB-009 and IRWB-010, `src/typed/specialize.ts`) binds scalar values and fields, not memory, and binding scalars here gains almost nothing.

- **Specialize on a constant buffer:** a host promise that a buffer's contents are fixed, checked as the field binding is checked, and a binding-time analysis that propagates it through loads from that buffer.
- **Specialize the dispatch loop** on a known program counter: when to unroll it, how to stop, and how the result stays checked by the meaning contract.
- **Measure how much of the gap** to the hand-specialized 75 and 74 instructions automatic specialization closes, and what it costs in code size.
- **New approaches are welcome,** for example polyvariant specialization with a size budget, or a check that the promise holds at run time. Report what worked and what did not.

## Measure and report
- the binding-time analysis and the dispatch-loop specialization, with their checks;
- instructions and code size of the specialized VM for both programs, against the general VM and the hand-specialized loops;
- what stops the specialization, and where it falls short;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs` and `tests/workbench/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them. If you change anything under `src/framework/` or `src/workbench/`, also check that `node tools/build-site.mjs` still builds (the browser bundle cannot import Node built-ins).
- **Scope:** you may change `src/typed/`, `tests/typed/`, `tools/` where the task needs it, and `src/framework/` where the framework does not fit, with each change and its reason recorded as a primary result. Do not change `src/tensor/`, the corpus's programs or their expected results, unless your task says so.
- **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-036-A:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use nothing.

## Final message
- the ticket, design and report paths;
- the instructions and code size for both programs: general, specialized, hand-written;
- the framework changes;
- the last commit hash.
```

The design was committed as `88d9a9d`. The first commit attempt failed with a read-only Git index lock path and succeeded after escalation.

## Step 2. Implement the checked residualizer and frame experiment

The new binding accepts a whole u16 cell sequence. The host stages the updated case domain while the pass runs and publishes it with the revision. The residualizer walks variants of the source CFG and specializes a checked load only after establishing the buffer identity and in-range index. The frame experiment audits all memory accesses and frame addresses before replacing words with locals.

The first build found TS2775 for a dynamically imported TypeScript assertion and TS7006 for an untyped array callback. A static assertion import and typed callback corrected these. The first benchmark expected 40 checks per pass and got `80/80` for the hand baseline's two functions. The benchmark now expects 40 per function. The default tmux socket access returned `Operation not permitted`, so the build and benchmark use a dedicated socket.

The first focused run passed five of six tests. The VM test expected the promotion gate to report `40/40` and received `undefined`, the pass API's unchanged result. The `speed` listing showed LICM had hoisted `aaddr` into `inv*` locals. This obscured the direct slot addresses the audit requires. Running `dce, cfg` before promotion removes unused address temporaries and preserves direct addresses. Then `speed` runs on scalar locals. The corrected build and all six focused tests passed. The negative ordering remains in the benchmark.

### Code review and reproduction

Start with `Program.specialize` and `residualize` for assumptions and relevance of the static state. Inspect `promoteFrameSpec` for the address and initialization audit. Run `npm run build`, then `node --test --test-isolation=none tests/typed/specialize{,-memory}.test.mjs`. The benchmark and result counts are in the final report.


## Step 3. Verify alias rejection and analysis invalidation

The implementation checkpoint was `1f8ee9c`. A follow-up test wrote through a buffer alias on one arm of a runtime branch. The residualizer refused it and the original revision still read 7 without the write and 9 with it. The tested promise therefore depends on writes reachable in the static walk, including either arm of a dynamic branch.

Code review found two state issues before the final test run. A caller editing the input specification returned by `Program.inputs` could change the active buffer assumption through a shared array. The getter now copies the assumed cells. Frame promotion changes loop-assigned locals, so the promotion pass no longer declares loop analysis preserved. The regression runs promotion with the old loop analysis already requested. Rebuild and the requested test groups run after these corrections.


## Step 4. Keep the experiment opt-in

The first completed 56-file suite reported 410 passes, one failure and three skips. `tests/workbench/strategies.test.mjs` expected 15 built-in passes from `wb.compiler()` and received 16. Frame promotion now exports a checked `TypedPass` for explicit application, as the benchmark needs it at one specific point in the pipeline. The named built-in pass catalog keeps the existing workbench contract. The benchmark and regression test use the explicit pass, and the same file selections are running again on that revision.

## Step 5. Publish the measured results

The catalog regression passed in isolation and in the final 56-file run. The final build, requested test selections, browser bundle, and benchmark exited successfully. The suite reported 411 passes, no failures, and three opt-in skips. The benchmark again confirmed both cleaned variants against r0 across all 442 calls and reproduced the RV32 sizes and instruction counts in the report.
