---
Title: Thompson NFA design diary
Ticket: IRWB-015
Status: active
Topics:
  - compiler
  - ir
  - performance
DocType: reference
Intent: long-term
Summary: Records the design investigation and its tape-ingestion probe.
---

# Design diary

## Step 1. Create the ticket

Created IRWB-015 and its design document with docmgr on November 26. The requested topic slugs were already defined.

### Prompt context

User request, verbatim.

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
> - Create the ticket: `docmgr ticket create-ticket --ticket IRWB-015 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
> - Add the design doc: `docmgr doc add --ticket IRWB-015 --doc-type design-doc --title "<title>"`.
> - Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
> - The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
> - How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.
>
> ## Constraints
> - Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-015--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Do not run Candela-scale processes.
> - When done, commit only your ticket directory on the current branch with the message `IRWB-015: ticket and design doc for <program>`. Do not push.
> - Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
> ## Your program — ticket IRWB-015: a regex matcher
> A Thompson-NFA matcher with explicit state sets in Typed: the pattern is compiled to an NFA in `Int32Array`s and matched over a text buffer.
> - Why: a second specialization target — a matcher specialized on a fixed pattern should collapse into a hard-coded state machine, as generated lexers such as re2c do; it exercises jump threading, loop unswitching and character-class tests.
> - Oracle: JavaScript's `RegExp` on the same pattern and input, restricted to the implemented subset.

## Step 2. Check the language and project paths

Reviewed the requested corpus examples, the Candela array-stack source, and the generator and backend paths. The worktree had design documents for IRWB-003, IRWB-006 and IRWB-008. IRWB-007, IRWB-010 and IRWB-011 had ticket stubs here, so the design uses the checked-in specialization implementation and the directions in the request.

- The initial stdin probe using Node's strip-only TypeScript loader failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property in `program.ts`. Retried with `node --no-warnings --experimental-transform-types --input-type=module` and a relative `.js` to `.ts` resolution hook. The probe loaded the checked-in vendor scripts through `loadVendorFile`.
- The probe with `==` failed with `expected bool, got i32`. With `===`, default inspection then failed with `unknown tape opcode 252 at 9`. This is the frame-array zeroing path.
- With tape ingestion enabled, the probe passed r0 evaluation, eight changed `speed` steps, optimized RV32 execution and the reference-image check. The same manifest opened in the workbench and its fresh script returned 2. Both Node corpus loaders still used default inspection. The design specifies forwarding the existing manifest option through both loaders.

## Step 3. Write the design

Chose a flat grammar and a backward compiler so each emitted piece already has a continuation. The explicit sets and queue preserve the dispatch, array traffic and control flow the project is meant to exercise. The main design records the test profiles, independent oracle and provisional statement budget. A separate specialized state machine is future work.

## Step 4. Validate the ticket

Linked seven source files with `docmgr doc relate`. The first `docmgr doctor --ticket IRWB-015 --stale-after 30` reported `frontmatter delimiters '---' not found` for this diary. Added reference frontmatter and reran doctor successfully. Checked the example manifest as JSON, resolved the relative Markdown links and checked the maximum-pattern length and budget arithmetic. The budget remains a design estimate until the matcher exists.

The sandboxed `git add` could not create the linked worktree's `index.lock` because its Git metadata was mounted read-only. Retried the ticket-scoped Git commands with permission to write the worktree's Git metadata.
