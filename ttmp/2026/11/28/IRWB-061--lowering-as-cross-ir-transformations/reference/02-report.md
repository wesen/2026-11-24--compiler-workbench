---
Title: Report
Ticket: IRWB-061
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:50:32.752534765-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: lowering as cross-IR transformations (IRWB-061, phase 4 item 4.2)

## Result

Both lowerings are applications of a transformation on the one runner. `typed.lower-rv32` maps `typed.blocks` to
`rv32.image` with `rv32.image-agrees` as its `ensures`; `tensor.lower-cuda` maps `tensor.tix` to
`tensor.cuda-source` with the `tensor.cuda-meaning` GPU check as its `ensures`. `lowerToImage` and `cudaSource()`
are the same transformations applied with their check pending: recorded as owed in the result, not run. Image
bytes, instruction counts and CUDA source are unchanged (the baselines print `no differences`).

The asynchronous `manager.execute` is no longer on any lowering's path, and nothing in `src/typed` or `src/tensor`
calls it.

## What was built

| Piece | Where | What it is |
|---|---|---|
| the cross form | `src/framework/passes/transformation.ts` | `transformation({ from, to, ... })` returns a `CrossTransformation<In, Out, N, P>`; `runTransformation`, `applyTransformation` and `applyTransformationSync` take either form |
| the cross candidate | `src/framework/passes/define-pass.ts` | `prepareCross`: wrap the output with `to.adapter`; complete the producer's entries (or derivation) over both projections |
| pending | `TransformationOptions.pending` | no `ensures` runs; each is recorded with `status: 'pending'`; nothing is published; a store is refused |
| contract ports | `CrossSpec.bind` | names the ports of a contract among `ensures`; default `input` / `output` |
| `typed.lower-rv32` | `src/typed/backend/compile.ts`, `run.ts`, `image.ts` | `imageLowering`, `loweringContract`, `coverEntries`, `lowerImageChecked`; `lowerToImage` keeps its signature |
| `tensor.lower-cuda` | `src/tensor/cuda-contract.ts`, `index.ts` | the transformation, `cudaAdapter`, the composed correspondence, `lowerTixCuda`; `runTixCuda` passes the manifest |

How the runner treats the two forms is the table in the design note
(`design-doc/01-design-note-cross-ir-transformations-on-the-one-runner.md`); the code follows it.

## The guide's open questions

**8.1 Which type carries the lowering.** The pass-layer transformation, extended to a cross form. The
contract-layer definition stays what every pass already uses it for: the contract an `ensures` names. Running the
contract-layer definition instead would have kept `execute`'s limits: asynchronous only, no publication step, and a
different type for passes and lowerings.

**8.2 What `lowerToImage` becomes.** A call to the transformation with the check pending: one path. It costs
nothing measurable (below).

## Measurements

| Question | Script | Result |
|---|---|---|
| Does composition reproduce `kernelCorrespondence`? | `scripts/01-compose-probe.mjs` | 24 of 24 lowerings (6 programs, every function, as written and after `inline` + `split-sum`, fused and unfused) |
| Does the runner path give the same image and correspondence? | `scripts/02-typed-lowering-cost.mjs` | 100 of 100 (50 projects, r0 and O2): same image revision, same canonical correspondence |
| What does `lowerToImage` cost on the runner? | script 02 | 2,000 ms against 2,067 ms for the earlier body over the 100 lowerings (ratio 0.97, best of 5, interleaved): no measurable cost |
| What do facts through a fresh manager cost? | script 02 | 3,321 ms for the same 100 (one run): about 1.6 times. So facts are `needs` only when the caller has a manager |
| What does `cudaSource()` cost on the runner? | `scripts/03-cuda-source-cost.mjs` | 4.7 ms per lowering warm, against 0.29 ms for the earlier body, which memoizes the schedule; the first 12 calls take 112 ms together. Every caller is a test, the baselines, or precedes a remote compile, so no memo was added |

## Acceptance

RESULTS_PLACEHOLDER

