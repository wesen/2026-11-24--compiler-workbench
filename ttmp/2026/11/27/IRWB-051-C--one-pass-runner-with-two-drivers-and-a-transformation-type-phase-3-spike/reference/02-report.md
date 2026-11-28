---
Title: Report
Ticket: IRWB-051-C
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/analysis-manager.ts
      Note: analyseSync and preserveSync on analyse's own generator
    - Path: repo://src/framework/contracts/steps.ts
      Note: Steps, wait, driveSync, driveAsync
    - Path: repo://src/framework/passes/transformation.ts
      Note: the transformation type and the runner
    - Path: repo://tests/framework/transformation-drivers.test.mjs
      Note: the spike's evidence
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:22:28.112855945-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: one pass runner with two drivers, and a transformation type

IRWB-051-C, a design spike for phase 3 of IRWB-039. A prototype to judge, not to merge. Design:
`design-doc/01-one-runner-two-drivers-design.md`. Diary: `reference/01-diary.md`.

## Recommendation

**One runner with two drivers.** The measurement that decides it:

- `analyseSync` is **7 lines and duplicates 0 lines of `analyse`**. Both drive one generator, `analyseFrom`
  (106 lines; the `async` function it replaces was 103). The cache test, the dependency replay, the record and the
  events exist once. The same holds for `preserveSync` (12 lines) and `preserve`.
- It costs the existing asynchronous callers nothing measurable: `analyse` before and after the change, and a pass
  application under either driver against today's runners, differ by less than the run-to-run spread (tables
  below).
- Both ported passes give identical revisions under both drivers and under today's runners on the whole corpus,
  and the baselines script prints `no differences`.

The alternative, one specification with two thin runners, does not avoid the manager question: a synchronous runner
that honours `needs` and `preserves` needs `analyseSync` and `preserveSync` anyway. It would only add a second copy
of the runner (today `applyPass` is 154 lines and `applyNativePassSync` 42, and the short one has no needs, no
preservation, no contract, no edit path and no store).

## How it works

- **One effect.** A function that may have to wait is a generator that yields the value it would `await`
  (`src/framework/contracts/steps.ts`, 59 lines). `driveAsync` awaits each yielded value; `driveSync` sends a plain
  value straight back and refuses a promise. The drivers know nothing about passes or analyses.
- **The manager's functions are such generators.** `analyseInternal` and `preserveInternal` became `analyseFrom`
  and `preserveFrom`; three statements changed in each. `analyse` = `driveAsync(...)`, `analyseSync` =
  `driveSync(...)`.
- **The runner delegates with `yield*`** (`runTransformation` in `src/framework/passes/transformation.ts`):
  needs, requires, eligible, prepare, unchanged?, writes, ensures, preserves, publish. Candidate construction, the
  write check, F33's publication point and the rejection cleanup are `applyPass`'s own helpers (exported, not
  copied).
