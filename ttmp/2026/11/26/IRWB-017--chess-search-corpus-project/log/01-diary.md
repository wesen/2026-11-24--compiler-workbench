---
Title: Chess search corpus design diary
Ticket: IRWB-017
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/chess-search/project.json
      Note: Entry roots and generated fixture inputs
    - Path: repo://corpus/projects/chess-search/scripts/fixtures.mjs
      Note: Independent chess assertions and RV32 instruction counts
    - Path: repo://corpus/projects/chess-search/search.typed
      Note: Iterative search and budget unwind
    - Path: repo://tests/typed/chess-search.test.mjs
      Note: Project-scoped tests and workbench smoke
ExternalSources: []
Summary: Investigation and validation of the chess search corpus design.
LastUpdated: 2026-11-26T11:00:00-05:00
WhatFor: ""
WhenToUse: ""
---

# IRWB-017 design diary

## Step 1 — Opened the ticket and read the engine

Created IRWB-017 with the requested topics and added the design document using docmgr. Read the named corpus projects and the Workbench reference, sampled the Candela frame-array source, and traced the four-file chess core and fixture runner. The existing iterative perft and resumable search fit one project with a small driver.

<details>
<summary>Original task request</summary>

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
> ## Your program — ticket IRWB-017: the existing chess search, ported into the corpus
> The user already has a chess engine written in Typed in their own repository `/home/manuel/code/wesen/2026-10-20--ds-js-os` (read only; do not modify it): `apps/typed/chess/` (`position.typed`, `moves.typed`, `search.typed`, `state.typed`, and others), with reference positions in `bench/reference/chess/reference-positions.json` and a host runner in `bench/host/`. Design how to bring its engine core (position, move generation, search) into this repository as a corpus project.
> - Why: branchy integer code, an explicit-stack alpha-beta search and move generation — realistic control flow, unlike loop-heavy kernels.
> - Oracle: perft node counts for known positions, and the reference positions.

</details>

## Step 2 — Probed ingestion, entry scope, and case sizes

Built the existing TypeScript into the ticket's temporary `.probe/` directory using cached packages. Loaded the vendor scripts through `tools/node-vendor.mjs`. The initial `node --input-type=module` smoke hit `[notCompiled] prog:probe did not compile: expected return`. The revised tiny source used braced control statements and worked. The first file-based run, `node "$ticket/.probe/run.mjs"`, hit `ERR_MODULE_NOT_FOUND` for `ttmp/tools/node-vendor.mjs`. Correcting the import depth recovered the run.

The two-file smoke returned −1 in 31 statements and wrote the wrapped u16 value. Project JSON ignored the entry list and checked the helper directly. Direct `Program` construction scoped the check. The upstream files ingested as 53 functions and both RV32 compilers lowered them. The bounded search probe used the original engine and an in-memory loop. The search's budget-two cases used 12,054–12,953 statements, and the final scoped `speed` check agreed on 20 cases per entry with zero traps or limits.

The first state inspection used field enumeration order and mislabeled the result. Reading the named byte offsets recovered the correct search fields. The quiet mate fixture completed with `d6c7`, score 29,997, depth 3, and 1,344 nodes. The reference, r0, and `speed` images with backend options agreed with the evaluator, including guest memory.

## Step 3 — Wrote and linked the design

Recorded the port boundary, storage, generated inputs, loader gap, and oracle plan. `docmgr doc relate` recorded seven key files. The ticket-index relation initially reported `malformed --file-note value` because zsh parsed the colon following the variable as a modifier. Bracing the variable fixed it. The first diary write failed because the generated ticket had no `log/` directory. Created it and added this diary. The final ticket contains documentation only.

## Step 4 — Checked the ticket

`docmgr doctor --ticket IRWB-017 --stale-after 30` initially reported `invalid_frontmatter` for the diary. Added the ticket's reference metadata and reran the check. Removed temporary probe files before staging the ticket.

The first `git add -- "$ticket"` hit `Unable to create .../index.lock: Read-only file system` under the shared Git worktree metadata. Requested sandbox escalation for the ticket-only commit.

## Step 5 — Ported the core and qualified project ingestion

The pinned upstream checkout matched the design revision. I kept the move ordering, make/unmake, clocks and search stack layout. The port removes UI and timer concerns and the guards that the supported input domain makes unnecessary.

### Prompt context

<details>
<summary>Implementation request</summary>

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed, a small statically typed language with TypeScript-like syntax, to 32-bit RISC-V (RV32IMF), built on an IR framework in which every optimization pass is checked against the original program. Your task: implement the corpus project designed in your ticket IRWB-017. The design document is in `ttmp/2026/11/26/IRWB-017--*/design-doc/`. It has been reviewed; implement it as designed. Where the design turns out to be wrong about the code, follow the code and record the deviation in your diary.
>
> ## Read first
> - Your design document.
> - `corpus/reference.md` and two or three existing corpus projects (for example `corpus/projects/sort`, `checksum`, `histogram`).
> - `tests/typed/project-meta.test.mjs`: `project.json` now supports `"ingest": { "tape": true }` (needed for frame arrays) and `"entries": [...]` (checks generate cases for the listed entry functions only), in `Program.fromProject`, `ingestProject` and `tools/parity.mjs`.
>
> ## Deliverables
> - The corpus project under `corpus/projects/<name>/` as the design describes (`.typed` sources, `project.json`, `notes.md`, any scripts the design calls for).
> - The tests and checks the design calls for, under `tests/typed/`.
> - Your ticket's diary (use your docmgr and diary skills), tasks and changelog, kept current as you work.
>
> ## Environment
> - `node_modules` is found from the repository root. Run `npm run build` once before using `dist/`.
> - Six agents share this machine. Run only your own tests (`node --test tests/typed/<your-test>.test.mjs`) and, for your project, `node tools/parity.mjs <name>` or `node tools/reference-check.mjs <name>` if useful. Do not run the full test suite (`npm test`), corpus-wide tools without a project argument, or anything that touches Candela.
>
> ## Constraints
> - Do not modify `src/`, `tools/`, other corpus projects, other tickets, or existing tests. Adding your project's id to `corpus/projects/index.json` is allowed.
> - Never run code from downloaded archives under `ttmp/**/sources/`.
> - Commit at sensible points on your current branch with messages starting `IRWB-017:`. Do not push.
> - Final message: what you built (paths), how it was checked (commands and results), what deviates from the design, and the commit hashes.
> Your ticket is IRWB-017. Your design document is `ttmp/2026/11/26/IRWB-017--chess-search-corpus-project/design-doc/01-port-the-typed-chess-engine-into-the-optimization-corpus.md`.
> The upstream engine is in `/home/manuel/code/wesen/2026-10-20--ds-js-os` (read only; do not modify it).

