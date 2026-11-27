---
Title: Implementation diary
Ticket: IRWB-036-B
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:44:14.551445756-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## 1. Read the interpreter at r0

The requested experiment is to “specialize the bytecode VM on its bytecode, a first Futamura projection”. The repository’s IRWB-012 tests contain the two hand-written loops and an exhaustive finite input grid. The two other ticket numbers in the brief refer to incremental analysis and rewrite search in this checkout. The executable scalar/field baseline is src/typed/specialize.ts.

Ran npm run build and script 01. The first relative import climbed one directory too far and Node reported ERR_MODULE_NOT_FOUND for tools/corpus.mjs. Correcting the path produced the dispatch and frame-memory listing. This supports an IR interpreter with static control and residual word locals without any opcode table.

<details>
<summary>Original task brief</summary>

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`, each project a Typed program with its own `project.json`; the workbench UI in `src/workbench/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`), which your task does not touch.

Every Typed optimization is a checked pass. The meaning contract compares a pass's output with the program before it on generated cases, the RV32 backend runs images in an emulator and counts executed instructions, and every edit carries a correspondence back to the IR before it. The pipelines (O0, O1, O2, `loops`, O2+, `speed`) are named strategies in `src/typed/strategies.ts`. The reference compiler and its parity checks are in `vendor/` and `tools/parity.mjs`, `tools/reference-check.mjs`.

Read first: `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, and the tickets under `ttmp/2026/11/24/` to `ttmp/2026/11/26/` that your task names.

Your ticket is IRWB-036-B. This is a **research and implementation stage**, in one session of up to three hours. Write a design first and commit it. Then implement, test, measure, and write a final report in the ticket.

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
- **Tickets and commits:** use your docmgr and diary skills for the ticket and diary. Commit on your current branch with messages starting `IRWB-036-B:`, as you go, so that your last commit always holds working code. Do not push.
- **Outside your worktree,** use nothing.

## Final message
- the ticket, design and report paths;
- the instructions and code size for both programs: general, specialized, hand-written;
- the framework changes;
- the last commit hash.
````

</details>

## 2. Build and measure the residual graph

Implemented a worklist keyed by block ID and the existing liveness analysis's projection of the static environment. A static CheckedAddress disappears only inside an in-range u16 fetch. A dynamic or failing checked read is copied into the residual. Frame word promotion permits explicit entry zeroing and proven word stores. Unsupported memory operations abort the transaction.

Script 02 measured the standalone general, residual and hand-written images with identical coalescing. Scalar entry binding alone added one executed instruction. Ordinary speed cleanup reduced hundreds of residual instructions to 164 and 139. A further experiment ran subst until stable. The IR changed, but neither image improved. Inspecting the four-block listings explains why: the remaining assignments reuse the same promoted VM stack word several times per loop body; subst requires a unique definition.

During development the first invocation of script 02 ran before the rebuild completed and reported “typed.bindings: malformed binding” from the prior dist. TypeScript also reported TS2775 for a dynamically imported assertion function. Importing validateArtifact statically fixed the build; running the benchmark on the rebuilt code gave the results in various/02-results.txt.

## 3. Recover the scalar loop

The block-local live-range experiment shortened Fibonacci from 164 instructions to 77 and checksum from 139 to 77. The prototype walked each block, kept names shared with successors, and split the other definitions before retrying substitution. Script 04 now invokes the production checked pass. The implementation uses reaching definitions to rewrite reads and liveness to protect successor reads; the pass is opt-in and uses the same transaction and meaning gate as the other Typed passes.

The final comparison checks out the first speed revision before splitting. That keeps the unsuccessful extra-substitution experiment out of the optimized path. The benchmark prints the number of created block states and checks the final emulator image exhaustively.

## 4. Check provenance and the final revisions

Review of the total correspondence found that Typed recorded a newly allocated local's display name, while the IR projection identifies that local by index. Tx.local now records the projection target and source when the pass supplies a source. Typed's revision correspondence groups that edge with the other entities derived from the same source. The changed-bytecode test checks every newly projected entity has a predecessor. This is a Typed adapter change.

The sandbox denied the tmux socket with “Operation not permitted”. Running the requested validation under approved tmux succeeded. During development one suite run picked up the new split regression while its dist still lacked the pass and reported “[unknownPass] no pass named split-local-ranges”. The rebuilt focused suite passed. The final gate uses script 03 on the completed source.

The full gate then caught a catalog regression in tests/workbench/strategies.test.mjs. It reported “actual: 16, expected: 15”. The named built-ins are a tested workbench surface. Exporting splitLocalRanges as a pass object, like the bindings pass, retains that surface and makes this experiment available through Program.apply. The optimizer and its checks are identical. Implementation checkpoint before the catalog fix was 2dc281e.

The final build and all three requested test groups finished with 412 passes, zero failures and three opt-in skips. Script 02 --split reran on that build and reproduced both 48-byte images, 77 executed instructions per image and 221 agreeing corpus calls per entry.
