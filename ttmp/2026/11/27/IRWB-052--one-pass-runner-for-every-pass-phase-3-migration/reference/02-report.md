---
Title: Report
Ticket: IRWB-052
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T22:48:05.344289522-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: one pass runner for every pass

IRWB-052, the phase 3 migration of IRWB-039, on top of the IRWB-051-C spike. Diary: `reference/01-diary.md`.

## Result

There is one pass runner, `runTransformation` (`src/framework/passes/transformation.ts`, 204 lines), and every
Typed and Tix pass is a transformation that runs on it under either driver. The contract path and the strategy
interpreter are steps, so the synchronous driver records contract executions and runs plans. `optimizeTix` is a
plan under the synchronous driver. The baselines script prints `no differences`.

## What was built

1. **Contracts as steps** (`contracts/analysis-manager.ts`). `checkInternal`, `invariantInternal`, `condition`,
   `beginTransformation`, the transaction's `verify` and `verifyTransformation` are generators; 15 `await`s became
   yields (the brief estimated 13). The asynchronous methods drive them with `driveAsync`;
   `verifyTransformationSync` and `verifyTransformationSteps` are new. `execute`, `settle`, `recordProof` and
   `evaluateObjective` are unchanged: no pass application reaches them.
2. **Differential checks answer with a value when they can** (`contracts/differential.ts`, `steps.ts`). Typed's
   meaning check has an executor hook, and `differential()` returned a promise whenever a hook exists, so the
   synchronous driver could not run Typed's contract. The run is now steps, driven by a third driver, `drive`:
   it runs without waiting until the first promise and continues asynchronously from there. With no executor
   installed the check returns a value.
3. **A synchronous strategy driver** (`strategy/interpreter.ts`). `execute` is `executeSteps` (26 `await`s became
   yields), driven by `execute` and the new `executeSync`. `parallel`, `fork` and `forEach` run one worker inline
   and several workers as asynchronous runs of the same worker steps; `executeSync` fixes `maxConcurrency` at 1.
   An algorithm may provide `steps` beside `run`; `passAlgorithm` and `analysisAlgorithm` do.
4. **Every pass on the runner.** `typedPass`, Typed `dfe` and `inline`, and both Tix passes are built with
   `transformation()`. `Pass` is an alias of `Transformation`; the spike's pass view (`run`, `legal`, `preserves`
   on a transformation) is deleted. The restriction in `applyNativePassSync` is deleted with its body.
5. **`applyPass` and `applyNativePassSync` are wrappers**, of one statement and two, over the two drivers.
   `definePass` is a constructor that returns a transformation. They are kept and not removed because
   `src/tensor/schedule.ts`, which this step may not change, builds its passes with `definePass` and applies them
   with `applyNativePassSync`, and tests and tools call `applyPass` at 39 sites and `definePass` at 13. Typed's
   and the workbench's own code calls `applyTransformation`.
6. **One Tix meaning gate**: the obligation `tixMeaning` (`src/tensor/passes.ts`), which both Tix passes carry.
   The invariant and the contract that `tixAlgorithm` built are deleted; `tixAlgorithm` is `passAlgorithm` with
   the origin as the application's input.
7. **`optimizeTix` as a plan**: a sequence with one `attempt` per pass whose fallback keeps the program on
   `contract-rejected`, run with `executeSync`. Its `steps` are read from the execution's records.
8. **The cleanup rule.** The runner's rejection cleanup (roll back the deferred evidence, invalidate the
   candidate's analyses) is in `finally`; its `catch` only keeps the reason. The manager's `beginFrom` and
   `verifySteps` roll a transaction back in `finally` when it neither finished nor failed.

## Decisions, with the simplest alternative

- **The earlier spelling is read in one place, `asTransformation`.** `run` is `prepare`, `legal` is `eligible`,
  `preserves` and `contract` go under `obligations`, and an undeclared relation is `'exact'`. It also reads a
  transformation with earlier fields laid over it (`{ ...pass, run }`), which 8 test sites build. Simplest
  alternative: rewrite those sites and `schedule.ts`; the second is outside this step.
- **The earlier entry points name the gate; the runner's option adds.** `applyPass`'s `contract`,
  `applyNativePassSync`'s gate and the bridge's `contract` replace the pass's own `ensures` (`gatedBy`), as they
  always did. `TransformationOptions.ensures` adds to them. Simplest alternative: always add. It fails an existing
  test (F33) that applies Tix `inline` with a rejecting contract and no origin.
- **`group` with one worker runs inline.** Simplest alternative: refuse `parallel`, `fork` and `forEach` under the
  synchronous driver. Not chosen: the worker loop is the same code either way, and the test compares records and
  events of `executeSync` with `execute` at `maxConcurrency: 1`.
- **`acquire` yields a plain value when a slot is free.** Without it two existing strategy tests fail: the first
  worker failed before the second started, where both used to start. The yield is a turn under the asynchronous
  driver and nothing under the synchronous one.

## Measurements

`scripts/01-revisions-and-timings.mjs` (outputs beside it). "Before" is a build of the base commit 26bea81
(v7-p2) loaded into the same process, variants interleaved. The machine was loaded, so figures are CPU
milliseconds per application: median (min..max) of 9 batch means (7 for Typed).

