---
Title: LZ corpus design diary
Ticket: IRWB-014
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
Summary: Design decisions and probe results for the LZ corpus project.
---

# LZ corpus design diary

## Step 1 — Opened IRWB-014 and reviewed the corpus

Created the ticket and design document with the requested docmgr commands. Read the corpus API and the Blend, Checksum, Sort, Histogram, Records, Match Enum, and Strings projects. Checked Candela's local arrays and explicit stack traversal, then traced case generation, pass validation, and the reference image path. Consulted the available in-tree optimization designs relevant to the workload.

<details>
<summary>User request, verbatim</summary>

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
> ## Your program — ticket IRWB-014: an LZ-style compressor and decompressor
> Hash-chain match finding over a text buffer, literal and match encoding, and a decompressor, in Typed.
> - Why: dense memory accesses and bounds checks, including checks that need relations between indices (`i + len <= n`, back-references) — the kind insertion sort still loses on; byte and bit twiddling for rule discovery; loop-carried dependencies.
> - Oracle: a round trip, `decompress(compress(x)) == x`, which holds on any input, so generated cases are meaningful.

</details>

## Step 2 — Probed language and both project loading paths

Used an in-memory Node module hook to load source TypeScript and the repository's `tools/node-vendor.mjs`. The initial `node --input-type=module` run hit `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property. With `--experimental-transform-types`, one probe attempt imported the nonexistent `src/framework/core/artifact.ts`. The specialization test showed that `createArtifact` comes from `src/framework/contracts/index.ts`.

The actual feature probe hit `unknown tape opcode 252 at 9` through `Program.fromProject`. Explicit tape ingestion gave 160 frame bytes, and the concrete wrapper returned 2 in 75 evaluator statements with output cells `[129, 161]`. The `speed` pipeline had no rejections and each of four functions agreed on 40 cases with zero traps or limits. The emitted and reference RV32 images each agreed on 40 wrapper cases. Binding the wrapper and callee's scalar limit to 3 also passed 40 cases per function. A separate in-memory `createWb` project honored the ingest metadata and ran a fresh script that returned 7 in 18 RV32 instructions. The evidence supports forwarding the existing ingest option in the two Node loader paths.

## Step 3 — Wrote the design and checked the handoff

Specified a single-byte token with a three-to-six-character match, a bounded chain over 16 bucket heads, and an overlapping forward decoder. Used a fixed standalone decoder case so all current function checks have valid arguments. The collision fixture distinguishes one chain visit from two. The design records the arithmetic step estimate and leaves actual codec measurements to implementation. See the [design document](../design-doc/01-lz-style-compression-corpus-project.md).

Validated local links, document length, and the 12,440-statement budget arithmetic. Added the diary frontmatter after docmgr flagged the missing delimiters, then reran `docmgr doctor --ticket IRWB-014 --stale-after 30` with all checks passing.
