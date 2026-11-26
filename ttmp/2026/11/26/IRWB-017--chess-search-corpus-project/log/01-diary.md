---
Title: Chess search corpus design diary
Ticket: IRWB-017
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Investigation and validation of the chess search corpus design.
LastUpdated: 2026-11-26T11:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-017 design diary

## Step 1 — Opened the ticket and read the engine

Created IRWB-017 with the requested topics and added the design document using docmgr. Read the named corpus projects and the Workbench reference, sampled the Candela frame-array source, and traced the four-file chess core and fixture runner. The existing iterative perft and resumable search fit one project with a small driver.

<details>
<summary>Original task request</summary>

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
> ## Design policy for this playground (read before designing)
> These programs exist to give the optimizer something to work on. Everything in the design should serve that purpose, and the simplest design that serves it is the right one.
> - Design for valid inputs only. Choose input specifications that generate only valid inputs. On anything else the program may trap (Typed's checked accesses do this) or return an arbitrary value. Do not define status codes, error precedence, or guarantees about memory on error unless the algorithm itself has a natural failure result (for example "no match").
> - Keep the input domain as narrow as the experiment allows. Restricting an input specification is preferable to adding code that handles more values.
> - For each significant design decision, name the simplest alternative that would serve the experiment and say in one or two sentences why you chose it or why it falls short. Prefer the simplest alternative unless it fails the experiment.
> - Describe only what can be built with the current repository. Work that depends on features that do not exist yet (for example constant-memory specialization, fused multiply-add emission, a specialization dispatcher) gets one line each in a short "Later" list, with no test plan.
> - A specialization constant that is a single number is a scalar parameter. Use a buffer only for array data such as bytecode or a pattern.
> - Mention only the optimization tickets this program directly exercises, one line each.
> - If the repository lacks a small piece of infrastructure the design needs (a loader option, a metadata field), propose the change in a short section instead of designing around it.
> - Before relying on a language or loader feature, run a minimal probe (for example ingest a tiny Typed program through `tools/node-vendor.mjs` and `src/typed/program.ts`) and state the result.
> - Each section should be as long as an implementer needs and no longer. Target 1,500 to 2,500 words for the whole document. Leave out measurement methodology beyond the primary metric, alternate input profiles, and tests of the program's own guards.
> - Work only from the files in your worktree. Do not read other git branches, other worktrees, or other agents' tickets.
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

## Step 2 — Probed ingestion, entry scope, and case sizes

Built the existing TypeScript into the ticket's temporary `.probe/` directory using cached packages. Loaded the vendor scripts through `tools/node-vendor.mjs`. The initial `node --input-type=module` smoke hit `[notCompiled] prog:probe did not compile: expected return`. The revised tiny source used braced control statements and worked. The first file-based run, `node "$ticket/.probe/run.mjs"`, hit `ERR_MODULE_NOT_FOUND` for `ttmp/tools/node-vendor.mjs`. Correcting the import depth recovered the run.

The two-file smoke returned −1 in 31 statements and wrote the wrapped u16 value. Project JSON ignored the entry list and checked the helper directly. Direct `Program` construction scoped the check. The upstream files ingested as 53 functions and both RV32 compilers lowered them. The bounded search probe used the original engine and an in-memory loop. The search's budget-two cases used 12,054–12,953 statements, and the final scoped `speed` check agreed on 20 cases per entry with zero traps or limits.

The first state inspection used field enumeration order and mislabeled the result. Reading the named byte offsets recovered the correct search fields. The quiet mate fixture completed with `d6c7`, score 29,997, depth 3, and 1,344 nodes. The reference, r0, and `speed` images with backend options agreed with the evaluator, including guest memory.

## Step 3 — Wrote and linked the design

Recorded the port boundary, storage, generated inputs, loader gap, and oracle plan. `docmgr doc relate` recorded seven key files. The ticket-index relation initially reported `malformed --file-note value` because zsh parsed the colon following the variable as a modifier. Bracing the variable fixed it. The first diary write failed because the generated ticket had no `log/` directory. Created it and added this diary. The final ticket contains documentation only.

## Step 4 — Checked the ticket

`docmgr doctor --ticket IRWB-017 --stale-after 30` initially reported `invalid_frontmatter` for the diary. Added the ticket's reference metadata and reran the check. Removed temporary probe files before staging the ticket.

The first `git add -- "$ticket"` hit `Unable to create .../index.lock: Read-only file system` under the shared Git worktree metadata. Requested sandbox escalation for the ticket-only commit.
