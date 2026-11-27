---
Title: Implementation diary
Ticket: IRWB-034-A
Status: active
Topics: []
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/scripts/01-measure.mjs
      Note: Reproduces the revision and corpus instruction counts
    - Path: repo://ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/scripts/02-inspect-licm.mjs
      Note: Connects loop records to backend instruction reasons
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:43:59.638985689-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

<!-- Log entries in reverse chronological order (newest first) -->


## Step 1 — Commit the design and reproduce the regression

I read the pass contracts and correspondence model, followed the Typed
pipeline and image-lowering entry points, and committed the design before
changing compiler code. The Node 24.18.0 measurement probe confirmed that
the vendored emulator's per-word counters sum to its step total. Running
with coalescing reproduces the published pair of counts exactly.

### Prompt context

User request, verbatim:

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
> - **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.
>
> Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.
>
> Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.
>
> Your ticket is IRWB-034-A. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.
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
> - **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-034-A:`, as you go, so that your last commit always holds working code. Do not push.
> - **Outside your worktree,** use nothing.
>
> ## Final message
> - the ticket, design and report paths;
> - the cause, and the fix;
> - the bytecode VM's instructions under r0, O2 and `speed`, before and after, and the corpus totals;
> - the framework changes;
> - the last commit hash.

The intended result is a measured compiler fix and a reusable way to follow
executed words through a revision chain. The design commit is
`67b2eab`.

### Evidence and failures

- `npm run build` worked with the available compiler. The subsequent
  `npm ci --offline` reached the esbuild installer, whose binary check
  failed with `spawnSync …/esbuild/bin/esbuild EPERM`. The escalated
  invocation installed the six locked packages.
- The initial constrained `git add` hit a read-only worktree index lock.
  Escalation let Git commit the design.
- Script 01 first used five parent segments in imports and failed with
  `ERR_MODULE_NOT_FOUND` for `ttmp/tools/node-vendor.mjs`. Six segments
  reached the worktree root. Script 02 first imported `show` from
  `model.js` and failed ESM named-export resolution. The function is
  exported by `listing.js`.
- Read script 01's VM timeline first, then inspect script 02's loop and
  instruction-selection evidence. They show that LICM is the sole
  increasing pass, with or without copy coalescing.

## Step 2 — Isolate the hot-path work

LICM saw one natural loop per back edge. All nine VM loop records share
the same header. For each record, LICM treated the sibling latches as
outside predecessors and redirected their back edges through generated
preheaders. Its edits show 15 hoists of frame-array base addresses. The
emulator shows those address instructions growing by 2,407 and 2,083
executions, with zero allocated spills. A probe with chain layout removed
the extra jumps at the LICM boundary but left the address work intact.

Omitting LICM recovered the r3 counts under coalescing. The candidate fix
merged the per-back-edge bodies before redirecting edges and hoisted the
same number of expressions. It produced 6,382 and 5,710 instructions
under coalescing. The remaining review point is whether any other
multiple-latch loop loses more from the more accurate invariant set than
it gains from proper preheader placement. The paired corpus run measures
that question.

## Step 3 — Follow surviving edits and preserve reference comparisons

The attribution API and its focused test passed before the LICM
change. The test follows an executed Blend instruction from its hoisted
statement through an earlier constant propagation and back to r0.
VM script 03 credits each word once and also reports every LICM
association. It reaches the 2,748 and 2,376 frame-address executions
through the final CFG moves. The focused fixture regression asserts
that both speed images stay at or below r0 for n = 12 and seed = 8.

The first broad run found one rule comparison failure. The B1 test
compared the complete edit record against a hand-written pass that has
no named rules. I made its signature omit only the new rule evidence.
It continues to compare artifact revisions, structural edits, and
correspondences, including the deliberate changed-rule counterexample.
The attribution test checks that the rule-table path supplies rule
evidence.

## Step 4 — Qualify the correction with backend extras

The first paired corpus run showed zero regressions with default options
or coalescing. With chains, coalescing and homes enabled, regex-nfa O2
rose from 392,605 to 434,313 steps. The option ablation in script 05
loaded a transpiled copy of the old pass from the current branch's
history and reproduced both totals. Chained layout selected a variant
with 41,337 extra reloads and 10,414 extra stores. Its cost estimate
did not predict that dynamic effect.

I tried sharing hoisted frame addresses of the same offset inside each
combined loop. Script 06 transpiled the candidate pass with the locked
TypeScript package and installed that one pass for checked O2 and speed
runs. It measured regex O2 at 376,740 with all extras and the VM
fixtures at 6,349 and 5,677 with coalescing. This left the backend's
selection policy and the single-latch LICM path alone. The final corpus
run used the normal build and named pipelines.

A private tmux socket initially failed with `Operation not permitted`
in the sandbox. The escalated tmux probe created the session in
`dist/`, and the validation commands could then spawn isolated Node
test workers there. Full test diagnostics and parity summaries were
read from the command outputs.

The preliminary script 06 total of 376,740 included direct benchmark
calls to the `inRange` helper. I aligned the probe with the project's
configured entry roots. The paired 100-case regex O2 result is 376,332
with all backend extras enabled. All final corpus comparisons use entry
roots consistently.

## Step 5 — Verify and report the final build

The final `npm run build` succeeded. The requested three test groups
reported 408 passes, three skips and zero failures. The optimization
parity command and both reference-check modes had 8,286 agreements
and 14 inconclusives. The paired corpus comparator returned no
regressions for O2 or speed in any of the three measured backend
configurations. The report includes all 50 coalesced project rows and
links the raw measurements for the other configurations.

Review the shared-header grouping and address reuse in `src/typed/passes.ts`,
then the reverse correspondence traversal in
`src/typed/backend/attribution.ts`. The tool follows the pass's changes
through the existing Typed revision and image correspondence.
