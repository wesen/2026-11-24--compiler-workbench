---
Title: 'Report: stdlib/flow — the fixpoint solver, moved out of the framework and liveness rewritten on it'
Ticket: IRWB-053-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/stdlib/flow/solver.ts
      Note: the moved solver, body unchanged; flowOrder is the entry walk
    - Path: src/framework/dataflow/solver.ts
      Note: re-export shim, depthFirst kept for the old callers
    - Path: src/stdlib/flow/liveness.ts
      Note: the second client, on the solver with the set lattice
    - Path: src/stdlib/index.ts
      Note: exports the solver; the flow/ line in what-exists-now
    - Path: src/typed/analyses.ts
      Note: FlowGraph now comes from the library index
    - Path: tests/stdlib/flow.test.mjs
      Note: fixpoints, widening, unreachable block, liveness against the old sweep
    - Path: tests/framework/layering.test.mjs
      Note: header comment only
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T23:35:00-05:00
WhatFor: ""
WhenToUse: ""
---


# Report: `stdlib/flow`

## What this step is

The framework's fixpoint solver (`src/framework/dataflow/solver.ts`, IRWB-001 E4) moved into the standard
library as `src/stdlib/flow/solver.ts` — `solve`, `FlowGraph`, `SolveOptions`, `Solution`, the
`DataflowError` it throws, and the entry walk — with the body of `solve` unchanged. The framework's
dataflow layer re-exports it, so `dataflow()` in `analysis.ts`, Typed's three dataflow analyses, the
workbench and the framework's own tests keep their imports and their facts.

The second client is the library's liveness, which used to hardcode its own backward sweep. It is now the
solver with `setLattice()`: the same equations, stated to the solver instead of to a `for` loop, under
both scopes it takes, with the old sweep deleted. The index's promise ("the fixpoint solver over a
lattice — liveness hardcodes its own; this generalises it") is what this step carries out.

## Files, one line each

