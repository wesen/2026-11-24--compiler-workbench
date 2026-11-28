---
Title: 'Report: the stdlib skeleton and liveness, adopted by the register allocator and the coalescer'
Ticket: IRWB-046-C
Status: active
Topics:
    - stdlib
    - framework
    - liveness
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "What IRWB-046-C built, what it measured, every acceptance result, and the two places where the brief and the repository disagree."
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Report — IRWB-046-C

One session, two commits of the ticket's work (design, then implementation) plus this report. Design:
`design-doc/01-stdlib-liveness-interface-scope-and-layout.md`; diary: `reference/01-diary.md`; probes:
`scripts/01-unreachable-block-scopes.mjs`, `scripts/02-unreachable-blocks-in-corpus.mjs`.

## What changed, file by file

| file | change |
|---|---|
| `src/stdlib/index.ts` | new: the library's index — the layer table (leaf/middle/upper/top from design doc D), the admission rule, one line per module later steps add, and the re-export of `flow/liveness.ts`. |
| `src/stdlib/flow/liveness.ts` | new: `liveness(shape, scope)` — backward gen/kill over `LivenessShape` (block count, successors, item ranges, `reads`/`writes` per item), with the required `LivenessScope`, returning `liveIn`/`liveOut` per block and `walkBackwards(block, visit)` for per-item live sets. 140 lines with the header that states the scope trap. |
| `src/typed/backend/regalloc.ts` | `machineLiveness(code, blocks?)` added: the machine code bound to a `LivenessShape` with scope `'all'`, in one function with the reason in its doc comment. `intervals()` lost its use/definition loop and its fixpoint (23 lines) and reads `liveIn`/`liveOut` from the primitive. `Intervals.liveOut` is retyped `readonly ReadonlySet<number>[]` (nothing in the repository reads it). `machineBlocks`, `usesOf`, `defsOf`, `allocate` and `physicalOccupancy` untouched. |
| `src/typed/backend/coalesce.ts` | the same two sweeps deleted (23 lines); the interference edges are built inside `live.walkBackwards(block, …)`, with IRWB-003's copy exception and IRWB-034-G's `a <- s; b <- s` unchanged; the unneeded `usesOf` import dropped. |
| `tests/stdlib/liveness.test.mjs` | new: 8 tests — a diamond with a loop (hand-computed live-in/live-out and per-item live sets), a use before a definition versus a definition before a use, a variable read three times by one instruction, the unreachable block under both scopes, `'entryReachable'` from an entry that is not block 0, and 40 seeded random graphs checked against a search-based reference implementation of the definition. |
| `tests/stdlib/imports.test.mjs` | new: 3 tests — no import outside `src/stdlib/` (which is what excludes `src/framework/`, `src/typed/`, `src/tensor/`), the layer direction, and that the index re-exports every module. |
| `ttmp/…-046-C/scripts/01-unreachable-block-scopes.mjs` | new: probe 01, the ticket's unreachable-block case, printed from `intervals` and from the framework solver. |
| `ttmp/…-046-C/scripts/02-unreachable-blocks-in-corpus.mjs` | new: probe 02, how much of the corpus has an unreachable block. |

Nothing under `src/framework/`, `src/tensor/` or `src/workbench/` was touched.

## The scope decision

Both clients take scope `'all'`: every block, reached or not. Probe 01 on the ticket's case (block 0 jumps to the
join; block 1, which nothing reaches, also jumps to the join; the join uses `r64` and `r65`):

```
machine liveness (every block):   block 1 ["dead"] live-out {64, 65}
framework solver (entry-reachable only):   block 1 ["dead"] in {} out {}
```

So the machine code's answer is `{64, 65}` and the entry-reachable solver's is `{}`, exactly as the ticket states,
and `intervals` today is the former. Why `'all'` is the client's scope: block 1's instructions are in the image, and
its live-out feeds the interval construction through `touch(r, b.end + 0.5)` and `touch(r, b.start)`; a register live
into or out of an unreachable block therefore stretches the interval over it. Under `'entryReachable'` those touches
vanish, an interval's start moves forward and its end back, and it can lose a `crossesCall` — every one of which
changes which register linear scan takes, or whether it spills.

The primitive answers both, because they are answers to different questions (the code as laid out, and the
executions that happen), and the scope is a required, discriminated-union argument: no caller gets one by omission.

## Acceptance

**1. The tests.** `node --test tests/stdlib/liveness.test.mjs tests/stdlib/imports.test.mjs`:

```
ℹ tests 11   ℹ pass 11   ℹ fail 0
```

The unreachable-block test states both scopes and asserts both: with `'all'` block 1's live-out is `{64, 65}`,
with `'entryReachable'` `{}`, and both tests also assert that the reachable blocks' facts are identical under either
scope (why a test of the join alone would pass under either). The import test was probed by adding a module that
imports `../../framework/dataflow/solver.js` and a leaf module that imports `../flow/liveness.js`: both failed with
the offending path in the message, and both passed again after removing them.

