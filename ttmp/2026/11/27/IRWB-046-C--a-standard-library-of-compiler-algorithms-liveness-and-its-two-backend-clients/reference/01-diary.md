---
Title: 'Diary: src/stdlib and liveness'
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
Summary: "Chronological record of IRWB-046-C: the readings, the probes, the two hand-computation slips the reference test caught, and every check that was run."
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary — IRWB-046-C

## Entry 1 — read the ground, then wrote the design

Read the two clients and the design doc before deciding anything.

- `src/typed/backend/regalloc.ts:85` `intervals()`: per-block use/def loop (lines 87-94), then the backward
  fixpoint (lines 95-110), then the interval construction.
- `src/typed/backend/coalesce.ts:32`: the same use/def loop and the same fixpoint (lines 33-55), then the copy
  exceptions and union-find.
- Both fixpoints initialise every block to `{}` and sweep **every** block in reverse index order, with no
  reachability filter. That is the scope decision the ticket asks to make explicit.

Probe 01 (`scripts/01-unreachable-block-scopes.mjs`, after `npm run build`) on the ticket's case — block 0 jumps to
the join, block 1 (`dead`, nothing jumps to it) also jumps to the join, the join uses `r64` and `r65`:

```
machine liveness (every block):
  block 0 ["entry"] live-out {64, 65}
  block 1 ["dead"]  live-out {64, 65}
  block 2 ["join"]  live-out {}
framework solver (entry-reachable only):
  block 1 ["dead"]  in {} out {}
disagreement on block 1 live-out: {64, 65} vs {}
```

Which confirms, on this checkout rather than from the ticket text, that the two scopes disagree exactly where the
ticket says, and that both clients today answer `'all'`.

Baseline before any edit: `node .../IRWB-039/scripts/02-baselines.mjs check` prints `no differences` (5m35s).

Wrote `design-doc/01-stdlib-liveness-interface-scope-and-layout.md`: the admission case for liveness, the layout with
one line per later module, the shape/scope/result interfaces, the scope argument with probe 01's table, the clients'
edits, the tests, the alternatives, and the Later list. Decisions taken there:

- `src/stdlib/flow/liveness.ts`, with `src/stdlib/index.ts` as the only index; later modules are named in the design
  and in the index, not stubbed out as empty files.
- `LivenessScope` is required and is a discriminated union (`'all'` | `'entryReachable'` + entry), not a boolean or a
  default, so no caller gets a scope by omission.
- `reads`/`writes` return `Iterable`, so `usesOf`/`defsOf`'s arrays can be passed straight through with no per-
  instruction `Set` allocation.
- `walkBackwards(block, visit)` for per-item live sets instead of an array of sets: the coalescer walks backwards
  anyway and discards each set.
- Both clients keep the fixpoint's round-robin reverse-block order, so the extraction cannot be blamed for a change
  that is really a schedule change.
- `physicalOccupancy()`'s bitmask sweep stays; it is a third copy in a different representation and is not one of the
  two clients the step names.

## Entry 2 — the primitive and the two clients

Wrote `src/stdlib/flow/liveness.ts` and `src/stdlib/index.ts` as the design says: `LivenessShape` (blockCount,
successors, items, reads, writes), required `LivenessScope`, result with `liveIn`/`liveOut` and
`walkBackwards(block, visit)`.

Two implementation notes that are not in the design:

- the fixpoint compares sets by content (`sameSet`) rather than by size as the clients did. Under monotonicity the two
  are equivalent, but content comparison needs no monotonicity argument to read correctly.
- `reachableFrom()` is a plain stack walk and is only called for scope `'entryReachable'`; scope `'all'` passes
  `null` and the sweep visits every block, as the clients did.

`regalloc.ts`: added `machineLiveness(code, blocks?)` beside `machineBlocks` (the shape binding plus scope `'all'`
with its reason), and `intervals()` now reads `liveIn`/`liveOut` from it. `Intervals.liveOut` retyped to
`readonly ReadonlySet<number>[]`; `grep` says nothing in `src/`, `site-src/`, `tools/` or `tests/` reads it.
`coalesce.ts`: the two sweeps became `live.walkBackwards(k, …)` around the edge building, and `usesOf` left the
import list. tsc clean on the first try (`npm run check`).

## Entry 3 — the tests, and two tests of my own hand computation

`tests/stdlib/liveness.test.mjs`: hand-computed sets, the unreachable block under both scopes, `'entryReachable'`
from a non-zero entry, and 40 seeded random graphs against a search-based reference (the definition: some path to a
read with no write in between). Eight tests, and the reference caught nothing in the primitive — it caught **my
hand computation**, twice:

- I asserted block 0's live-in of the diamond was `{a}`; `a = 1` is a definition in block 0, so it is `{}`. The
  primitive was right.
- I asserted both of block 2's items had `{a, b}` live after them; after `a = g(b)` the register holding `b` is dead
  (that was its last use), so both are `{a}`. The primitive was right (and the reference agrees, since it passes now).

`tests/stdlib/imports.test.mjs`: no import outside `src/stdlib/` (this is what makes `src/framework/`, `src/typed/`
and `src/tensor/` unreachable from the library, and it also bans Node builtins — a library algorithm that needs the
clock or the filesystem is not one), the layer direction from the index's table, and that the index re-exports every
module. Probed by adding two throwaway modules (one importing `../../framework/dataflow/solver.js`, one in `graph/`
importing `../flow/liveness.js`): both failed with the offending path named, and both passed after deletion.

Then the expensive checks. `npm run build`, then the baselines script: **no differences** (5m05s). The typed suite:
188 tests, 183 pass, 0 fail, 3 `todo` (F36, F37, F38 — other steps'). Framework: 242 / 238 / 0 fail / 4 todo
(F33 ×2, F34, F35). Workbench: 25 / 24 / 0 fail. Tensor without gpu: 45 / 44 / 0 fail / 1 todo (F27). `npm run
check` clean; `npm run format:check` reports 9 files, all of them already unformatted before this step (checked with
`git diff --stat` — none of them mine); `node tools/build-site.mjs` builds (131 source files, it bundles
`src/typed`).

## Entry 4 — probe 02, the uncomfortable measurement

`scripts/02-unreachable-blocks-in-corpus.mjs`, over 100 project-pipelines (every corpus project at `r0` and at the
`speed` head) and 3,730 Typed basic blocks: **0 functions and 0 blocks are unreachable**. So no corpus project can
tell one liveness scope from the other, and the baselines prove nothing about the scope. The test is the only guard;
that is why it asserts both scopes. 2m45s to run.

Also wrote `reference/02-report.md`, with the three places where the brief and the repository disagree: there is no
`todo` test for this step (so none was removed), `physicalOccupancy()`'s bitmask sweep is a third copy that stays, and
the layering of the later modules is mine because design doc D is not in this worktree.
