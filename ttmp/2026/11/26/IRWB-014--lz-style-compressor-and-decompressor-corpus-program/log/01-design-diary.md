---
Title: IRWB-014 design diary
Ticket: IRWB-014
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological notes on researching, drafting and reviewing the codec design."
LastUpdated: 2026-11-26T10:39:36-05:00
WhatFor: "Record the design decisions and validation evidence."
WhenToUse: "Review how the proposal was developed."
---

# IRWB-014 design diary

## Step 1 — Read the corpus and create the ticket

I read the named corpus examples, Candela's frame-array loops, the
front end and lifter, and the generated-case and reference-image
paths. The corpus runs helpers as entries, and the meaning gate
counts all statements executed by callees against the caller's
budget. I created IRWB-014 and its design document with docmgr.

### User request (verbatim)

````text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed — a small statically typed language with TypeScript-like syntax — to 32-bit RISC-V (RV32IMF), built on an IR framework in which every pass is checked. Your task: create a docmgr ticket and write a design document for ONE new corpus program, described below, that will serve as a playground for compiler optimizations. Do not implement the program in this task. Stop after the design document is written and committed.

## Read first
- `corpus/projects/*/`: each project has `main.typed`, `project.json` (pipeline, input specifications for generated cases, focus), `notes.md`, `scripts/`. Look at several, e.g. `blend`, `checksum`, `sort`, `histogram`, `records`, `match-enum`, `strings`.
- `corpus/reference.md`: the workbench API, including the input-specification format for generated cases.
- `corpus/candela-gallery/*.typed`: a large Typed program (records, f32, `new Int32Array(n)` frame arrays, explicit stacks instead of recursion).
- The language as the corpus uses it: `i32`, `f32`, `bool`, records, `enum` + `match`, `distinct` types, u16 text buffers (`charCodeAt`, `setCharCodeAt`, `.length`), `new Int32Array(n)` fixed-size arrays, `for`/`while`/`loop`/`break`/`continue`. Assume no recursion. Verify any feature you rely on against the front end and lifter in `src/typed/` (e.g. `lift.ts`) and the corpus.
- How programs are checked: every pass is accepted only if the optimized program agrees with the original (r0) on generated cases (`casesFrom` and `meaningKept` in `src/typed/evaluate.ts`; step limit 2e4 per case for pass checks). The reference compiler's image on the RV32 emulator is a second oracle (`tools/reference-check.mjs`). Instruction counts on the emulator are the speed measure.
- Optimization work this program should feed, as tickets under `ttmp/`: IRWB-003 (inlining, loop rotation, copy coalescing, constants in registers; the `speed` pipeline), IRWB-006 (rule tables, SSA), IRWB-007 (specialization on constant data, partial evaluation), IRWB-008 (exact checking), IRWB-010 (rule discovery, equality saturation, superoptimization), IRWB-011 (tolerance contracts for floats). Read their design docs only as far as you need.

## Ticket and documents
- Create the ticket: `docmgr ticket create-ticket --ticket <ID> --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
- Add the design doc: `docmgr doc add --ticket <ID> --doc-type design-doc --title "<title>"`.
- Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
- The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
- How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.

## Constraints
- Write only inside your ticket directory (`ttmp/2026/11/26/<ID>--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
- Never run code from downloaded archives under `ttmp/**/sources/`.
- Do not run Candela-scale processes.
- When done, commit only your ticket directory on the current branch with the message `<ID>: ticket and design doc for <program>`. Do not push.
- Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
## Your program — ticket IRWB-014: an LZ-style compressor and decompressor
Hash-chain match finding over a text buffer, literal and match encoding, and a decompressor, in Typed.
- Why: dense memory accesses and bounds checks, including checks that need relations between indices (`i + len <= n`, back-references) — the kind insertion sort still loses on; byte and bit twiddling for rule discovery; loop-carried dependencies.
- Oracle: a round trip, `decompress(compress(x)) == x`, which holds on any input, so generated cases are meaningful.
````

I read the design documents for IRWB-003, IRWB-006 and IRWB-008.
A search with `rg ... ttmp/2026/11/*/IRWB-$num*/{design-doc,reference}`
hit zsh's `no matches found` on absent subdirectories. I switched to
`find` on the ticket directories. IRWB-007, IRWB-010 and IRWB-011
have index scaffolds on this branch, so I used their stated scope
and the current specialization implementation.

## Step 2 — Specify the codec and its checks

I chose a 32-cell source bound, a 16-cell match window, and a
one-cell policy buffer for traversal depth. An escape preserves
the full u16 alphabet, including values in the token range. A
cellwise forward copy supports overlap. I derived an amortized
comparison bound over consumed input and wrote allowances for
the lifted statement budget.

The oracle combines exact input equality with a host decoder
and golden streams to catch errors shared by the Typed pair.
The generators use full-u16 data for encoder escapes, a
two-symbol alphabet for wrapper matches, and stream prefixes
for direct decoder calls. The plan uses the actual statement
limit for pass checks and emulator instructions for speed.

## Step 3 — Relate and review the design

I linked seven source files with `docmgr doc relate` and put
the guide in the ticket index. The document review passed its JSON example, relative file links,
token examples and budget arithmetic. The first `docmgr doctor
--ticket IRWB-014 --stale-after 30` reported `frontmatter delimiters
'---' not found` for this diary. I added frontmatter using the
existing analysis document type and reran the check. Codec
execution and RV32 measurement belong to implementation.

The repeat doctor check passed. Staging with `git add -- <ticket-dir>`
hit `Unable to create .../index.lock: Read-only file system` in
the worktree's shared Git metadata. The commit step needs write
access to that metadata.
