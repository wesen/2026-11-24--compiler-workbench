---
Title: f32 DSP design diary
Ticket: IRWB-016
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
Summary: Evidence and decisions from the DSP corpus design work.
LastUpdated: 2026-11-26
WhatFor: Record the design and validation steps.
WhenToUse: Review how this corpus design was scoped and checked.
---

# Design diary

## Step 1 — Create the ticket and inspect the corpus

Created IRWB-016 and its design document with docmgr. Reviewed the requested small corpus projects and scripts, the corpus API, representative Candela source, the Typed Blocks evaluator and RV32 reference runner, and the relevant sections of the existing IRWB-003, IRWB-006 and IRWB-008 designs. The local IRWB-007, IRWB-010 and IRWB-011 directories contained ticket stubs, so their scope comes from the request and the current source.

### Prompt context

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
- Create the ticket: `docmgr ticket create-ticket --ticket IRWB-016 --title "<title>" --topics compiler,ir,performance` (use only existing vocabulary topics: compiler, ir, performance, verification, research, candela, workbench, typescript; do not edit the vocabulary).
- Add the design doc: `docmgr doc add --ticket IRWB-016 --doc-type design-doc --title "<title>"`.
- Use your docmgr and diary skills. Keep a short diary in the ticket's `log/` (a step per significant action). Relate the key files with `docmgr doc relate`.
- The design document should let a new intern implement the program: the goal and which optimizations it exercises; the Typed program design (functions, data layout, sizes); the independent oracle and how a result is checked against it; input specifications for generated cases; sizing against the step limit; how it becomes a corpus project (files, `project.json`); a test and measurement plan; implementation steps. Use prose, with code or pseudocode where it helps, and file references.
- How the program should be written: the way ordinary code is written, not pre-optimized, so the compiler has something to find; a hand-optimized version as a separate project can serve as a ceiling; constants worth specializing on (a bytecode, a pattern, a size) live in input buffers so the same program can be measured general and specialized.

## Constraints
- Write only inside your ticket directory (`ttmp/2026/11/26/IRWB-016--…/`). Do not modify `src/`, `tests/`, `tools/`, `corpus/`, other tickets or `ttmp/vocabulary.yaml`.
- Never run code from downloaded archives under `ttmp/**/sources/`.
- Do not run Candela-scale processes.
- When done, commit only your ticket directory on the current branch with the message `IRWB-016: ticket and design doc for <program>`. Do not push.
- Final message: the design doc's path, the ticket path, the commit hash, and a one-paragraph summary.
## Your program — ticket IRWB-016: f32 DSP
An iterative radix-2 FFT and a biquad filter bank, in f32, in Typed.
- Why: float-heavy straight-line code; the FFT size and the coefficients are natural specialization constants (twiddle factors folded at compile time); reassociation and fused multiply-add change the last bits, which is IRWB-011's tolerance-contract question.
- Oracle: bit-exact against r0 for exact pipelines; an error bound in dB against a float64 JavaScript reference for tolerance pipelines.
````

- `docmgr ticket create-ticket` and `docmgr doc add` created the workspace and document at the requested dated path.
- The case generator supports bounded packed-float buffers directly. It generates parameters independently, which drove the fixed FFT capacity and the filter's length-derived trip count.

## Step 2 — Verify Typed and RV32 features

Used an in-memory Typed probe consisting of a counted loop and a value-record helper. It used generated f32 memory, an exponent from a u16 buffer, a float access and store, and a separately rounded arithmetic expression. Loaded the checked-in vendor files through `tools/node-vendor.mjs`.

- `npm ls --depth=0` reported `ELSPROBLEMS` for missing dev dependencies. A read-only `node --input-type=module` probe with a hook mapping source `.js` imports to `.ts` failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property. Repeated with `--experimental-transform-types`; the source modules loaded.
- The single test call took 120 IR statements, 245 workbench RV32 instructions and 175 reference RV32 instructions, with exact r0 agreement. `speed` accepted the inliner and loop rotation among its edits. The subsequent comparison decided all 100 cases per function with no traps or inconclusives. These counts describe the probe.

## Step 3 — Write and link the design

Specified a radix-2 FFT using rounded stage roots, and a direct-form I filter bank with bounded feedback. The two kernels have a common packed memory convention and independent float64 references. The design gives an executable input-spec example and estimated statement headroom for both maximum sizes.

- Used `docmgr doc relate` to attach seven primary files. The existing specialization bindings only cover scalar parameters and integer record fields. The design records buffer specialization and opt-in pass tolerance as future infrastructure.
- The float64 oracle uses a direct DFT and impulse-response convolution so it can catch errors in the Typed algorithms. A local Node probe generated the example stage-root cells using little-endian DataView writes.

## Step 4 — Check the handoff

Reviewed the document against the requested deliverables and validated the ticket, relative links, JSON example, and arithmetic witness. The program, full case counts, and performance baseline belong to implementation. The sizing figures in the design are estimates.

- `docmgr doctor --ticket IRWB-016 --fail-on warning` initially rejected the unnumbered diary filename with `missing_numeric_prefix`. Renamed it to `01-diary.md` and updated the ticket link.
- The Node validation parsed the project JSON, decoded the five stage roots, verified the rounded and fused witness values, and resolved all 13 relative source links.