- **The transformation type** declares `relation` (`'exact' | 'tolerance'`), `eligible` (today's `legal`, and it
  sees facts), `prepare` (today's `run`) and `obligations { requires, ensures, preserves }`. An `ensures` is a
  check function or a v6 contract. The meaning gate is an obligation, so it travels with the pass.
- **"Pure" is operational.** The synchronous driver answers any analysis whose `run` returns a value and leaves no
  request pending; otherwise it throws `…: a step answered asynchronously; use the asynchronous driver` and records
  nothing. All Typed analyses qualify.

## Measurements

All on this worktree at the last commit, Node 24.18. Other agents loaded the machine (load average 20 to 54), so
timings are CPU time of the process, variants interleaved in one process, median and min..max of batch means.

### 1. Revisions

`node <ticket>/scripts/04-revisions-and-timings.mjs revisions` (output: `scripts/04-revisions.out.txt`)

| Pass | Inputs | Changed | Differences |
|---|---|---|---|
| Tix `inline`: `applyNativePassSync`, sync driver, async driver, `optimizeTix` | 6 programs of `corpus/tensor` | 2 (attention, mlp) | 0 |
| Typed `strength`: `applyPass`, async driver, sync driver | 53: r0 of every corpus project, and every input the O2 pipeline gave `strength` | 6 (chess-search, sha-chacha, strength; at r0 and inside O2) | 0 |

Compared for Typed: changed, revision, edit count, and the preservation outcome of each of the three claims. The
test additionally compares the correspondence entries, the change counts, the edit report and the manager's
analysis records (ids of computed records are fingerprints, and they are equal).

`node ttmp/2026/11/27/IRWB-039--*/scripts/02-baselines.mjs check` → `no differences`.

### 2. Milliseconds per application

`node <ticket>/scripts/04-revisions-and-timings.mjs timings` (output: `scripts/04-timings.out.txt`)

| Case | Today | Sync driver | Async driver |
|---|---|---|---|
| Tix inline on attention, trivial gate | 1.87 (1.47..2.55) | 1.78 (1.29..2.28) | 1.78 (1.33..3.24) |
| Tix inline on attention, with the meaning gate | 21.1 (20.0..32.6) | 20.9 (20.1..24.2) | 21.6 (18.9..24.0) |
| Typed strength on `strength` r0, new manager, meaning check, claims audited | 44.8 (40.8..46.3) | 42.5 (39.6..50.7) | 42.4 (38.9..47.8) |
| Typed strength on `strength` r0, facts cached, no gate | 15.7 (13.8..17.7) | 18.4 (13.4..18.9) | 17.4 (13.1..26.5) |
| Typed strength on `sha-chacha` r0, new manager, meaning check, claims audited | 508 (465..581) | 438 (433..606) | 463 (439..537) |
| Typed strength on `sha-chacha` r0, facts cached, no gate | 260 (255..288) | 321 (256..428) | 260 (252..349) |

"Today" is `applyNativePassSync` for Tix and `applyPass` for Typed. Every row's three intervals overlap, so no
difference is shown in either direction. The brief's 0.6 ms for Tix inline is not reproduced under this load by
any variant, today's runner included (the baselines script printed `0.562 -> 6.274 ms` for today's runner during
one run). One `yield*` round trip costs about 0.2 µs (probe 01); an application makes 2 (Tix inline) to about a dozen (Typed
`strength` with three audited claims).

### 3. `analyse`, before and after