</details>

### What I did

- Copied the fixture data verbatim, adapted the upstream FEN encoder and move decoder, and generated the two padded boards from the named fixtures.
- Read the project metadata tests and traced entry propagation through `Program.fromProject`, the browser workbench and the parity command.
- Built once with `npm run build`, then used a project-local Node probe to check ingestion, record offsets and the assembled focus.

### What worked and what changed from the design

- The default ingest path loaded 50 functions and `program.check({ count: 1 })` checked only `chessSearch` and `chessPerft`, with one successful case apiece. The frames use the caller's buffer, so tape ingest for Typed frame arrays was unnecessary.
- The proposed source order failed with `unknown type SearchState` at line 1, column 44. Moving `state.typed` ahead of `main.typed` fixed the declaration order and put the search-step call at assembled line 16.
- The current Node and workbench loaders already support scoped entries. The corpus scanner includes new directories, so the project index requires no edit.
- `tools/reference-check.mjs` loops over every project even with an id argument. The project runner uses the same reference compiler with the exact assembled source and scopes all generated checks to this project.

### Fixture probe and recovery

The first opening oracle check reported an empty decoded list although `chessLegalMoves` returned 20. A targeted `benchCase` probe showed that `readBuffer` caps output at 256 cells and the list starts at 512. The runner now reads cells from guest memory using a `DataView`. The same probe confirmed `SearchState` byte offsets and opening perft depth one (20).

### Review

Start with `project.json` for the roots and exact inputs, then `main.typed` for the driver. The fixture runner checks restored position cells separately from whole guest memory parity. The coverage and measured counts are recorded in the next qualification step.

## Step 6 — Qualified fixtures, pass checks, and instruction counts

The project runner checked 12 independent legal move sets, check statuses, and every recorded perft depth, plus depth zero. The evaluator and the three RV32 images agreed on the entire initialized guest memory for each call. The bounded search also returned the first legal move after two nodes and left `completed` at zero. The depth-three search found the reference mate in two.

### Evidence and commits

- `ddfddc3` ports the engine, fixture data, metadata, runner, and inspector.
- `node corpus/projects/chess-search/scripts/fixtures.mjs` passed all concrete assertions and 20 generated cases per root. The r0 evaluator used at most 12,819 statements for generated search and 9,162 for generated perft under the 20,000 limit.
- `node tools/parity.mjs chess-search --json` published 18 changed revisions and agreed on 200 out of 200 cases with zero rejections, disagreements, or inconclusives.
- `node corpus/projects/chess-search/scripts/fixtures.mjs measure` independently reproduced the depth-three result `d6c7`, score 29,997, completed depth 3, and 1,344 chess nodes. The evaluator used 7,820,284 statements. The r0, checked speed with `chains`, `coalesce`, and `homes`, and reference images executed 14,804,396, 10,079,349, and 10,827,760 instructions respectively. The final trimmed source accounts for the different counts from the design probe.
- `cmp corpus/projects/chess-search/fixtures/reference-positions.json /home/manuel/code/wesen/2026-10-20--ds-js-os/bench/reference/chess/reference-positions.json` confirmed a byte-for-byte match.

### Noteworthy decisions and failures

The sandbox rejected both the default and a private tmux socket with `Operation not permitted`. I ran the terminating parity process through the command session. The sandbox also denied Git's worktree index lock with `Read-only file system`. The project commit succeeded with restricted-path staging and escalation.

## Step 7 — Exercised the workbench inspector and project tests

The workbench regression opens only the chess project through the same project API used by the browser. It checks the assembled focus, runs the fresh inspector and verifies the active program remains at r0. The inspector returns the search-step function ID and attack-ray loop header IDs.

### Evidence

- `node --test tests/typed/chess-search.test.mjs` and a rerun with the TAP reporter passed. The default isolation in this environment reported at file granularity.
- A targeted `casesFrom` probe confirmed that the 20 generated search calls cover all six depth and advanced-flag combinations.
- `docmgr doctor --ticket IRWB-017 --stale-after 30` passed.
- `node --test --test-isolation=none tests/typed/chess-search.test.mjs` reported four passing named tests. Every changed inspector revision passed 80 out of 80 generated cases, and the final inspector checks passed 20 out of 20 per root with zero traps or limits.
- The Scripts view prints plain YAML. Added clickable r0 search and ray-loop links to the first line of `notes.md`, which the Source view renders. A project-only workbench probe resolved the function and both ray-loop headers, and a Node probe of the site's inline renderer verified all four navigation links.