| Case | Before | After, sync driver | After, async driver |
|---|---|---|---|
| Tix `inline` on attention, trivial gate | 1.66 (0.93..1.99) | 1.44 (1.15..2.02) | 1.50 (0.94..2.72) |
| Tix `inline` on attention, meaning gate | 14.8 (9.9..18.9) | 14.1 (10.4..20.6) | 14.0 (9.9..30.7) |
| `optimizeTix(['inline'])` on attention | 16.9 (10.4..19.3), a loop | 16.1 (10.3..20.5), a plan | |
| Typed `strength` on `strength` r0, new manager, contract, claims audited | 21.3 (17.2..31.3) | 20.5 (17.3..28.4) | 20.3 (16.8..31.4) |
| Typed `strength` on `strength` r0, facts cached, no gate | 11.2 (7.1..17.9) | 10.6 (6.7..12.4) | 9.7 (8.5..24.0) |
| Typed `strength` on `sha-chacha` r0, new manager, contract, claims audited | 269 (200..424) | 248 (193..416) | 235 (210..491) |
| Typed `strength` on `sha-chacha` r0, facts cached, no gate | 170 (166..211) | 159 (146..314) | 159 (139..237) |

"Before" is `applyNativePassSync` for Tix and `applyPass` for Typed. The intervals overlap in every row, so the
measurement shows no difference in either direction. The plan around `optimizeTix` is not visible beside the
meaning gate.

Revisions: Tix `inline` on 6 programs (2 changed) and Typed `strength` on 53 inputs (6 changed) give 0
differences between the wrappers and the two drivers. Under the synchronous driver the 6 changed Typed
applications recorded 6 contract executions, equal to the asynchronous driver's in status and checks.

## Tests

`tests/framework/one-runner.test.mjs`, 7 tests:

- Four rejected applications (contract rejects; preservation fails after an accepted contract; a check rejects
  after an accepted contract; an undeclared write) leave equal manager snapshots and stores under both drivers.
- An application the synchronous driver abandons at an asynchronous contract condition, or at an asynchronous
  preservation check, leaves the execution `rolled-back`, the head unmoved and no valid fact or analysis of the
  candidate; the same manager then accepts the asynchronous application.
- The synchronous driver records an accepted contract execution with its four checks and its facts; the
  snapshot equals the asynchronous driver's. The same for Typed `strength` with the optimization contract.
- `optimizeTix` gives the revisions and steps of a pass-by-pass loop on every corpus program for five pass
  lists, and reports a rejected step's counterexample.
- `executeSync` gives the value, records and events of `execute` on a plan with sequence, attempt, chooseBest,
  fork, forEach and parallel, and stops at an asynchronous algorithm.
- Every Typed and Tix pass is a transformation with a declared relation and none of the earlier fields.

## Existing tests and tools changed

- `tests/framework/transformation-drivers.test.mjs`: one case asserted that the synchronous driver stops at a
  contract, the restriction this step deletes. It now uses a contract whose condition is `async`.
- `tests/tensor/passes.test.mjs`: two reads of `pass.run` became `pass.prepare` (the deleted pass view).
- `tools/audit-preservation.mjs`: `pass.preserves` became `pass.obligations.preserves` (the same view).

No other existing test changed.

## Acceptance

- `one-runner.test.mjs` 7/7; `transformation-drivers.test.mjs` 9/9.
- Baselines: `no differences`.
- Suites: framework 259/259; stdlib 48/48; workbench 24 pass, 1 skipped; typed 186 pass, 2 skipped; tensor
  without `*-gpu` 45/45.
- `npm run check` clean; `node tools/build-site.mjs` builds; Prettier clean on the changed files that were
  formatted before.

## Behaviour that differs from before

- `eligible` (the earlier `legal`) runs after `needs`, as the spike designed it. An ineligible application
  computes its needs first.
- A result carries `relation` and `obligations`, and `contract` is the check's verdict when no contract ran.
- `applyNativePassSync` runs an edit-style pass, where it threw `Expected a synchronous native result`. An
  asynchronous `prepare` gives the driver's `Error`, not a `PassError`.
- A failure in `optimizeTix` that is not a rejection is thrown as `StrategyExecutionError` with the original
  message, not as the original error object.
- Asynchronous callers of the contract path take fewer microtask turns; values, records and events are the same.

## Domain machinery that belongs in the framework

- `tix.keep` (`src/tensor/index.ts`) and `typed.keep` (`src/typed/strategy.ts`, existing) are the same identity
  algorithm for an `attempt` fallback. The strategy layer should provide it, or `attempt` should take no fallback.
- `optimizeTix` and `pipelinePlan` build the same plan shape (a sequence of tolerated passes). A builder in the
  bridge would serve both.

## Left out, believed wrong, or for the coordinator

- **`steps.ts` is in `contracts/` and the strategy interpreter now imports it.** That is the strategy layer's
  first import from another layer besides `core`. The file imports nothing and would sit better in `core`, but
  the layering test allows `strategy` only `core/data.js` and `core/types.js`, so moving it means changing that
  test's list. I left it where the spike put it.
- **`definePass` gives the schedule passes relation `'exact'`** because `schedule.ts` does not declare one and
  is outside this step. Nothing reads it there: their gate comes from the caller.
- **A synchronous driver with Typed's worker pool installed is refused**, since the pool answers with a promise.
- **An abandoned plan** leaves its records `running`; the execution is never returned, so only an `onEvent`
  observer sees it.
- **The manager's `execute`** (a contract with a `run` body) is asynchronous only; no pass uses it.

## Later

- Outcomes as values; `decide`, plans and derivations as data; Tix to CUDA as a cross-IR transformation; a
  tolerance bound as data; the scheduling rule in `src/tensor/strategy.ts` as a plan (phase 4).
- Removing `definePass`, `applyPass` and `applyNativePassSync` once `schedule.ts` and the test sites are moved.