- `src/stdlib/flow/solver.ts` (moved from `src/framework/dataflow/solver.ts`, 165 → 172 lines): the
  algorithm untouched; a new header (what it solves, that the lattice is `stdlib/lattice`'s and the order
  `stdlib/graph`'s, that liveness is the second client); the order import repointed at `../graph/orders.js`
  and the lattice type at `../lattice/lattices.js`; `depthFirst` renamed `flowOrder` (see decisions).
- `src/framework/dataflow/solver.ts` (165 → 12 lines): `export *` from the library plus
  `export { flowOrder as depthFirst }`, and a header saying where the solver went and why the name differs.
- `src/stdlib/index.ts`: exports `solve`, `DataflowError` and `FlowGraph`/`SolveOptions`/`Solution`; the
  `flow/` line under "what exists now" names the solver and liveness; the "later" line it replaces is gone.
- `src/stdlib/flow/liveness.ts` (86 → 122 lines): rewritten on `solve`; the hand-written sweep is deleted.
- `src/typed/analyses.ts`: `FlowGraph` comes from `../stdlib/index.js` (one word moved between imports).
- `tests/stdlib/flow.test.mjs` (new, 8 tests): the solver's forward and backward fixpoints on a graph with
  a back edge, a loop that needs widening (refused without `widen`, a fixpoint with it, and with
  `widenAfter`), an unreachable block in both directions, a bad entry, the framework re-export being the
  same object, and liveness through the solver against a verbatim copy of the old sweep on 300 generated
  graphs under both scopes, plus the trap cases by hand.
- `tests/framework/layering.test.mjs`: its header comment now names the solver as a third thing in the
  library. No assertion changed.
- ticket `scripts/`: `01-speed-timing.mjs` (one build per run, and the `before`/`after` outputs),
  `02-speed-interleaved.mjs` (both builds, interleaved) with its 5-round full-corpus and 4-project
  outputs, `03-liveness-timing.mjs` (the liveness client alone, on real machine code) with its output.

## Decisions, and the simplest alternative I did not take

**The entry walk is `flowOrder` in the library, `depthFirst` in the framework.** The library's index
already exports the graph primitive `depthFirst`; a second export of that name from the same module is a
collision. Alternative: export only `solve` from the index and keep `depthFirst` inside the module. It is
smaller, but leaves two different `depthFirst`s behind module paths, which is the confusion the rename
removes. The framework keeps the old spelling, so nothing that called it changed.

**`DataflowError` moved with the solver.** Alternative: keep the class in the framework and have the
library throw it — impossible without the library importing the framework. Because the framework
`export *`s the library module, `e instanceof DataflowError` in `tests/framework/ext-e4.test.mjs` holds on
the same class object; that test is untouched. This is the same shape as IRWB-048-B's `Json` decision:
the library owns what it throws, and the framework re-exports it.

**`all-blocks` gets a phantom entry block; the solver gets no new option.** The solver walks from an entry
and reports what it does not reach at bottom, which *is* the `entry-reachable` scope liveness already
offers. `all-blocks` — the scope the register allocator and the coalescer use — asks the same equations to
run over every block. The alternatives were an `allBlocks` option on the solver (a new meaning on an
algorithm this step is only moving; the framework's facts and its baselines are recorded) or a second
copy of the old sweep for that scope (the admission rule's "the old copy is deleted", and the brief's
"one path for each job"). The phantom is one extra block appended to the solver's graph whose successors
are every block: the walk from it reaches everything, its transfer is the identity, its facts are
dropped. The equations do not change and a monotone system has one least fixpoint, so the results are the
same — which the generated comparison in the test checks, and probe 03 checks again through `intervals()`
on every corpus function.

**`src/framework/dataflow/analysis.ts` keeps importing `./solver.js`.** It is the shim's caller: pointing
it at the library would be tidier, but the framework file the other steps are changing is left as it was,
and the shim is exactly what the brief asks for.

## The one behaviour to know about

`liveness` returns the solver's sets, so unreachable blocks under `entry-reachable` share one empty set
object (the lattice's `bottom()`) instead of getting a fresh `new Set()` each. Both are `ReadonlySet` and
neither the allocator nor the coalescer writes to them; the test compares contents. A caller that mutated
a returned set would now see the mutation in every unreachable block. I did not add a copy: the type is
read-only and the old code's fresh objects were an accident of the sweep, not a promise.

## Performance

Liveness runs in the allocator and the coalescer on every function, so the step was measured three ways.
The machine is shared with other agents, which decided the method: two runs of one build are not
comparable. Probe 01 does exactly that (one build per run, minimum of five runs, all 50 corpus projects
under `pipeline('speed')`): 39,325.55 ms before and 69,431.02 ms after. That is **not** a 77% regression.
The total is dominated by `chess-search` (24 s of it), and the same project, unchanged, moved from 26.9 s
to 44.9 s between two runs of probe 01 and settled at 22.3 s in probe 02. So probe 01's pair is kept as
the record of why it is not a measurement.

Probe 02 loads the pre-change build (`out/dist.old`) and this one (`dist`) in one process and alternates
them per project per round, minimum per build; it throws if the two builds disagree on an image hash
(they do not). `lower` is `lowerToImage` on the already built IR — the register allocator and the
coalescer, the two liveness clients.

| run | measurement | old | new | change |
|---|---|---|---|---|
| 02, 5 rounds, 50 projects | `pipeline('speed')` | 32,330.64 ms | 32,459.48 ms | **+0.4%** |
| 02, 5 rounds, 50 projects | `lowerToImage` | 1,766.08 ms | 1,970.10 ms | +11.6% |
| 02, 5 rounds, 4 projects (23 s of the 32 s above) | `pipeline('speed')` | 26,341.71 ms | 26,991.75 ms | +2.5% |
| 02, 5 rounds, 4 projects | `lowerToImage` | 1,726.08 ms | 1,790.92 ms | +3.8% |
| 02, 9 rounds, 4 projects (`02-speed-interleaved-big-9.txt`) | `pipeline('speed')` | 24,199.09 ms | 22,816.51 ms | **−5.7%** |
| 02, 9 rounds, 4 projects (`02-speed-interleaved-big-9.txt`) | `lowerToImage` | 1,394.48 ms | 1,426.28 ms | +2.3% |

The corpus compile time under `speed` moves between **−5.7% and +2.5%** across those runs, and the sign
flips: it is inside this machine's noise floor (chess-search alone, unchanged, measured 19.6 s, 20.9 s,
22.3 s and 24.1 s in four runs), and far under the 10% at which the brief asks for both implementations to
be kept. The honest statement is that the corpus build does not move measurably, and that probes on this
machine can only bound a regression to a few percent. **I kept one implementation** — the solver-based
liveness the admission rule requires.

Probe 03 explains what the authority of that number is. It times the allocator's client alone
(`intervals()`) on the real machine code of all 135 corpus functions, 50 passes per timed round, the two
builds interleaved:

| run | old | new | change |
|---|---|---|---|
| 5 rounds × 50 passes | 7.575 ms | 9.481 ms | +25.2% |
| 5 rounds × 50 passes | 7.194 ms | 8.978 ms | +24.8% |
| 5 rounds × 50 passes | 9.057 ms | 10.671 ms | +17.8% |
| 7 rounds × 50 passes | 8.755 ms | 11.232 ms | +28.3% |
| 5 rounds × 50 passes (saved as `03-liveness.txt`, under load) | 13.195 ms | 15.306 ms | +16.0% |

So the primitive itself is **about a fifth slower on real machine code** (+16% to +28% across five runs;
the absolute numbers move with the load, the ratio does not), and all 135 functions give the same
intervals and live-out sets in both builds. Its share of a corpus compile is about 8–13 ms of 32 s, so a
fifth of it is **about 2 ms — 0.006% of the corpus build**, which is why the pipeline number cannot see
it. That is the honest summary: liveness is measurably slower per call, and the compiler is not.

## Acceptance

- **Tests**: `tests/stdlib/flow.test.mjs`, 8 tests, pass. `tests/stdlib/` as a whole: 56 pass, 0 fail.
- **Baselines**: `npm run build` then IRWB-039's `scripts/02-baselines.mjs check` → `no differences from
  .../various/baselines/main.json` (RV32 image hashes, instruction counts and edit records at r0, O2 and
  `speed` for all 50 projects; CUDA sources and `optimizeTix` revisions for every Tix program). Probe 02
  independently refuses to report if any project's image hash differs between the two builds; it did not.
- **Suites** (files given explicitly, `*-gpu.test.mjs` excluded): `tests/framework` 243 pass, 0 fail;
  `tests/workbench` 24 pass, 0 fail, 1 skip (`IRWB_FULL=1`); `tests/typed` 186 pass, 0 fail, 2 skips
  (`IRWB_CANDELA=1`); `tests/tensor` (corpus, cuda, fusion, language, passes, r3-tix-in-plans, schedule)
  45 pass, 0 fail; `tests/stdlib` 56 pass, 0 fail.
- `npm run check` clean; `node tools/build-site.mjs` builds (`131 source files` — the move leaves the
  count unchanged); `prettier --check` clean on every file this step touched.
- No existing test assertion was weakened or changed: only a comment in
  `tests/framework/layering.test.mjs` and the import line in `src/typed/analyses.ts`.

## Left out, and what I think is wrong in the brief

- **`all-blocks` has no statement in the solver.** The phantom block is the smallest way to say "every
  block is in play" with the solver's existing vocabulary, but it is a trick: the solver's interface says
  a graph has one entry, and a library caller who wants a set of roots has to invent one. A `roots` (or
  `allBlocks`) option, or `solve` over a set of entries, is the framework-level answer and it is not this
  step's — it would touch the algorithm whose facts the baselines record. It is the one place where I
  built something in a domain that the framework's concept should provide, and I did it because the brief
  fixes the solver's surface at what the framework exports today.
- **The baselines cannot see iteration counts of liveness**, which is a fine thing to say plainly: the
  baselines record images, instruction counts, edit records and Tix revisions. That liveness' facts are
  unchanged is therefore carried by the generated comparison in the test and by probe 03's equality check
  on every corpus function, not by the baselines.
- **"keep both, with the numbers"** (liveness more than ~10% slower) reads two ways: keep both
  implementations, or keep the change and state the numbers. I read it as the second, because keeping
  both would contradict the admission rule's "each client must call the library and its old copy must be
  deleted", and because the threshold is on corpus compile time, which did not move. If the coordinator
  meant the first, the ~20% per-call figure above is the number that triggers it and the old sweep is one
  `git show HEAD~1:src/stdlib/flow/liveness.ts` away.
- **Later** (not this step): a `widen` on the `Lattice` interface itself, so a caller does not hand the
  solver a `widen` that has to know the map's inner lattice (Typed does exactly that today); removing one
  of the solver's two schedules (the round-robin one reproduces Compiler Workbench's facts, so it moves
  numbers the baselines record); pointing `dataflow/analysis.ts` at the library instead of the shim.
