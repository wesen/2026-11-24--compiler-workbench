---
Title: LZ corpus design diary
Ticket: IRWB-014
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Evidence and decisions for the LZ round-trip corpus design.
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: "Record the corpus and loader investigation."
WhenToUse: "When reviewing the design or reproducing the probes."
---

# Design diary

## Step 1. Create the ticket and survey the corpus

I created IRWB-014 and its design document with docmgr on November 26. Sort illustrates the offset-index proof, Histogram illustrates computed buffer indices and stores, and Blend and Checksum show how projects attach input specs and expose a pipeline experiment. The Candela kernel shows the frame-array syntax. I read the available IRWB-003, IRWB-006, and IRWB-008 design material and checked the scope of IRWB-007, IRWB-010, and IRWB-011 in their worktree entries and the current source.

### User prompt (verbatim)

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed — a small statically typed language with TypeScript-like syntax — to 32-bit RISC-V (RV32IMF), built on an IR framework in which every pass is checked. Your task: create a docmgr ticket and write a design document for ONE new corpus program, described below, that will serve as a playground for compiler optimizations. Do not implement the program in this task. Stop after the design document is written and committed.
>
> ## Read first
> - `corpus/projects/*/`: each project has `main.typed`, `project.json` (pipeline, input specifications for generated cases, focus), `notes.md`, `scripts/`. Look at several, e.g. `blend`, `checksum`, `sort`, `histogram`, `records`, `match-enum`, `strings`.
> - `corpus/reference.md`: the workbench API, including the input-specification format for generated cases.
> - `corpus/candela-gallery/*.typed`: a large Typed program (records, f32, `new Int32Array(n)` frame arrays, explicit stacks instead of recursion).
> - The language as the corpus uses it: `i32`, `f32`, `bool`, records, `enum` + `match`, `distinct` types, u16 text buffers (`charCodeAt`, `setCharCodeAt`, `.length`), `new Int32Array(n)` fixed-size arrays, `for`/`while`/`loop`/`break`/`continue`. Assume no recursion. Verify any feature you rely on against the front end and lifter in `src/typed/` (e.g. `lift.ts`) and the corpus.
> - How programs are checked: every pass is accepted only if the optimized program agrees with the original (r0) on generated cases (`casesFrom` and `meaningKept` in `src/typed/evaluate.ts`; step limit 2e4 per case for pass checks). The reference compiler's image on the RV32 emulator is a second oracle (`tools/reference-check.mjs`). Instruction counts on the emulator are the speed measure.
> - Optimization work this program should feed, as tickets under `ttmp/`: IRWB-003 (inlining, loop rotation, copy coalescing, constants in registers; the `speed` pipeline), IRWB-006 (rule tables, SSA), IRWB-007 (specialization on constant data, partial evaluation), IRWB-008 (exact checking), IRWB-010 (rule discovery, equality saturation, superoptimization), IRWB-011 (tolerance contracts for floats). Read their design docs only as far as you need.
>
> ## Ticket and documents
> - Create the ticket: `docmgr ticket create-ticket --ticket IRWB-014 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
> - Add the design doc: `docmgr doc add --ticket IRWB-014 --doc-type design-doc --title "<title>"`.
> - Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
> - The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
> - How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.
>
> ## Constraints
> - Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-014--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Do not run Candela-scale processes.
> - When done, commit only your ticket directory on the current branch with the message `IRWB-014: ticket and design doc for <program>`. Do not push.
> - Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
> ## Your program — ticket IRWB-014: an LZ-style compressor and decompressor
> Hash-chain match finding over a text buffer, literal and match encoding, and a decompressor, in Typed.
> - Why: dense memory accesses and bounds checks, including checks that need relations between indices (`i + len <= n`, back-references) — the kind insertion sort still loses on; byte and bit twiddling for rule discovery; loop-carried dependencies.
> - Oracle: a round trip, `decompress(compress(x)) == x`, which holds on any input, so generated cases are meaningful.

## Step 2. Probe the loader and choose scratch buffers

Node v24.18.0 ran in-memory probes via `node --experimental-transform-types --disable-warning=ExperimentalWarning --input-type=module` with a resolve hook for worktree TypeScript imports. The default front end rejected the small frame-array probe with `unknown tape opcode 252 at 9`. The same array syntax through tape ingestion compiled and returned 7 for an indexed store/load. The usual corpus loader does not select that path.

A scratch-buffer probe returned 1 and wrote the expected u16 cells `[32783, 32800]`. The checked speed pipeline and the reference image agreed with r0. I chose caller-supplied scratch buffers and index-plus-one links so zero can mark the end of an empty chain.

## Step 3. Specify the cases and measurement plan

I drafted the single-cell token format, the copy invariant for overlap, and separate round-trip, pass, and reference-image checks. I capped input at 24 cells and kept the search cap in a read-only input buffer. Statement counts for the proposed compressor and decoder are estimates to verify during implementation.

I extracted the manifest directly from the design and used its `roundTrip` inputs in a six-argument ABI probe. At seed 7, all 40 cases agreed in the evaluator, workbench RV32 image, and reference compiler's image. The cases included all four policy values and 21 distinct source lengths. This exercised the case layout and calling path while leaving the corpus program for the implementation task.

## Step 4. Validate ticket metadata

I related seven files to the design with `docmgr doc relate`. The first `docmgr doctor --ticket IRWB-014 --stale-after 30` run reported `invalid_frontmatter` for the diary because its YAML delimiters were missing. I added reference frontmatter within the existing vocabulary.

The second doctor run passed and listed both documents. Staging the ticket initially failed because the linked worktree's Git index was read-only in the default sandbox. The commit needs write access to that Git metadata.