`node <ticket>/scripts/03-bench-analyse.mjs 5`, and the same with `DIST=.base-build/dist` for a build of the base
commit 3ba86fc (the script's header has the commands). Two alternating runs each; output:
`scripts/03-bench-analyse.out.txt`. On `sha-chacha` r0, ms CPU:

| | Base `analyse` | Prototype `analyse` | Prototype `analyseSync` |
|---|---|---|---|
| `typed.cfg`, miss | 1.01, 0.94 | 1.02, 0.93 | 1.01, 0.88 |
| `typed.cfg`, hit | 0.098, 0.080 | 0.065, 0.056 | 0.062, 0.054 |
| `typed.ranges`, miss | 149, 138 | 146, 141 | 143, 141 |
| `typed.ranges`, hit | 0.075, 0.073 | 0.074, 0.078 | 0.079, 0.063 |

(two medians per cell, one per run; the batch spreads overlap in every row.)

### 4. Size

| | Lines |
|---|---|
| `analyseSync` | 7 |
| of which duplicated from `analyse` | 0 |
| `analyseFrom` (shared) / `analyseInternal` before | 106 / 103 |
| `preserveSync` | 12 |
| `preserveFrom` (shared) / `preserveInternal` before | 123 / 118 |
| `analysis-manager.ts` diff | +90 −17 |
| `steps.ts` (types, `wait`, both drivers) | 59 |
| `runTransformation` | 205 |
| `applyPass` + `applyNativePassSync` today (what it replaces after migration) | 154 + 42 |
| `transformation.ts` in all (types, constructor, runner, entry points) | 398 |

## What the tests show

`tests/framework/transformation-drivers.test.mjs`, 9 tests:

- Tix inline: same revisions from both drivers, `applyNativePassSync` and `optimizeTix` on `corpus/tensor`; the gate's
  evidence is in the result; a wrong `prepare` with inline's obligations is `contractRejected` under both drivers.
- Typed strength: same revision, preservation outcomes, correspondence, report and analysis records from both
  drivers and `applyPass` at r0 of every corpus project; both drivers reproduce the revision O2 made.
- `analyseSync` and `analyse` return equal records, each reuses what the other computed (`analysis.reused`), and
  invalidation is seen by both.
- `analyseSync` refuses an `async` analysis, one that awaits a nested analysis, and one that leaves a request
  pending; nothing is recorded.
- The synchronous driver stops at an asynchronous need, an asynchronous `prepare` and a contract; the store head
  does not move and no execution is accepted; the asynchronous driver runs all three.
- `requires` and `eligible` refuse before `prepare`; `eligible` reads a fact; a true preservation claim is
  confirmed and a false one is `preserveViolated` under both drivers; a contract's deferred evidence is rolled back
  when a later claim fails.
- An edit-style `prepare` gives the native one's revision under both drivers; `applyPass` accepts a transformation.

## Limits of this prototype

1. **Contracts are asynchronous-only.** `verifyTransformation` always returns a promise, so the synchronous driver
   refuses a contract obligation. For Typed `strength` under the synchronous driver the tests and the script pass
   the meaning check as a function (`runDifferential` on the contract's own specification). The verdict is the
   same, but no contract execution is recorded in the manager. Closing this is the same change again:
   `beginTransformation`, `verify`, `condition`, `checkInternal` as steps (13 `await`s).
2. **Microtask turns.** Existing asynchronous callers get the same values, records and events, in fewer turns
   (nothing is awaited when nothing is pending). The framework, Typed, tensor and workbench suites and the
   baselines pass; code that depended on the exact number of turns would notice.
3. **A convention for whoever writes steps.** The synchronous driver abandons a run with `return()`, which runs
   `finally` blocks and skips `catch` blocks (probe 02). Cleanup that must also happen then belongs in `finally`.
   The runner follows this; the type system does not enforce it.
4. **Yield answers are untyped** (`Generator<unknown, T, any>`). `wait()` restores the type at each use; a bare
   `yield` does not.
5. **The pass view.** A transformation also carries `run`, `legal` and `preserves` so today's runners and callers
   accept it. Its `legal` gives `eligible` no facts. It exists for the migration only.
6. **`relation` is read by check obligations only.** A contract obligation ignores it (Typed's contract is exact
   by construction). The `'tolerance'` branch is not exercised by a ported pass.
7. **Thin corpus for inline.** It changes 2 of 6 Tix programs.

## Domain machinery that belongs in the framework

- `typedMeaning` in the test and in script 04 wraps a differential specification as a synchronous check. It
  repeats what `differential()` does inside its invariant (`contracts/differential.ts`, `result(...)`). It is there
  because of limit 1 and goes away with it.
- `tixMeaning` (`src/tensor/passes.ts`, new) and the invariant plus contract that `tixAlgorithm` builds
  (`src/tensor/index.ts`, existing) are two encodings of one gate. The migration should keep the obligation and
  have the bridge run transformations.

## For the implementer of the migration

1. Keep `steps.ts` and the manager change as they are.
2. Convert the contract path to steps (limit 1). Then the synchronous driver runs Typed's contract and the function
   wrapper is deleted.
3. Move every pass to `transformation()`; `applyPass` becomes `applyTransformation`, `applyNativePassSync` and its
   restriction are deleted, the pass view goes.
4. Convert `strategy/interpreter.ts` to steps (27 `await`s) so `optimizeTix` and the scheduling rule in
   `src/tensor/strategy.ts` run a plan under the synchronous driver.

## Left out, and why

- Steps for contracts and for the strategy interpreter: the brief's question is about analyses; each is sized above.
- Outcomes as values, `decide` and plans as data, derivations, cross-IR ports, deferred and batched obligations, a
  tolerance bound as data: later phases of the design doc; none is needed to answer the question.
- Changing `optimizeTix` or any pipeline to call the new drivers: the brief asks that existing callers keep
  working, and the test makes the comparison instead.

## Remarks on the brief

- It suggests `licm` or `bce` as the Typed pass "that declares `needs` and `preserves`". Both declare
  `preserves: []`. I ported `strength` (needs `typed.ranges`; preserves cfg, dominators, loops), which exercises
  `preserveSync`.
- It lists publication among the effects a runner yields. Publication (`store.publish` with the acceptance) is
  synchronous today, so it is an ordinary call in the runner, not a step.

## Acceptance

- `node --test tests/framework/transformation-drivers.test.mjs`: 9 pass.
- Baselines: `no differences`.
- Suites: framework 252/252; stdlib 7/7; workbench 24 pass, 1 skipped (needs `IRWB_FULL=1`); tensor (without
  `*-gpu`) 45/45; typed 186 pass, 2 skipped (need `IRWB_CANDELA=1`). No existing test was changed.
- `npm run check` clean; `node tools/build-site.mjs` builds. Prettier clean on every changed or new `src` file.
