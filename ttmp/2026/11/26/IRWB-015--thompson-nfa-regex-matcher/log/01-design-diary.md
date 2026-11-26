---
Title: Regex matcher design diary
Ticket: IRWB-015
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
Summary: Design investigation and validation record for the regex corpus ticket.
LastUpdated: 2026-11-26
---

# Regex matcher design diary

## Step 1. Review corpus conventions and create the ticket

I read the corpus examples, workbench case format and compiler implementation. The examples established the project layout and the per-pass checks. I consulted the IRWB-007, IRWB-010 and IRWB-011 guides with `git show` because their text lives on other local revisions.

### Prompt context

The user request appears verbatim below.

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
> ## Your program — ticket IRWB-015: a regex matcher
> A Thompson-NFA matcher with explicit state sets in Typed: the pattern is compiled to an NFA in `Int32Array`s and matched over a text buffer.
> - Why: a second specialization target — a matcher specialized on a fixed pattern should collapse into a hard-coded state machine, as generated lexers such as re2c do; it exercises jump threading, loop unswitching and character-class tests.
> - Oracle: JavaScript's `RegExp` on the same pattern and input, restricted to the implemented subset.

### Evidence

- `docmgr ticket create-ticket --ticket IRWB-015 --title 'Thompson NFA regex matcher' --topics compiler,ir,performance` created this workspace.
- `docmgr doc add --ticket IRWB-015 --doc-type design-doc --title 'Design for a Thompson NFA regex matcher'` created the design document.
- `casesFrom` accepts scalar choices and separate fixed or generated buffer specs. This supports multiple per-pattern profiles run against one source.

## Step 2. Write the design and verify its assumptions

I chose whole-buffer matching with lowercase literals, ranges, grouping, alternation and star. A fragment with one open edge makes the iterative parser feasible with local arrays. Marking states on push bounds the worklist on nullable cycles. The design budgets the workload under the normal per-case limit and defines the measurement to repeat during implementation.

### Findings and recovery

- An inline `node --input-type=module` probe using `typedWasm.compile(source, { inspect })` failed with `Error: unknown tape opcode 252 at 9`. Frame initialization expands to Wasm `memory.fill`, which that inspector cannot decode.
- An inline probe importing the TypeScript lifter failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a constructor parameter property. I reran it with `node --experimental-transform-types --disable-warning=ExperimentalWarning --input-type=module`, remapping local compiled-module imports to TypeScript in memory.
- The final probe reproduced the default ingestion failure, then confirmed that tape ingestion lifted the 64-byte frame, the evaluator returned `1` in 56 statements with intact input memory and the stock reference RV32 image agreed. The design records the existing metadata option and the Node loader integration needed later.
- JavaScript agreed with all 26 directed in-domain expected results, including strict end of input and nullable stars. Matcher step counts remain an implementation acceptance check.

## Step 3. Relate and review the deliverable

I linked seven sources with `docmgr doc relate` and linked the design and diary from the ticket index. The first log write failed with `no such file or directory` because the ticket scaffold omits `log/`. Creating that directory inside the ticket resolved it.

- `docmgr validate frontmatter` passed for both documents. `docmgr doctor --ticket IRWB-015 --stale-after 30` passed.
- A read-only check parsed the example project JSON, resolved local links and verified the capacity fixtures and step-budget arithmetic.

## Step 4. Simplify the design after a skeptical review

The fixed-pattern experiment needs a generic machine with overlapping paths, repetition and both character predicates. I kept those properties and removed nested parsing. Top-level alternatives can share Accept, and each starred atom can expose its split's skip edge for direct patching. Two flag banks now track both reachability and closure visitation.

### Prompt context

> Re-read your design document as a skeptical senior engineer whose goal is the simplest design that still serves the experiment. Identify everything that could be removed or simplified without weakening the experiment, revise the document accordingly, and add a short section at the end listing each cut with a one-line reason. Keep the diary up to date. Work only from the files in your worktree; do not read other git branches, other worktrees, or other agents' tickets. Commit only your ticket directory with the message `IRWB-015: simplify the design doc after self-review`. Do not push. Final message: the commit hash and the list of cuts.

### Evidence and follow-through

- The replacement fixed pattern `[a-c]*d|ab*` retains two paths after the initial `a`. I kept the tape loader requirement and all three correctness comparisons.
- I reduced the generated runs to two profiles and kept directed cases for range boundaries, empty text, competing alternatives and errors. I reduced the benchmark to paired general and specialized runs on the same cases.
- The inline `node --input-type=module` check evaluated the oracle expression from the revised document. It passed 20 expected results and checked the JSON, 416-byte array payload and 494-visit bound. A separate check resolved the local links and confirmed the cuts section is last. Docmgr frontmatter validation passed.
- The step budget remains an estimate until the matcher is implemented and the stress fixture can be measured.
