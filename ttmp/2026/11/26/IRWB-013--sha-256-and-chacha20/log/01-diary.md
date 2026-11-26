---
Title: SHA-256 and ChaCha20 design diary
Ticket: IRWB-013
Status: complete
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological record of corpus research, feature probes, and design validation.
LastUpdated: 2026-11-26T12:00:37.508219557-05:00
WhatFor: ""
WhenToUse: ""
---

# Design diary

## Step 1. Create the design workspace

Used the repo's docmgr configuration and existing topics to create the ticket and its design document on November 26.

<details>
<summary>Original request (verbatim)</summary>

```text
You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed — a small statically typed language with TypeScript-like syntax — to 32-bit RISC-V (RV32IMF), built on an IR framework in which every pass is checked. Your task: create a docmgr ticket and write a design document for ONE new corpus program, described below, that will serve as a playground for compiler optimizations. Do not implement the program in this task. Stop after the design document is written and committed.

## Read first
- `corpus/projects/*/`: each project has `main.typed`, `project.json` (pipeline, input specifications for generated cases, focus), `notes.md`, `scripts/`. Look at several, e.g. `blend`, `checksum`, `sort`, `histogram`, `records`, `match-enum`, `strings`.
- `corpus/reference.md`: the workbench API, including the input-specification format for generated cases.
- `corpus/candela-gallery/*.typed`: a large Typed program (records, f32, `new Int32Array(n)` frame arrays, explicit stacks instead of recursion).
- The language as the corpus uses it: `i32`, `f32`, `bool`, records, `enum` + `match`, `distinct` types, u16 text buffers (`charCodeAt`, `setCharCodeAt`, `.length`), `new Int32Array(n)` fixed-size arrays, `for`/`while`/`loop`/`break`/`continue`. Assume no recursion. Verify any feature you rely on against the front end and lifter in `src/typed/` (e.g. `lift.ts`) and the corpus.
- How programs are checked: every pass is accepted only if the optimized program agrees with the original (r0) on generated cases (`casesFrom` and `meaningKept` in `src/typed/evaluate.ts`; step limit 2e4 per case for pass checks). The reference compiler's image on the RV32 emulator is a second oracle (`tools/reference-check.mjs`). Instruction counts on the emulator are the speed measure.
- Optimization work this program should feed, as tickets under `ttmp/`: IRWB-003 (inlining, loop rotation, copy coalescing, constants in registers; the `speed` pipeline), IRWB-006 (rule tables, SSA), IRWB-007 (specialization on constant data, partial evaluation), IRWB-008 (exact checking), IRWB-010 (rule discovery, equality saturation, superoptimization), IRWB-011 (tolerance contracts for floats). Read their design docs only as far as you need.

## Ticket and documents
- Create the ticket: `docmgr ticket create-ticket --ticket IRWB-013 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
- Add the design doc: `docmgr doc add --ticket IRWB-013 --doc-type design-doc --title "<title>"`.
- Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
- The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
- How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.

## Constraints
- Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-013--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
- Never run code from downloaded archives under `ttmp/**/sources/`.
- Do not run Candela-scale processes.
- When done, commit only your ticket directory on the current branch with the message `IRWB-013: ticket and design doc for <program>`. Do not push.
- Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
## Your program — ticket IRWB-013: SHA-256 and ChaCha20
Pure 32-bit integer cryptography in Typed: SHA-256 (64 rounds, message schedule) and the ChaCha20 block function (16 live state words).
- Why: RV32's base ISA has no rotate instruction, so `(x >>> n) | (x << (32 - n))` idioms are targets for rule discovery (IRWB-010); round unrolling and constant tables exercise constant propagation; 16+ live values stress register allocation.
- Oracle: published test vectors, and the framework's own SHA-256 (`src/framework/core/data.ts`) as a second implementation.
- Measure: instructions per byte.
```

</details>

- `docmgr --version` returned `unknown flag: --version`. The two subcommand help probes confirmed the supported ticket and document verbs.
- `docmgr ticket create-ticket` and `docmgr doc add` created the ticket and design scaffold at the requested date.

## Step 2. Check the corpus and probe the language path

Read the seven requested examples, the API reference, excerpts of the gallery's Typed code, and the evaluator and reference runner. The IRWB-003, IRWB-006 and IRWB-008 designs were present. IRWB-007, IRWB-010 and IRWB-011 contained ticket scaffolds in this worktree, so the design uses the prompt's descriptions and checks available capabilities against source.

- Node 24.18 resolved the worktree's source modules with a stdin-only loader hook that maps local `.js` specifiers to existing `.ts` files. Strip-only mode raised `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on parameter properties. Retrying with `--experimental-transform-types` loaded the modules successfully without producing build files.
- A probe with `new Int32Array(64)`, a counted loop and a rotate helper failed default ingestion with `unknown tape opcode 252 at 9`. Tape ingestion returned `1073741825` in 28 statements and wrote cell `64`. Both the default reference and the checked `speed` image agreed on the two probe functions. The browser reads tape metadata today. The headless project constructors need to forward it.
- A second tape probe combined all three planned array sizes, bitwise operations, buffer bounds by construction and a helper writing bytes in little-endian order. The evaluator matched each RV32 image on 20 of 20 generated checks with no traps or limits.
- The framework returned the expected SHA-256 of `abc`. Node crypto reproduced the three SHA known answers and the RFC ChaCha block bytes.

## Step 3. Specify the workload and validation

Wrote the [design](../design-doc/01-sha-256-and-chacha20-corpus-design.md) around bounded SHA messages, 16 scalar ChaCha working words and replaceable tables passed as buffers. Random configuration cases cover general behavior, and canonical cases support byte-for-byte oracles and comparable measurements. The full workload step budgets are estimates. The design makes measurements on the actual IR and images an implementation acceptance item.

## Step 4. Validate the ticket

Parsed the embedded project JSON and checked that all seven functions have case specifications. The planning allowances total 14,272 statements for SHA and 4,880 for ChaCha. These figures are estimates from the design inputs.

- The first `docmgr doctor --ticket IRWB-013 --fail-on warning` returned `missing_numeric_prefix` for the diary. Renamed it to `01-diary.md`, updated the index link, and reran the same command successfully.
- The design has seven docmgr relations. Reviewed the planned files and restricted the commit to the IRWB-013 directory.
