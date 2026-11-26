---
Title: Implementation diary
Ticket: IRWB-013
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/sha-chacha/main.typed
      Note: Tape kernels and hot loops
    - Path: repo://corpus/projects/sha-chacha/project.json
      Note: Entry roots and input generators
    - Path: repo://corpus/projects/sha-chacha/scripts/explore.js
      Note: Fixed-case instruction measurements
    - Path: repo://tests/typed/sha-chacha.test.mjs
      Note: Independent vectors, statement budgets and generated image checks
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-26T11:58:21.591018719-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1 — Implement the kernels with Tape ingest

The current Node loaders already honor Tape metadata. The new project
declares both public entry points and retains generators for the scalar
helpers, which the project test can call explicitly.

### Prompt Context

**User prompt (verbatim):**

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed, a small statically typed language with TypeScript-like syntax, to 32-bit RISC-V (RV32IMF), built on an IR framework in which every optimization pass is checked against the original program. Your task: implement the corpus project designed in your ticket IRWB-013. The design document is in `ttmp/2026/11/26/IRWB-013--*/design-doc/`. It has been reviewed; implement it as designed. Where the design turns out to be wrong about the code, follow the code and record the deviation in your diary.
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
> - Commit at sensible points on your current branch with messages starting `IRWB-013:`. Do not push.
> - Final message: what you built (paths), how it was checked (commands and results), what deviates from the design, and the commit hashes.
> Your ticket is IRWB-013. Your design document is `ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/design-doc/01-sha-256-and-chacha20-corpus-project.md`.

**Assistant interpretation:** Implement and verify the reviewed corpus design within the current worktree.
**Inferred user intent:** Provide independent correctness checks and a reproducible optimization workload for each kernel.

### What I did

- Read the reviewed design, corpus API and the sort, checksum and
  histogram projects.
- Added the frame-backed SHA schedule, scalar ChaCha state, and the
  full input fixture, including the low-half-first SHA constant table.

### Why

The existing metadata fields make the two kernels the public check
roots. Helpers retain bounded generators so the project-specific test
can independently exercise their ABI, including the four-word return.

### What worked

- `npm run build` exited 0. A small Node Tape probe evaluated a 64-word
  frame, unsigned shift of a signed hex literal, and four-word record
  return together. Its result was `[0, 47975, -1150833018, 0]`.
- The first r0 smoke checks completed without traps. Empty SHA used
  4,132 statements and all-zero ChaCha used 2,568.

### What did not work

The first r0 Node smoke probe failed with `[notCompiled] prog:sha_chacha
did not compile: expected function`. Moving the record declaration above
all functions resolved the parser error. The next probe failed with
`expected mutable local a` at line 100, column 7. The quarter round now
copies its immutable parameters into four explicit mutable locals.

### What I learned

`Program.fromProject` and `ingestProject` already forward Tape metadata.
The reference runner has no project filter, even if given a project ID.
The project-specific test can supply reference signatures directly and
run the in-tree O2 image comparison using the same generated cases.

### What was tricky to build

The SHA digest uses big-endian byte serialization while each external
word uses low-half-first cell order. ChaCha uses the same cell order and
little-endian byte serialization.

### What warrants a second pair of eyes

Check the diagonal quarter-round indices and output word order against
the complete published vectors.

### What should be done in the future

The design's aggregate backend and SSA expectation edits are outside
this worktree's assigned scope.

### Code review instructions

Start with `main.typed` and `project.json`. Use the project-specific
test for the vector and image assertions.

### Technical details

`project.json` focus points at the SHA compression-loop header. Corpus
discovery includes the project directory automatically.

## Step 2 — Check vectors, images and the optimization workload

Published SHA-256 and ChaCha20 vectors agree with the evaluator and
the reference, O2, and checked speed images. The fresh workbench script
also runs the two fixed blocks on r0 and speed and leaves the open
project at r0.

### Prompt Context

**User prompt (verbatim):** See Step 1.
**Assistant interpretation:** Verify both kernels end to end within the project.
**Inferred user intent:** Make correctness and instruction counts reproducible for compiler experiments.
**Commit (code):** `109b6db` — IRWB-013: add SHA-256 and ChaCha20 corpus kernels.

### What I did

- Added a project-only test covering the empty and `abc` SHA vectors,
  a 55-cell SHA block, and the two ChaCha20 vectors from RFC 8439.
  Each vector checks all output words, the signed scalar result, and
  the input buffers.
- Compared 100 generated cases per function to the reference, O2, and
  speed images. Reused each r0 case across those images. Checked every
  generated SHA digest against the framework's `sha256` oracle.
- Ran the length-55 SHA block and RFC section 2.3.2 ChaCha block at
  every speed revision with a 20,000-statement limit.
- Inspected the RV32 listings for source lines in both hot loops.
  Ran the fresh script through the workbench project loader.

### Why

The full published vectors verify byte order as well as the arithmetic.
Generated reference comparisons verify lowering over more inputs.
The direct `quarter` cases specifically exercise the reference ABI with
four return words.

### What worked

- `node tools/parity.mjs --json sha-chacha` reported 200/200 entry
  cases, 14 changed revisions through r14, zero rejected passes, and
  zero inconclusive cases or disagreements.
- `node --test tests/typed/sha-chacha.test.mjs` passed. Running the
  same file directly reported both subtests and the budget diagnostics.
- SHA statement counts were 4,737 at r0, 3,928 at r14, and 6,465 at peak.
  ChaCha counts were 2,568 at r0, 2,259 at r14, and 3,528 at peak.
- The selected project metadata and notes round-tripped through
  `formatJson` and `wrapProse`. The focus points at line 43.

### What did not work

The first `git add -- corpus/projects/sha-chacha …` failed with
`fatal: Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/impl-irwb-013/index.lock': Read-only file system`.
The escalated staging and commit calls succeeded.

### What I learned

The standalone reference runner lacks both signature forwarding and a
project filter. The project test supplies signatures to
`imageFromCode` and runs the same O2 comparison locally. Its generated
comparison uses r0 as the baseline for every image. The formatting
CLI is also corpus-wide, so the formatting probe applies its helpers
to the single project.

### What was tricky to build

The hottest instructions at r0 are in `rotr` and `rotl`. At r14 the
SHA compression loop has no rotate calls or direct stack loads and
stores on its source lines. ChaCha still calls `quarter` eight times
per double round, with immediate shifts inside `quarter`. The
source-attributed ChaCha loop listing drops from 48 direct stack
loads and stores to 40 and retains 65 add-immediate-zero moves.

### What warrants a second pair of eyes

Use instruction counts for the fixed cases to compare later pass
revisions and backend configurations. Static spill counts describe
the compiled entry functions.

### What should be done in the future

Aggregate corpus expectation updates and any changes to the standalone
reference runner belong in the integration work that owns those files.

### Code review instructions

Run `node --test tests/typed/sha-chacha.test.mjs` after
`npm run build`, then `node tools/parity.mjs --json sha-chacha`.
Open the project and run `explore` for instruction counts and RV32
instruction IDs.

### Technical details

The fixed measurement cases use the same `coalesce`, `chains` and
`homes` options at both revisions.

| Kernel | r0 instructions | r14 instructions | r0 instructions/byte | r14 instructions/byte | r0 → r14 spills |
| --- | ---: | ---: | ---: | ---: | ---: |
| SHA-256 | 14,108 | 7,962 | 220.4375 | 124.40625 | 13 → 0 |
| ChaCha20 | 7,692 | 3,396 | 120.1875 | 53.0625 | 25 → 19 |
