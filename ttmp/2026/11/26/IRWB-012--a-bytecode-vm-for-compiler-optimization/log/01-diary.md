---
Title: IRWB-012 design diary
Ticket: IRWB-012
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
Summary: Chronological design and validation record for IRWB-012.
LastUpdated: 2026-11-26T10:35:17.128370637-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-012 design diary

## Step 1 — Read the compiler and corpus

I traced text access, dispatch, and frame arrays from corpus examples through the vendored Typed frontend and the lifter. I checked the pass contract and reference runner to confirm that evaluator steps and RV32 instructions are different units.

### Prompt context

<details>
<summary>User request verbatim</summary>

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
## Your program — ticket IRWB-012: a bytecode VM
A stack-machine bytecode interpreter written in Typed: an opcode `match` (or equivalent dispatch) in a loop, an operand stack and locals in `Int32Array`s, bytecode in a text buffer; plus small bytecode programs to run on it (for example fib, a sieve, insertion sort, a checksum).
- Why: an interpreter specialized on its bytecode is a compiled program (the first Futamura projection); this is IRWB-007's specialization idea on a small, controllable program. It also exercises dispatch lowering, keeping VM state in registers, bounds checks on stack and code accesses, and superinstructions.
- Oracle: the same bytecode on a JavaScript reference VM; specialized against unspecialized output.
- Measure: instructions per executed bytecode instruction, general and specialized.

</details>

### Findings

- The frontend restricts `match` to enums and gives `charCodeAt` an i32 result. Numeric dispatch keeps the bytecode on the supported path.
- Frame arrays use literal sizes and stay in the declaring function. Candela provides an explicit stack example.
- Generated cases draw each parameter independently. The current specializer binds scalars and record fields. IRWB-002 provides the research context for IRWB-007, IRWB-010, and IRWB-011.

## Step 2 — Specify the VM and fixtures

I created IRWB-012 with `docmgr ticket create-ticket` and added the design with `docmgr doc add`. Two-cell instructions, private frame arrays, and a two-cell output let the independent oracle compare full i32 results and guest failures exactly.

The Fibonacci and checksum fixtures exercise different dispatch paths through one entry. Their generated domains fit inside a 192-dispatch fuel cap. The 16,000-statement target requires measurement once the Typed program exists. Both general and specialized images use the JS VM’s guest instruction count as the denominator.

## Step 3 — Relate and check the design

I related seven files with `docmgr doc relate` and updated the design task and changelog. The first diary write raised `FileNotFoundError` because the generated ticket had no `log/` directory. I created the directory. Doctor then reported `frontmatter delimiters '---' not found` for the diary. I added frontmatter using the existing `reference` document type.

The documentation checks cover the project JSON, both bytecode listings and cell arrays, branch targets, sizing arithmetic, and links. `docmgr doctor --ticket IRWB-012 --stale-after 30` passed. Evaluator and emulator measurements belong to the implementation described in the design.
