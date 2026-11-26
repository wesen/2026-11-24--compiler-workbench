---
Title: Bytecode VM implementation diary
Ticket: IRWB-012
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/bytecode-vm/main.typed
      Note: Typed interpreter
    - Path: repo://corpus/projects/bytecode-vm/notes.md
      Note: Playground and measured ratios
    - Path: repo://corpus/projects/bytecode-vm/project.json
      Note: Fixture image and input domain
    - Path: repo://tests/typed/bytecode-vm.test.mjs
      Note: Differential checks and specialized measurement
ExternalSources: []
Summary: Implementation and validation of the corpus bytecode VM.
LastUpdated: 2026-11-26T00:00:00Z
WhatFor: ""
WhenToUse: ""
---

# Bytecode VM implementation diary

## Step 1 — Implement the VM with existing tape ingest

The Typed interpreter uses the designed two frame arrays, runtime dispatch
and shared fixture image. Both Node loaders accepted the project's tape setting
and reproduced the expected fixture results on the first probe.

### Prompt context

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed, a small statically typed language with TypeScript-like syntax, to 32-bit RISC-V (RV32IMF), built on an IR framework in which every optimization pass is checked against the original program. Your task: implement the corpus project designed in your ticket IRWB-012. The design document is in `ttmp/2026/11/26/IRWB-012--*/design-doc/`. It has been reviewed; implement it as designed. Where the design turns out to be wrong about the code, follow the code and record the deviation in your diary.
>
> ## Read first
> - Your design document.
> - `corpus/reference.md` and two or three existing corpus projects (for example `corpus/projects/sort`, `checksum`, `histogram`).
> - `tests/typed/project-meta.test.mjs`: `project.json` now supports `"ingest": { "tape": true }` (needed for frame arrays) and `"entries": [...]` (checks generate cases for the listed entry functions only), in `Program.fromProject`, `ingestProject` and `tools/parity.mjs`.
>
> ## Deliverables
> - The corpus project under `corpus/projects/<name>/` as the design describes (`.typed` sources, `project.json`, `notes.md`, any scripts the design calls for).
> - The tests and checks the design calls for, under `tests/typed/`.
> - Your ticket's diary (use your docmgr and diary skills), tasks and changelog, kept current as you work.
>
> ## Environment
> - `node_modules` is found from the repository root. Run `npm run build` once before using `dist/`.
> - Six agents share this machine. Run only your own tests (`node --test tests/typed/<your-test>.test.mjs`) and, for your project, `node tools/parity.mjs <name>` or `node tools/reference-check.mjs <name>` if useful. Do not run the full test suite (`npm test`), corpus-wide tools without a project argument, or anything that touches Candela.
>
> ## Constraints
> - Do not modify `src/`, `tools/`, other corpus projects, other tickets, or existing tests. Adding your project's id to `corpus/projects/index.json` is allowed.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Commit at sensible points on your current branch with messages starting `IRWB-012:`. Do not push.
> - Final message: what you built (paths), how it was checked (commands and results), what deviates from the design, and the commit hashes.
> Your ticket is IRWB-012. Your design document is `ttmp/2026/11/26/IRWB-012--bytecode-vm/design-doc/01-a-stack-machine-bytecode-vm-for-specialization.md`.

The implementation keeps the input bytecode dynamic and uses only the bounded
fixture domain for correctness and performance comparisons.

### What I did and why

- Registered `bytecode-vm` under Programs. The project has a single public
  function, so the default check roots already select `runVm`.
- Set `ingest.tape` in project metadata. The requested loader wiring and
  regression already exist in `Program.fromProject`, `ingestProject`, and
  `tests/typed/project-meta.test.mjs`. The project test exercises both loaders.
- Marked the opcode fetch as the source focus and configured the Explore
  script to run on a fresh copy.

### Evidence and design deviations

- `npm run build` succeeded before importing `dist/` on Node v24.18.0.
- A Node probe using `installVendor`, `Program.fromProject` and
  `ingestProject` loaded the real project and found exactly one function.
  At `n = 12, seed = 8`, the evaluator returned 1,152 in 4,131 statements and
  1,298,667,478 in 3,699 statements. Both calls completed normally.
- The r0 listing showed two 16-byte frame zeroes, both `load16[caddr(...)]`
  fetches, and the unsigned array index checks against 4. This confirmed that
  the project exercised the designed frame-array and checked-fetch paths.
- The implementation brief prohibits editing existing tests. The whole-corpus
  totals in `backend.test.mjs` predate this project and remain stale when it
  is included. The project-specific equivalent covers its additional
  reference-comparison cases.

## Step 2 — Verify the fixture domain and measure both images

The fixture test derives expected results from an independent JavaScript stack
machine. Separate Fibonacci anchor values and an exact BigInt checksum verify
the fixture behavior and dispatch formulas. The exhaustive comparison confirms
that each hand-specialized loop agrees with the r0 VM for its corresponding
entry and every scalar pair.

### What I did and why

- Ran the default checked `speed` pipeline. The seven changed passes each
  agreed on all 40 default gate cases.
- Replayed 100 generated cases and all 442 explicit calls. The r0 and final
  evaluator and RV32 runs, plus the reference RV32 compiler's output, agreed
  with the oracle and preserved the complete guest input memory.
- The current `tools/reference-check.mjs` ignores project arguments and
  iterates the whole corpus. The dedicated test builds and runs the independent
  reference compiler image directly on this project using the tool's
  `imageFromCode` and `runImage` path.
- Measured all three images with the same backend options (`coalesce: true`).
  The hand-specialized code lives in an in-memory test project and compiles
  through the same checked `speed` pipeline.

### What worked

- `node --test tests/typed/bytecode-vm.test.mjs` succeeded. This invocation
  reported one passing file and omitted its subtest diagnostics.
  `node --test --test-isolation=none tests/typed/bytecode-vm.test.mjs`
  exposed the individual results and reported three passing subtests.
- `node tools/parity.mjs bytecode-vm` reported seven published revisions,
  100/100 agreement, zero inconclusive cases and zero failures.
- The workbench loader opened the project and ran Explore with the open
  program still at r0. A workbench probe reproduced 7,678 and 6,874 RV32
  instructions at r0, and 9,286 and 8,218 at speed. The documented
  `asmDiff` call also worked and returned 384 rows.
- The exhaustive evaluator maxima were 4,131 at r0 and 5,350 at speed for
  Fibonacci, and 3,699 and 4,690 for checksum. Each finished below 20,000.
  At `n = 12, seed = 8`, the hand-specialized Fib and checksum took 75 and
  74 RV32 instructions, normalized against 184 and 160 dispatches.
  The full ratios and disassemblies are in the project notes.

### What didn't work

- The first scoped `git add` failed with
  `fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/impl-irwb-012/index.lock': Read-only file system`.
  The scoped commit succeeded with sandbox escalation.

### Review instructions

Start with the interpreter and project metadata, then compare the notes'
offsets with the image and the test's independent reference VM. The notes
report the observed increase in dynamic instructions after `speed` for
these fixtures. Reproduce the counts with the isolated test command above.
The implementation and checks are in commit `c2500fb`.