The existing backend tests pass unchanged (they are in the typed suite below, `backend.test.mjs` and
`f32-backend.test.mjs` among them).

**2. The baselines.** After `npm run build`:

```
node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check
no differences from …/various/baselines/main.json
timing: inline on attention 0.527 -> 8.322 ms per application
```

(5m05s. The timing line is informational and not compared; it moved because other agents share this machine.)

**3. The suites** (built with `npm run build`, Node 24, files passed explicitly):

| suite | tests | pass | fail | todo | skipped |
|---|---|---|---|---|---|
| `tests/typed/*.test.mjs` | 188 | 183 | 0 | 3 (F36–F38, other steps) | 2 |
| `tests/framework/*.test.mjs` | 242 | 238 | 0 | 4 (F33 ×2, F34, F35, other steps) | 0 |
| `tests/workbench/*.test.mjs` | 25 | 24 | 0 | 0 | 1 |
| `tests/tensor/*.test.mjs` without `*-gpu` | 45 | 44 | 0 | 1 (F27, another step) | 0 |
| `tests/stdlib/*.test.mjs` (this step) | 11 | 11 | 0 | 0 | 0 |

**4.** `npm run check` is clean. `npm run format:check` reports 9 files that were already unformatted before this
step (none of them mine; my four files pass). `node tools/build-site.mjs` builds: `app.js 3092 KiB, 131 source
files` — it bundles `src/typed`, which I changed.

## Measurements worth recording

**Probe 02: the corpus does not exercise the trap.** Over 100 project-pipelines (every corpus project at `r0` and at
the `speed` head), 3,730 Typed basic blocks: **0 functions and 0 blocks are unreachable**. So the baselines — images,
instruction counts, edit censuses — cannot catch a wrong liveness scope, and `tests/stdlib/liveness.test.mjs` is the
only guard on it. That is the reason the unreachable-block test asserts both scopes rather than only the one the
clients use.

## Where the brief and the repository disagree

1. **There is no `todo` test for this step.** The brief says "your step's test is named in the acceptance above: make
   it pass and remove its `todo` option in the same commit", but the three defect files hold one `todo` per fix step
   (F27, F33, F34, F35, F36, F37, F38) and none for 2a/2b or for the standard library. Nothing under `src/` or
   `tests/` mentions `stdlib`. So the tests this step needed are new tests in a new suite directory,
   `tests/stdlib/`, written without `todo`; no `todo` was removed because none existed. (The four suites the
   acceptance lists do not include `tests/stdlib/`; it is picked up by `npm test`'s `tests/**/*.test.mjs` glob, and
   I ran it explicitly.)
2. **A third copy of the same sweep stays.** `physicalOccupancy()` in `regalloc.ts:155` runs the same backward
   gen/kill equations a third time, over `Int32` bitmasks, to answer `occupied(r, from, to)` and `liveOut(r, at)` for
   a non-leaf function's `fa0`-`fa7` clashes. It is not one of the two clients the brief names, and it is not
   line-for-line the same code (bitfields, prefix counts, a different item accessor that includes `m.uses` and
   writes all tracked registers at a call). Converting it means materialising sets and then bitmasks per instruction
   in a path the baselines cover only indirectly, for no gain in this step; it is listed under Later in the design.
   If the reviewer's intent was "no liveness sweep left in `src/typed/backend/`", that is one more change and it
   should be its own step.
3. **The design doc's layering D is not in this worktree.** IRWB-039's design doc names it (`graph lattice num` use
   nothing; `ssa flow` use them; `pe affine term` above; `check measure` on top) but the ticket that proposed it is
   not here, so the layer assignment of the later modules in `src/stdlib/index.ts` (§3 of the design) is mine, made to
   satisfy that sentence. Two placements are guesses that a later step may reasonably move: `num/intervals.ts` as a
   leaf (it is used by `guards.ts`, which is leaf-like arithmetic) and `measure/frequencies.ts` on top (it is used by
   the backend's cost estimates and by the Tix fusion gate, both of which want the graph and the cost model).

## Left out, and why

- Step 2c (`graph`, `lattice`, `ssa` moved from `typed/analyses.ts`, `typed/sccp.ts` and the framework solver's
  helpers) — a later step per the design doc; it has its own decision point ("if an adapter is larger than the
  algorithm it replaces, keep the domain copy") and would have doubled this session.
- A generic fixpoint solver: liveness carries its own 12-line loop. The framework's `solve()` cannot be imported
  (the library imports no framework), and building the stdlib's own solver is step 2c's `lattice/fixpoint.ts`,
  whose first client it will be. This is the one place where this step duplicates a concept the framework has.
- The framework's `solve()` keeps its entry-reachable scope: the discrepancy probe 01 prints is a property of two
  different questions, not a framework defect, and `src/framework/` was out of scope.
