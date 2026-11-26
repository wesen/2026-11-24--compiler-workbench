---
Title: Bytecode VM design diary
Ticket: IRWB-012
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
Summary: "Workspace setup, feature probes, and design validation."
---

# Bytecode VM design diary

## Step 1. Create the workspace

I confirmed that the requested topics were already in the worktree vocabulary. The installed CLI exposed the `create-ticket` alias. It created a workspace dated November 26, followed by the design document scaffold.

### Prompt context

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
> - Create the ticket: `docmgr ticket create-ticket --ticket IRWB-012 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
> - Add the design doc: `docmgr doc add --ticket IRWB-012 --doc-type design-doc --title "<title>"`.
> - Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
> - The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
> - How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.
>
> ## Constraints
> - Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-012--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Do not run Candela-scale processes.
> - When done, commit only your ticket directory on the current branch with the message `IRWB-012: ticket and design doc for <program>`. Do not push.
> - Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
> ## Your program — ticket IRWB-012: a bytecode VM
> A stack-machine bytecode interpreter written in Typed: an opcode `match` (or equivalent dispatch) in a loop, an operand stack and locals in `Int32Array`s, bytecode in a text buffer; plus small bytecode programs to run on it (for example fib, a sieve, insertion sort, a checksum).
> - Why: an interpreter specialized on its bytecode is a compiled program (the first Futamura projection); this is IRWB-007's specialization idea on a small, controllable program. It also exercises dispatch lowering, keeping VM state in registers, bounds checks on stack and code accesses, and superinstructions.
> - Oracle: the same bytecode on a JavaScript reference VM; specialized against unspecialized output.
> - Measure: instructions per executed bytecode instruction, general and specialized.

### Evidence

- `docmgr ticket create-ticket --ticket IRWB-012 --title 'Bytecode VM' --topics compiler,ir,performance` succeeded.
- `docmgr doc add --ticket IRWB-012 --doc-type design-doc --title 'Bytecode VM corpus project'` succeeded.

## Step 2. Verify the language and project entry points

I checked corpus examples for buffers, branches, functions and array frames. The parser only accepts enum expressions in `match`, so the design uses an integer if/else chain. A tiny two-array probe established which ingestion path to use.

### Evidence and decisions

- `tsc --version` returned `zsh:1: command not found: tsc`. Node 24.18.0 loaded `src/typed/evaluate.ts` directly using `node --experimental-transform-types --input-type=module`, with a resolution hook mapping relative imports to the worktree TypeScript files. The probe reused `installVendor({ reference: true })` and ran in memory.
- `Program.fromProject` reported `frontEndError` with `unknown tape opcode 252 at 8` on the probe. The same project source and specs worked with `new Program(..., { inputs, ingest: { tape: true } })`. The probe used two frame arrays (48 bytes), dynamic subscripts, a text-buffer loop and a helper call. With cells `[1,0,0,0]`, data `[65535]` and `n = 12`, it returned 65,547. Runs took 33 evaluator statements, 98 reference instructions and 73 workbench instructions after checked `speed` with chains, coalescing and homes enabled.
- Integer `match` failed with `match requires an enum, got i32`, confirming the dispatch decision. The browser already forwards tape options. The design identifies the project loading paths where Node tools and corpus tests need the same setting.

## Step 3. Check the design fixtures

I specified the two programs as assembly and exact cells, then checked that the examples in the design agree. A small in-memory Node check parsed the JSON, converted the assembly into pairs, compared both cell vectors, and derived the maximum guest counts from the branch labels. It also checked the relative source links and evaluated a function body with `args` in scope.

### Evidence and decisions

- Fib is 19 static instructions with 186 guest dispatches at the maximum input. Checksum is 16 static instructions with 172 dispatches at the maximum. The 14,980 statement budget remains an estimate until the interpreter exists.
- The design uses a manually residualized Typed benchmark to measure specialization now. Automatic bytecode specialization needs buffer-content bindings and residual control flow. The current scalar binding can bind an address without binding the bytes.

## Step 4. Validate the ticket

I related seven primary source files to the design and recorded the completed design task. The first `docmgr doctor --ticket IRWB-012 --stale-after 30` reported `invalid_frontmatter` for this diary with `frontmatter delimiters '---' not found`. The diary now uses the existing `reference` document type.

The doctor rerun and frontmatter validation passed. The commit is scoped to the ticket directory.

The sandboxed `git add` could not create the worktree's `index.lock` and reported `Read-only file system`. The commit was retried with write access to the Git metadata.
