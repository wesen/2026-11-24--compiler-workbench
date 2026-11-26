---
Title: IRWB-017 design diary
Ticket: IRWB-017
Status: active
Topics: [compiler, ir, performance]
DocType: analysis
Intent: long-term
Summary: Source inspection, read-only measurements, and review of the chess corpus design.
---

# IRWB-017 design diary

## Step 1 · Create the workspace and read the source

Created IRWB-017 and its design document with docmgr. Inspected the local corpus project patterns, the lifter and checker, the ds-js-os engine and host runner, and the related optimization designs. IRWB-007, IRWB-010 and IRWB-011 have only index material at the current HEAD, so I read their design text with `git show` at `14dfbde` and `d0e6415`.

<details>
<summary>User request, verbatim</summary>

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
> - Create the ticket: `docmgr ticket create-ticket --ticket <ID> --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
> - Add the design doc: `docmgr doc add --ticket <ID> --doc-type design-doc --title "<title>"`.
> - Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
> - The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
> - How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.
>
> ## Constraints
> - Write only inside your ticket directory (`ttmp/2026/11/26/<ID>--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Do not run Candela-scale processes.
> - When done, commit only your ticket directory on the current branch with the message `<ID>: ticket and design doc for <program>`. Do not push.
> - Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
> ## Your program — ticket IRWB-017: the existing chess search, ported into the corpus
> The user already has a chess engine written in Typed in their own repository `/home/manuel/code/wesen/2026-10-20--ds-js-os` (read only; do not modify it): `apps/typed/chess/` (`position.typed`, `moves.typed`, `search.typed`, `state.typed`, and others), with reference positions in `bench/reference/chess/reference-positions.json` and a host runner in `bench/host/`. Design how to bring its engine core (position, move generation, search) into this repository as a corpus project.
> - Why: branchy integer code, an explicit-stack alpha-beta search and move generation — realistic control flow, unlike loop-heavy kernels.
> - Oracle: perft node counts for known positions, and the reference positions.

</details>

## Step 2 · Measure the unchanged engine

Ingested the concatenated upstream files with the default `Program` at workbench HEAD `d4de7a3`. The read-only Node probe used a module resolution hook to load workbench TypeScript from source and the hash-checked vendor loader. It compared `evaluate`, `lowerToImage` plus `runImage`, and the vendored reference image using the host's FEN encoder. All 53 functions lifted. The two images agreed with the evaluator's result and guest bytes for perft depths 1 and 2 on the 12 JSON positions, plus start and sampled slices. Opening perft 1 ran 20,778 statements. The forced-board material search used 3,422 statements to start and 9,381 for the slice, so the design budgets that case for per-pass checks.

The first `node --input-type=module` probe failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on parameter properties. Retried with `--experimental-transform-types`. After compilation succeeded, extracting the host encoder into the inline probe exposed missing `boardWords` and `assert` bindings. Supplied those dependencies explicitly. The final probe used `benchCase` per entry, ran the evaluator and both images with 2 million steps as ceilings, and used the start result bytes as the input to each slice. The forced-board run used depth 1, budget 4, and mode 0.

## Step 3 · Write and relate the port design

Specified the unchanged board and frame layout, a search wrapper with input-buffer options, independent chess fixtures, and RV32 parity and measurement steps. The project loaders run checks on every function, so the design gives stateful helpers validated snapshots and keeps the full position matrix in focused host tests. The key compiler and upstream files are related on the design document. The proposed wrapper, checked pipelines and corpus integration are implementation steps.

## Step 4 · Validate the ticket

Checked the index and design frontmatter and resolved their relative Markdown links. The first `docmgr doctor --ticket IRWB-017 --stale-after 30` reported `invalid_frontmatter` for the diary because the frontmatter delimiters were missing. Added the ticket metadata and reran the check. The commit is scoped to the ticket.

## Step 5 · Simplify the port after self-review

Read the design and the current worktree's program loader, case builder, pass evidence, and corpus runners. The biggest removable cost was a second search interface. The revised design puts three options into the existing start call and drives search with the existing slice call. The compact pass cases still exercise real helper paths because both stock project loaders check all functions. A few shared snapshots cover those calls without new entry-point plumbing or a separate generator.

Consolidated the test and measurement path into one Node harness. The independent oracle still covers special moves, terminal positions, perft, and tactical search. The prior measurement remains evidence for selecting compact cases. This review used the recorded probe and current worktree files for design evidence. The port and its thresholds remain to be verified during implementation.

> Re-read your design document as a skeptical senior engineer whose goal is the simplest design that still serves the experiment. Identify everything that could be removed or simplified without weakening the experiment, revise the document accordingly, and add a short section at the end listing each cut with a one-line reason. Keep the diary up to date. Work only from the files in your worktree; do not read other git branches, other worktrees, or other agents' tickets. Commit only your ticket directory with the message `IRWB-017: simplify the design doc after self-review`. Do not push. Final message: the commit hash and the list of cuts.

Validated the revised design and diary frontmatter with docmgr, resolved the design's file links, checked that the eight cuts close the document, and ran `git diff --check`. The changes are limited to the ticket's design, diary, and changelog.
