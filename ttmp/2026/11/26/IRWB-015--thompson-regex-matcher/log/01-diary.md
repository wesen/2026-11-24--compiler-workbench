---
Title: IRWB-015 diary
Ticket: IRWB-015
Status: active
Topics: [compiler, ir, performance]
DocType: reference
Intent: short-term
Summary: Corpus reading, feature probes, and design decisions.
---

# IRWB-015 diary

## Step 1 — Read the corpus and create the ticket

I compared the project layouts and input specs for Blend, Checksum, Sort, Histogram, Records, Match Enum, and Strings. I traced frame arrays in the Candela source and read the available optimization designs far enough to identify the speed pipeline and the constant-memory opportunity. I created IRWB-015 and its design document with the requested docmgr commands.

<details>
<summary>Original request</summary>

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
> ## Your program — ticket IRWB-015: a regex matcher
> A Thompson-NFA matcher with explicit state sets in Typed: the pattern is compiled to an NFA in `Int32Array`s and matched over a text buffer.
> - Why: a second specialization target — a matcher specialized on a fixed pattern should collapse into a hard-coded state machine, as generated lexers such as re2c do; it exercises jump threading, loop unswitching and character-class tests.
> - Oracle: JavaScript's `RegExp` on the same pattern and input, restricted to the implemented subset.

</details>

## Step 2 — Probe the language and project paths

The standalone range probe exercised frame arrays, indexed access, scalar helper calls, and buffer reads on both machine backends. The Node project loader failed with `unknown tape opcode 252 at 8`, while direct tape ingestion and the workbench metadata path succeeded. The front end rejected passing a frame array. Numeric `oneOf` produced zero pointers for string choices, so the design proposes a small explicit string-list input spec.

The initial `node --input-type=module` trial failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property. The repeatable command uses `--experimental-transform-types` and runs without a workspace build. The first saved probe also hit `TypeError: p.compile is not a function` on the core Program, so it now calls `lowerToImage` and uses the workbench handle for the project script. During the fixture check, an initial Markdown fence extractor gave `Invalid regular expression: missing /` and its first correction selected the grammar fence. The final extractor selects the JSON fence.

## Step 3 — Write and verify the design

I chose a small concatenation grammar with ranges and stars, then used a dense membership set and a queue to make epsilon closure explicit. The design gives four pieces and eight text units as the limits and budgets 15,608 interpreter statements. Measuring the actual maximum remains part of implementing the matcher.

`node --experimental-transform-types ttmp/2026/11/26/IRWB-015--thompson-regex-matcher/scripts/01-probe.mjs` passed. The reference and evaluator agreed on all 24 probe cases, the sample `speed` run had no rejections, and JavaScript RegExp accepted the proposed benchmark and maximal-active-set fixtures. I related seven repository files to the design with `docmgr doc relate`.

## Step 4 — Validate the ticket

The first `docmgr doctor --ticket IRWB-015 --stale-after 30` reported `frontmatter delimiters '---' not found` on this diary. I added frontmatter with the existing `reference` document type and reran the metadata checks before staging the ticket.

The metadata checks passed. The sandboxed `git add -- ttmp/2026/11/26/IRWB-015--thompson-regex-matcher` could not create the worktree's `index.lock` because the Git administrative path was mounted read-only.
