---
Title: Bytecode VM design diary
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
Summary: Chronological record of the Bytecode VM design and its ingest probe.
LastUpdated: 2026-11-26T11:03:58-05:00
---

# Bytecode VM design diary

## Step 1 — Open IRWB-012

I created the ticket and design-document stub with docmgr after checking the repository-local docs root. The corpus examples supplied the existing project layout and input-spec syntax.

### Authored request

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
> ## Your program — ticket IRWB-012: a bytecode VM
> A stack-machine bytecode interpreter written in Typed: an opcode `match` (or equivalent dispatch) in a loop, an operand stack and locals in `Int32Array`s, bytecode in a text buffer; plus small bytecode programs to run on it (for example fib, a sieve, insertion sort, a checksum).
> - Why: an interpreter specialized on its bytecode is a compiled program (the first Futamura projection); this is IRWB-007's specialization idea on a small, controllable program. It also exercises dispatch lowering, keeping VM state in registers, bounds checks on stack and code accesses, and superinstructions.
> - Oracle: the same bytecode on a JavaScript reference VM; specialized against unspecialized output.
> - Measure: instructions per executed bytecode instruction, general and specialized.

## Step 2 — Probe frame arrays and generated inputs

I ran a two-opcode experiment with two fixed arrays, two entry offsets, and signed scalar inputs through the vendored compiler. It isolated the ingest mode needed for a corpus project.

- The initial `node --input-type=module` run failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a TypeScript parameter property. Node 24.18.0 with `--experimental-transform-types` and a resolution hook loaded the local sources without a build.
- Bare `loop` failed with `unknown local loop`. With `while (true)`, `Program.fromProject` failed with `unknown tape opcode 252 at 8`. The existing tape option in the `Program` constructor lifted the same source. An intermediate probe imported `storeOf` from the wrong module and failed with `TypeError: storeOf is not a function`. Importing it from `src/typed/ir.ts` fixed the probe.
- The successful probe used fixed cells `[1,0,0,0,1,0,0,0]`, `entry: { oneOf: [0,4] }` and `x: [-8,8]`. All eight seed-7 cases took 34 r0 evaluator statements. RV32 used 72 instructions at r0, 66 after `speed`, and 78 with the reference compiler. Result and memory comparisons agreed and the pipeline rejected no passes.
- The browser project loader already forwards `ingest`. The design proposes passing the field through the two Node-facing loading paths.

## Step 3 — Specify and review the fixtures

I chose a single image with scalar entry offsets so both fixtures fit the existing generator. Static inspection of the document's JSON verified the 64 cells, branch targets, peak stack depth of two, dispatch maxima of 184 and 160, the 442 legal calls and the projected 11,904-statement budget. The full interpreter's evaluator count remains an implementation check.

The [design document](../design-doc/01-a-stack-machine-bytecode-vm-for-specialization.md) describes the independent oracle, the RV32 comparison and the steps to add the corpus project.

## Step 4 — Validate the ticket

The first `docmgr doctor --ticket IRWB-012` reported `invalid_frontmatter` on the handwritten diary. I added frontmatter using the existing `reference` document type, leaving the diary under `log/`. The design's file relations come from `docmgr doc relate`.
