---
Title: IRWB-016 design diary
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
Summary: Chronological record of the f32 DSP corpus design.
LastUpdated: 2026-11-26T10:34:36-05:00
WhatFor: Record source checks and design decisions for IRWB-016.
WhenToUse: When reviewing or resuming the design.
---

# IRWB-016 design diary

## Step 1 — Read the corpus and create the ticket

Reviewed existing projects for their file layouts, function inputs and notes. Read the corpus API, Candela examples, the Typed lifter, the evaluator and the reference runner. Created IRWB-016 and its design document with docmgr.

### Prompt context

User request, verbatim

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
## Your program — ticket IRWB-016: f32 DSP
An iterative radix-2 FFT and a biquad filter bank, in f32, in Typed.
- Why: float-heavy straight-line code; the FFT size and the coefficients are natural specialization constants (twiddle factors folded at compile time); reassociation and fused multiply-add change the last bits, which is IRWB-011's tolerance-contract question.
- Oracle: bit-exact against r0 for exact pipelines; an error bound in dB against a float64 JavaScript reference for tolerance pipelines.
````

### Evidence and recovery

The worktree contained the guides for IRWB-003, IRWB-006 and IRWB-008. The command `rg -n '^(##|###)|FMA|constant memory|specialize|tolerance' ttmp/2026/11/26/IRWB-{007,010,011}--*/*/*.md` returned `zsh:1: no matches found: ttmp/2026/11/26/IRWB-007--*/*/*.md` because those tickets were skeletons on this branch. Read the missing guide sections from git objects at `69ae7a0` and `d0e6415`.

## Step 2 — Specify the kernels and their checks

Chose packed f32 buffers, runtime FFT lengths of 8, 16 and 32, and three parallel biquads with up to 32 samples. The FFT computes f32 roots from the stage size, so constant-memory specialization has arithmetic to fold. The filter's explicit state updates give the compiler loop-carried copies to analyze.

### Evidence and decisions

The front end's `floatAddress` and `bufferWrite` and the lifter's f32 dispatch support the chosen operations. `casesFrom` generates arguments independently, so a fixed FFT buffer capacity makes each generated exponent valid. Raw evaluator and emulator outputs expose all cells even when the interactive preview clips them. The guide specifies a direct DFT and float64 transposed biquads, per-vector dB limits and a finite contraction witness.

### Implementation checkpoint

The step counts and dB thresholds are design estimates and proposed budgets. The implementation plan gives the checks needed to establish both with actual programs.

## Step 3 — Relate and validate the design

Related seven repository files to the design, added the design and diary links to the ticket index, and recorded the design milestone in the changelog.

### Evidence

After the diary was added, `docmgr doctor --ticket IRWB-016 --stale-after 30` reported `invalid_frontmatter` with `frontmatter delimiters '---' not found` for this file. Added frontmatter using the existing `reference` document type and reran the checks. The example JSON parsed, and all design and index links resolved.

The next doctor run flagged `missing_numeric_prefix`, so renamed the diary to `01-diary.md` and updated the index link. The initial `git add` failed with `index.lock: Read-only file system` in the linked Git worktree metadata. The commit uses scoped access to update that metadata.

## Step 4 — Simplify the design after self-review

Reread the design against the minimum needed to exercise each optimization. Kept multiple FFT sizes, the callable butterfly, two independently configured feedback loops, the raw exact checks and the independent float64 oracles. Reduced the bank to two sections and one output prefix, moved shape requirements to the host, and reduced root setup to one half-angle rule. Consolidated the replay and removed extra fixtures, metric and backend variants whose coverage overlaps the remaining checks.

### Prompt context

User request, verbatim

> Re-read your design document as a skeptical senior engineer whose goal is the simplest design that still serves the experiment. Identify everything that could be removed or simplified without weakening the experiment, revise the document accordingly, and add a short section at the end listing each cut with a one-line reason. Keep the diary up to date. Work only from the files in your worktree; do not read other git branches, other worktrees, or other agents' tickets. Commit only your ticket directory with the message `IRWB-016: simplify the design doc after self-review`. Do not push. Final message: the commit hash and the list of cuts.

### Evidence and decisions

Checked the revised layout and API choices against the current worktree. The single normalized peak bound also bounds RMS error because the peak is at least the RMS of the error vector. The tighter peak score and revised twiddle computation still need r0 calibration during implementation. The end of the design records each cut and its rationale.

Ticket doctor and frontmatter validation passed. Checked the embedded JSON against the stated layouts, verified the FFT step estimate arithmetic and resolved all design links inside this worktree. The scoped diff passed `git diff --check`.