## An existing test that changed

`tests/tensor/fusion.test.mjs`, "the lowering records which statements each kernel computes, and fused and unfused
share their cases". It read two things from the manager's correspondence record that `kernelCorrespondence` used to
put there:

- `evidence.gated`, the gate flag per kernel. The record is now the runner's, whose evidence is the IR layer's.
  The test reads the same flags from the kernels of the recorded output (`execution.outputs.subject.value.kernels`).
- `entities` in manifest order. The IR layer's correspondence is canonical (ids and entries sorted). The test
  compares the same entries after sorting both sides.

Neither assertion lost content; both changed where or in which order they read it.

## Machinery in a domain, and what the framework lacks

1. **A second scheduling registry (`cuda-contract.ts`, `schedule`).** `scheduleFunction` (`strategy.ts`) runs
   `schedulePlan` and drops the pass results, so the lowering runs the same plan on a registry of its own whose
   pass algorithms report their correspondences (`onResult`). It duplicates `scheduleRegistry`'s construction. The
   fix is three lines in `strategy.ts` (`Scheduled` keeps the results); `strategy.ts` is outside this lane's scope.
2. **Two entity lists per IR.** `IRType.entities` (contract layer) and the adapter's projection disagree for Tix
   (statements against functions, parameters and statements). The runner restricts the record it hands a contract
   to the port types' lists (`semanticCorrespondence`'s `universe`). The framework should have one list per IR, or
   state the restriction as an operation of `ir/correspondence.ts` (lane F41's file now). Its second use: any
   contract-checked pass on an IR whose two lists differ.
3. **`manifestEntries` beside `kernelCorrespondence`.** A unit the caller supplies has no chain to compose, so its
   correspondence is what its manifest claims; that is the mapping `kernelCorrespondence` states in the contract
   layer's shape. `kernelCorrespondence` is no longer called from `src/`; it is kept as the oracle the tests
   compare against.
4. **No coverage on the cross form.** Coverage is declared where it was: on a contract's correspondence requirement
   (checked by the manager) or on a derivation result. A third implementation of the five policies in the runner
   would have been the duplication F41 is removing.

## Left out, and where I think the brief is off

- **`emittedKernels` stays.** `runTixCuda` passes the manifest, so the lowering no longer needs the source-hash
  table; the table itself is in `cuda-source.ts` (lane 4.8's file), `tests/tensor/plans.test.mjs` asserts on it,
  and `runCudaBatch` still falls back to it for a caller that holds only source text
  (`tests/tensor/terms-gpu.test.mjs:85`). `cuda-runtime.ts` already took `kernels`, so it is unchanged.
- **The GPU suite was not run** (the brief forbids it). The checked Tix path is exercised with a stand-in engine;
  `runTixCuda` has no injection point, so its manifest argument is covered only by the type checker here.
- **The workbench has no caller of the checked lowering.** The brief says `rv32.image-agrees` "runs only in tests
  and workbench views"; in `src/` nothing called it. `lowerImageChecked` exists and is tested; `tools/candela-image.mjs`
  still calls `checkInvariant` directly.
- **Contract version.** The contract `tensor.lower-cuda` is version 3 (its `run` body is gone); the differential
  `tensor.cuda-meaning` is unchanged at version 2, so recorded verdicts keyed by it are still valid.

## Later

- `passAlgorithm` for a cross transformation, so a lowering can be a node of a strategy plan.
- The initial schedule and the emission as their own cross transformations, with the scheduling plan between them.
- `scheduleFunction` returning its pass results (item 1 above).
- One entity list per IR (item 2).
- A declared coverage on the cross form, once F41's one coverage check exists.
- A memo for `lowerTixCuda` by input revision, function and `fuse`, if a caller needs it.

## Review

Read `runTransformation` with the design note's table beside it, then the three new test files. The two places I
would look at twice: `pending` on a same-IR pass also skips its preservation claims (no caller uses it), and the
restricted record keeps an entry whose target side became empty.
