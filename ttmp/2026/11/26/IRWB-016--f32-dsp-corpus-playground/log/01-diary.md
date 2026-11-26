---
Title: f32 DSP design diary
Ticket: IRWB-016
Status: active
Topics: [compiler, ir, performance]
DocType: reference
Intent: short-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Design decisions and feature probe results for the f32 DSP corpus project.
LastUpdated: 2026-11-26T10:57:58.594360545-05:00
WhatFor: Record the evidence and choices behind the f32 DSP design.
WhenToUse: Reviewing the design and the feature probe results.
---

# IRWB-016 diary

## Step 1 — Create the ticket and read the corpus

Created IRWB-016 and its design document with `docmgr`. Read the example projects, input-generation and check paths, buffer operations in the vendored front end, and the relevant optimization guides. IRWB-007, IRWB-010 and IRWB-011 had ticket indexes and scaffolding in this worktree. The design uses those ticket scopes and the available implementation.

<details>
<summary>Original task</summary>

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
> ## Your program — ticket IRWB-016: f32 DSP
> An iterative radix-2 FFT and a biquad filter bank, in f32, in Typed.
> - Why: float-heavy straight-line code; the FFT size and the coefficients are natural specialization constants (twiddle factors folded at compile time); reassociation and fused multiply-add change the last bits, which is IRWB-011's tolerance-contract question.
> - Oracle: bit-exact against r0 for exact pipelines; an error bound in dB against a float64 JavaScript reference for tolerance pipelines.

</details>

## Step 2 — Probe the language and execution paths

Ran a tiny in-memory project with a six-float dot product and a buffer loop using `getF32`, `setF32`, division and bit operations. `node --input-type=module` loaded `tools/node-vendor.mjs`, then resolved the relative module paths to source and used Node's TypeScript transform hook. The initial strip-only load hit `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property, so the transform ran without creating build output.

The generic reference wrapper disagreed 0/10 on the direct f32 calls because the wrapped image lacked the signature. The first loop probe also used an out-of-bounds index for its shorter size. Fixed the probe index and switched to `referenceCompile` / `referenceRun`. The corrected probe agreed 10/10 per function on both RV32 paths and took 81 evaluator statements for its explicit packed-buffer case. The first binding attempt used `createIRArtifact` and failed with “Adapter kind must be nonempty text”. With `createArtifact(BindingsIR, ...)` and `Program.specialize`, the binding and `speed` produced 11 revisions, zero rejections and complete exact and workbench RV32 agreement.

## Step 3 — Write the design and review its scope

Chose FFT sizes 8 and 16, a 16-sample two-band bank and fixed packed tables. These sizes fit the generator's independent parameter specs and keep the proposed r0 budgets well below the pass limit. Wrote the input contract, algorithm, oracle and instruction-count plan. The implementation must confirm the estimates and the proposed −100 dB threshold on the completed kernels.

## Step 4 — Validate and stage the ticket

The first `docmgr doctor --ticket IRWB-016 --stale-after 30` flagged the diary's missing frontmatter. Added reference metadata and a numeric filename, and reran validation. Checked the design length and local Markdown links. The initial git add hit a read-only worktree index and required escalation for staging and committing.
