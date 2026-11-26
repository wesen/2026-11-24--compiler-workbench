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
RelatedFiles: []
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
