---
Title: Typed Chess Search Design Diary
Ticket: IRWB-017
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
Summary: Records the design evidence and frontend and RV32 probes.
LastUpdated: 2026-11-26T11:54:29.335544881-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-017 diary

## Step 1 — Create the ticket and inspect the corpus

Docmgr created the ticket and design document under the requested date. The seven named corpus projects established the project layout. The evaluator showed that generated parameters are sampled independently and pass checks normally call every function.

### Prompt context

User task, verbatim.

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
> - Create the ticket: `docmgr ticket create-ticket --ticket IRWB-017 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
> - Add the design doc: `docmgr doc add --ticket IRWB-017 --doc-type design-doc --title "<title>"`.
> - Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
> - The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
> - How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.
>
> ## Constraints
> - Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-017--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Do not run Candela-scale processes.
> - When done, commit only your ticket directory on the current branch with the message `IRWB-017: ticket and design doc for <program>`. Do not push.
> - Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
> ## Your program — ticket IRWB-017: the existing chess search, ported into the corpus
> The user already has a chess engine written in Typed in their own repository `/home/manuel/code/wesen/2026-10-20--ds-js-os` (read only; do not modify it): `apps/typed/chess/` (`position.typed`, `moves.typed`, `search.typed`, `state.typed`, and others), with reference positions in `bench/reference/chess/reference-positions.json` and a host runner in `bench/host/`. Design how to bring its engine core (position, move generation, search) into this repository as a corpus project.
> - Why: branchy integer code, an explicit-stack alpha-beta search and move generation — realistic control flow, unlike loop-heavy kernels.
> - Oracle: perft node counts for known positions, and the reference positions.

- `docmgr ticket create-ticket` and `docmgr doc add` both succeeded. The worktree scope excluded the external engine and other agents' ticket documents, so the workstream mapping uses the prompt and available code.

## Step 2 — Probe the frontend and both RV32 paths

A two-file in-memory program exercised fixed buffers, a helper call, an entry scope, a loop, and a mutable output through checked `speed`. The array variant verified the tape-ingest requirement.

- Plain Node type stripping rejected parameter properties with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The retry used `node --experimental-transform-types --input-type=module`, a local import hook and digest-verified vendored components.
- Default ingest of the array reported `unknown tape opcode 252 at 8`. Switched the array variant to tape ingest. The first combined harness also reported `TypeError: steps.some is not a function`. Retried using the `steps` field of the pipeline result.
- Both variants returned 17 and wrote [17, 23]. Each got 100/100 agreements for both RV32 images with zero traps and inconclusive cases. The concrete r0 runs took 31 statements for the buffer-only source and 33 for the array source. These are smoke-test counts.

## Step 3 — Write and relate the port design

The design proposes a fixed-depth project with entry-scoped checks, a per-ply workspace, independent perft counts, a host search check and RV32 instruction measurements. The generated pairs have an explicit qualification gate because the chess program has yet to be measured.

- `docmgr doc relate` added seven sources to the [design](../design-doc/01-porting-typed-chess-search-into-the-corpus.md). The first diary write reported `no such file or directory` for the absent `log/` directory. Created the directory and retried.
- Review the supported calls and storage map first. The implementation sequence starts by pinning upstream and auditing its move encoding, scoring, and runner.

## Step 4 — Validate the ticket before commit

Docmgr initially reported that the diary lacked its frontmatter delimiters. Added the existing reference document type and ticket metadata to the diary. Validate with `docmgr doctor --ticket IRWB-017 --stale-after 30` and stage only the ticket directory.
