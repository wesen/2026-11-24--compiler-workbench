---
Title: Diary
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
LastUpdated: 2026-11-27T22:48:04.381494247-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

IRWB-052, the phase 3 migration of IRWB-039: one pass runner for every pass. Base: the IRWB-051-C spike
(32a92a1) on v7-p2 (26bea81).

## Step 1. Read the spike; contracts as steps

- Read the spike's design and report, `steps.ts`, `transformation.ts`, `define-pass.ts`, the manager's
  transformation path and the strategy interpreter.
- Converted `checkInternal`, `invariantInternal`, `condition`, `beginTransformation`, the transaction's `verify`
  and `verifyTransformation` to generators (`checkFrom`, `invariantFrom`, `condition`, `beginFrom`, `verifySteps`,
  `verifyTransformationSteps`). The public asynchronous methods drive them with `driveAsync`;
  `verifyTransformationSync` is new. 15 `await`s became yields; `execute`, `settle`, `recordProof` and
  `evaluateObjective` keep theirs (7), because they are not on the pass runner's path.
- **Failure:** `verifySteps` as a generator method of the transaction object has the transaction as `this`; tsc
  reported 12 errors. Fixed with `const self = this` in `beginFrom`.
- **Cleanup rule:** `beginFrom` and `verifySteps` had `catch { fail(error) }` only. Added
  `finally { if (!begun/!prepared && !closed) rollback(...) }`, which is the branch a `return()` takes.

## Step 2. The passes module

- **Decision:** `Pass` is now an alias of `Transformation`. The pass view of the spike (`run`, `legal`,
  `preserves` on a transformation) is deleted. `definePass` stays as a constructor for the earlier spelling and
  returns a transformation (`asTransformation`); `applyPass` and `applyNativePassSync` are wrappers of 4 and 2
  statements. Why not removed: `src/tensor/schedule.ts` (outside this step's scope) builds its passes with
  `definePass` and applies them with `applyNativePassSync`; tests and tools call
  `applyPass` at 39 sites.
- **Decision:** the wrappers also accept a transformation with earlier fields laid over it (`{ ...pass, run }`),
  because eight test sites build variants that way. The earlier field wins.
- `runTransformation` delegates a contract to `manager.verifyTransformationSteps`. Its rejection cleanup moved
  from `catch` to `finally`; the `catch` only keeps the reason for the rollback message.
- **Failure:** first version of the wrappers added `options.contract` to the pass's own obligations. The test
  `F33: a candidate the contract rejects does not become a store head` applies Tix `inline` (which now carries the
  meaning gate) with a rejecting contract and no origin; the gate threw `needs inputs.origin`. `applyPass`'s
  `contract` always was *the* gate of the application, so the wrappers and the bridge replace the pass's `ensures`
  (`gatedBy`); `TransformationOptions.ensures` adds. The spike's "at most one contract" rule is unchanged.

## Step 3. The strategy interpreter as steps; `optimizeTix` as a plan

- `execute` became `executeSteps` (its 26 `await`s are yields), driven by `execute` and the new `executeSync`.
  `StrategyAlgorithm.steps` is optional; `passAlgorithm` and `analysisAlgorithm` provide it.
- **Decision:** `group` (parallel, fork, forEach) runs one worker inline (`yield*`) and several workers as
  `driveAsync` runs of the same worker generator. `executeSync` sets `maxConcurrency` to 1. Alternative: refuse
  the three node kinds under the synchronous driver; not chosen because a plan with a fork is a normal plan.
- **Failure:** two existing strategy tests failed (`parallel failure drains started siblings…`, `a parallel
  rejection cannot hide…`). `await acquire()` used to take a turn even with a free slot, so two workers both
  started before the first failed. As steps, `acquire` yielded nothing when free and the first worker failed
  before the second started. Fixed with a plain `yield undefined` in `acquire`: a turn under the asynchronous
  driver, nothing under the synchronous one.
- `optimizeTix`: a sequence of `attempt(apply(pass), apply(tix.keep), codes: contract-rejected)` under
  `executeSync`; the steps are read from the execution's records. `tixAlgorithm` is
  `passAlgorithm(pass, { contractInputs: () => ({ origin }) })`; its invariant and contract are deleted.
- Tix `split-sum` and every Typed pass (`typedPass`, `dfe`, `inline`) built with `transformation()`.

## Step 4. Suites, and what the synchronous driver could not run

- Framework 251/252: the spike's test asserted that the synchronous driver stops at a contract. Updated it to a
  contract whose condition is `async` (the restriction that remains).
- Tensor 40/45: `tests/tensor/passes.test.mjs` reads `pass.run`, which the deleted view provided. Changed two
  reads to `pass.prepare`.
- **Failure:** script 01 (`revisions`) stopped: `Pass typed.strength: a step answered asynchronously`. Typed's
  meaning check has an executor hook (`decide`), and `differential()` returned `runDifferentialAsync(...).then`
  whenever a hook exists, installed or not. Wrote the run as steps (`differentialSteps`) and added `drive` to
  `steps.ts`: run without waiting until the first promise, then continue asynchronously. The check now returns a
  value when no executor took the cases.
- Baselines: `no differences`.

## Step 5. Tests and measurements

- `tests/framework/one-runner.test.mjs`, 7 tests. My test plan for `executeSync` first fed an array to `inc`
  (`IR data must contain only finite numbers`), then I had the expected value wrong (11 for 13); both were errors
  in the test.
- `scripts/01-revisions-and-timings.mjs`: revisions (0 differences on 6 Tix programs and 53 Typed inputs; the
  synchronous driver recorded 6 contract executions, equal to the asynchronous driver's), and timings against a
  build of 26bea81 in the same process.
- `tools/audit-preservation.mjs` read `pass.preserves`; changed to `pass.obligations.preserves`.

## Review

Start with `src/framework/passes/transformation.ts` (the type, `asTransformation`, the runner, the wrappers), then
the manager's `beginFrom` / `verifySteps` and `strategy/interpreter.ts` `group` and `acquire`. Validate with
`node --test tests/framework/one-runner.test.mjs` and the baselines script.
