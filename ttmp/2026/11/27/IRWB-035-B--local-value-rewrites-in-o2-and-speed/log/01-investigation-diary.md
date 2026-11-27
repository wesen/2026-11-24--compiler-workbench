---
Title: Investigation diary
Ticket: IRWB-035-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:38.925361903-05:00
WhatFor: ""
WhenToUse: ""
---

# Investigation diary

## 1. Establish the observation at the revision boundary

The request asks “what share of the optimizer's edits are local value rewrites?” I traced the framework report back to Tx.rewrite and the generated-word covers back to the statement. IRWB-006 supplies the rule evidence, IRWB-008 demonstrates that intermediate parents and firing names can disappear, and IRWB-010 motivates comparing dynamic work with rewrite frequency.

The first npm ci --offline --no-audit --no-fund failed in esbuild's version check with spawnSync EPERM. The approved offline retry installed the lockfile and npm run build emitted dist. Probe 01 exercised ingest, strategy publication, lowering and emulator counters on algebra. Review the design before the classifier commit.

## 2. Recover the reason for a replacement

Design commit 6405801 fixed the denominator before measurement. classifyRevision consumes two adjacent Program revisions and returns one decision per edit. It matches table-backed edits in a private working store and inspects the existing range premise for strength. It reads correspondence to connect statement footprints and looks for IRWB-008 citation tokens separately from recovered matches.

The algebra test reproduced the nested sub-self plus add-zero record, rejected an incorrect target, and distinguished complete and partial citations. The second test exercised LICM, propagation and guarded strength reductions. npm run build and node --test tests/typed/edit-census.test.mjs passed. The corpus driver runs the actual PRESETS and records only published revisions. Sandbox tmux socket creation returned Operation not permitted, so the approved retry used a ticket-specific tmux server.

## 3. Measure the corpus and test the hypothesis

Implementation commit 31a9c2d supplied the classifier and drivers. Script 02 completed every named strategy on every project. Script 04 reconciled the edit array lengths and grouped the ledger by project, pass, pipeline, local rule set and function. The complete-pipeline function count uses the project/function pair so identical function names in different projects remain distinct.

All table and strength records matched their expected shapes. Including binding-dependent replacements in a second tally, or removing the highest-edit project, left local records in the minority. The report distinguishes proof-bearing citations, recognized rewrites and sampled execution footprints. The archived ledgers allow a reader to inspect the grouped results without rerunning the emulator.

### Original task

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
> - **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.
>
> Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.
>
> Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.
>
> Your ticket is IRWB-035-B. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.
>
> ## Your task (A0): what share of the optimizer's edits are local value rewrites?
> Research programme A rests on a hypothesis nobody has measured: if most of the value edits O2 and `speed` make are local rewrites (a small expression replaced by an equal one), a function's equivalence could be assembled from per-rule proofs instead of a sampled meaning check (`ttmp/2026/11/25/IRWB-006--...`, `ttmp/2026/11/26/IRWB-008--...` and `IRWB-010--...` describe verified rules and the exact checks built on them).
>
> - **Classify every edit** that the O2 and `speed` pipelines make on the corpus, using the correspondence and the edit records the framework keeps:
>   - **local rewrite:** a value replaced by an equal one, citing or matching a rule;
>   - **structural:** control flow, loop-invariant motion, inlining, unrolling, register allocation;
>   - **other.**
>
>   Define each class precisely enough that the classification is reproducible, and say how you decide the borderline cases.
> - **The share** per pass, per pipeline and per project, by edit count and by the instructions the edits affect.
> - **Of the local rewrites,** what share already cites a verified rule, and which rules or rule shapes would cover most of the rest.
> - **The classifier is a tool,** callable by other code, with a test, so later stages can rerun it.
>
> ## Measure and report
> - the classification method and its definitions;
> - the tables: per pass, per pipeline, per project;
> - the verified-rule coverage of the local rewrites, and the rules that would raise it most;
> - what the numbers mean for programme A (proof by rules instead of sampling), with the limits of the measurement;
> - the framework changes, if any, each with its reason.
>
> ## Repository facts
> - **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs` and `tests/workbench/*.test.mjs` before your last commit. Do not run the full suite (`npm test`): other agents share this machine. Prettier: 110 columns, single quotes; run it only on files that were formatted before you changed them. If you change anything under `src/framework/` or `src/workbench/`, also check that `node tools/build-site.mjs` still builds (the browser bundle cannot import Node built-ins).
> - **Scope:** you may change `src/typed/`, `tests/typed/`, `tools/` where the task needs it, and `src/framework/` where the framework does not fit, with each change and its reason recorded as a primary result. Do not change `src/tensor/`, the corpus's programs or their expected results, unless your task says so.
> - **Scripts:** put every probe, benchmark and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
> - **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
> - **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-035-B:`, as you go, so that your last commit always holds working code. Do not push.
> - **Outside your worktree,** use nothing.
>
> ## Final message
> - the ticket, design and report paths;
> - the headline shares (local, structural, other) for O2 and `speed`;
> - the verified-rule coverage of local rewrites;
> - the framework changes;
> - the last commit hash.

## 4. Validate the delivered census

The build succeeded under Node 24.18.0. Script 03 ran the requested Typed, framework and workbench files serially. Of 412 tests, 409 passed, zero failed and three opt-in Candela tests skipped. The output is in various/tests.log. Docmgr doctor passed. No compiler behavior, framework, workbench UI, Tix or corpus source was changed.
