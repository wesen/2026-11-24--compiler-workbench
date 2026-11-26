---
Title: SHA-256 and ChaCha20 design diary
Ticket: IRWB-013
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
Summary: "Records the investigation and decisions for the corpus project design."
---

# Design diary

## Step 1 — Establish the corpus and ticket scope

I read the requested project examples, the workbench API, the Candela frame-array examples and the relevant optimization tickets. IRWB-003, IRWB-006 and IRWB-008 had design guides in this worktree. The IRWB-007, IRWB-010 and IRWB-011 directories contained ticket scaffolds, so I used their stated scope from the request and the repository research agenda.

I created IRWB-013 with the three existing topics and added the design document with `docmgr`.

<details>
<summary>Original user request</summary>

~~~~text
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

## Your program — ticket IRWB-013: SHA-256 and ChaCha20
Pure 32-bit integer cryptography in Typed: SHA-256 (64 rounds, message schedule) and the ChaCha20 block function (16 live state words).
- Why: RV32's base ISA has no rotate instruction, so `(x >>> n) | (x << (32 - n))` idioms are targets for rule discovery (IRWB-010); round unrolling and constant tables exercise constant propagation; 16+ live values stress register allocation.
- Oracle: published test vectors, and the framework's own SHA-256 (`src/framework/core/data.ts`) as a second implementation.
- Measure: instructions per byte.
~~~~

</details>

## Step 2 — Verify the Typed and oracle interfaces

The evaluator counts statements across caller and callee, and its default meaning contract generates cases for helpers too. I checked the front-end operators and lifter mappings, then ran an in-memory, non-crypto vendor probe covering logical shifts, bitwise complement, a wide hex word, buffer stores and a 16-byte frame array. The front end recognized the frame and the reference compiler emitted both entries.

The framework's text hash goes through UTF-8 and may delegate to Node crypto. The design pairs the text wrapper and portable implementation with explicit binary hashing and uses the NIST and RFC fixtures to anchor the output encodings.

## Step 3 — Specify kernels and review constraints

I chose a 119-byte SHA limit to cover two-block padding, separate runtime buffers for specialization inputs, and scalar ChaCha working words with one fixed array for feed-forward. Scalar and buffer signatures keep the stock reference runner applicable to every function. The design records step estimates and requires measurements at the default cap during implementation.

I linked seven repository files with `docmgr doc relate`. The implementation and performance results are future work described in the design.

## Step 4 — Validate the design package

The ticket passed `docmgr doctor --ticket IRWB-013 --fail-on warning` and the design passed frontmatter validation. All 16 local Markdown links resolved, and a host SHA-256 check matched the published digest for the 56-byte fixture.

The sandboxed staging command `git add -- "$ticket"` failed with `Unable to create '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.git/worktrees/codex-irwb-013/index.lock': Read-only file system`. The staging retry requests access to the existing worktree index and uses the same ticket path.
