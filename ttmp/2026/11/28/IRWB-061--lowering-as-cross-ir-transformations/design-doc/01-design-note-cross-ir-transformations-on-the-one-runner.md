---
Title: 'Design note: cross-IR transformations on the one runner'
Ticket: IRWB-061
Status: active
Topics:
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-28T01:50:30.903253686-05:00
WhatFor: ""
WhenToUse: ""
---

# Design note: cross-IR transformations on the one runner

Written before the code (IRWB-061, phase 4 item 4.2). It describes only what this session builds.

## Supported input

- A transformation from one IR to another whose `prepare` is a function of the input artifact, its declared facts
  and its parameters, and which returns one output value. The two clients: `typed.blocks` to `rv32.image`, and
  `tensor.tix` to `tensor.cuda-source`.
- Same-IR passes are untouched: their type, constructor call sites, runner path and results stay as they are.

## What is built

1. **The cross form of a transformation.** `transformation({ from, to, ... })` returns a
   `CrossTransformation<In, Out, N, P>`; `transformation({ ir, adapter, writes, ... })` returns today's
   `Transformation<S, N, P>`. One constructor, one runner (`runTransformation`), the same two drivers.
2. **`typed.lower-rv32`** (`src/typed/backend/compile.ts`): `typed.blocks` to `rv32.image`, relation `exact`,
   `ensures` a contract whose one condition is `rv32.image-agrees`.
3. **`tensor.lower-cuda`** on the runner (`src/tensor/cuda-contract.ts`), with the `tensor.cuda-meaning`
   differential as before, under the asynchronous driver.
4. **A pending application.** `options.pending = { reason }` runs a transformation without its `ensures`, records
   each of them as pending in the result, and publishes nothing. `lowerToImage` and `cudaSource()` are such
   applications of the same transformation the checked paths use.

## The runner, step by step

| Runner step | Same IR (unchanged) | Cross IR |
|---|---|---|
| input view | `openIR(before, adapter)` | `openIR(before, from.adapter)` |
| `prepare` context | facts, records, params, `edit` | the same without `edit` (an edit is an operation on one IR) |
| candidate | edits, or a native value | `{ output, outputId }`, wrapped with `createIRArtifact(to.adapter, outputId, output)` |
| correspondence | a diff, entries or a derivation | entries or a derivation, required; completed over both projections' entity lists by `makeCorrespondence` / `correspondenceFromDerivation`, which also check membership |
| unchanged? | same revision and no changes | not asked: the output is another kind |
| `writes` | enforced | not declared |
| `ensures` | check or contract | the same; a contract's ports are named by the transformation's `bind` |
| `preserves` | transfer or recompute | not declared: an analysis of one IR says nothing about another |
| publication | `store.publish(after, { base: before })` | `store.publish(after)` opens the output lineage, or advances it from its current head; the contract's acceptance commits in the same window |

Outputs of a cross application: the result has `before: Artifact<In>`, `artifact: Artifact<Out>`, the
correspondence, the derivation if one was given, the obligations' evidence, and no change set.

## Decisions

**D1. Which type carries a lowering.** The pass-layer transformation, extended. The simplest alternative is to
keep the contract-layer `TransformationDefinition` and call `manager.execute`: it already has named ports. It
falls short in three ways: `execute` is asynchronous only, so `cudaSource()` and `lowerToImage` could not use it;
it has no publication step (F33 lives in the runner); and passes would keep a different type from lowerings. The
contract-layer definition stays what it is for every pass today: the thing an `ensures` names.

**D2. One type or two.** `Transformation<S, N, P>` keeps its three parameters and its fields; the cross form is a
second type with `from` and `to` in place of `ir`, `adapter`, `writes` and `preserves`. The simplest alternative,
one type with `Out = In` defaulted and optional `writes`, would make `writes` optional for every pass, which
weakens a check that exists today. The runner is one generator with branches at the rows of the table.

**D3. Binding a contract's ports.** A cross transformation may declare
`bind(ctx) => { inputs, outputs }`; the default is today's `{ input: before, ...inputs }` and
`{ output: candidate }`. The simpler alternative, two port names (`ports: { input, output }`), cannot give
`tensor.cuda-meaning` its `fn` port, which is a parameter of the application.

**D4. The universe of a correspondence handed to a contract.** The runner's correspondence is over the adapters'
projections, so that it composes with pass correspondences. A contract-layer IR type may declare a smaller
`entities` list (`TixIR`: statements only; the adapter also lists functions and parameters), and the manager
rejects a correspondence whose universe differs from it. For a cross application the runner therefore restricts
the record it hands to a contract to the port types' declared entities. The alternative, building the
correspondence over `ir.entities`, would break composition with the schedule passes. That one IR has two entity
lists is the framework's wart; see the report.

**D5. Pending.** K1 lists `pending` among the outcomes of a transformation. A pending application runs no
`ensures`, commits no evidence and refuses a store (F33: nothing about a candidate is visible until every
obligation has passed). The simplest alternative is what exists: a second function that builds the output outside
the runner. That is the bypass the brief removes.

**D6. `lowerToImage`.** It becomes a pending application of `typed.lower-rv32` (one path), keeping its signature.
Its cost over today's function is measured (script 02) and reported.

**D7. The Tix correspondence.** `prepare` composes four correspondences with `composeCorrespondence`: statements
to the initial schedule's kernels, the fuse application, the loops application, and schedule kernels to CUDA
kernels. Probe 01 shows the composed mapping equals `kernelCorrespondence`'s on 24 of 24 corpus cases (six
programs, every function, original and after `inline` + `split-sum`, fused and unfused). The schedule passes'
correspondences are taken from the runner's results by running `schedulePlan` on a registry whose pass algorithms
report them (`onResult`); `strategy.ts` is not in this lane's scope, so `scheduleFunction` is not changed.

**D8. Facts of the Typed lowering.** Liveness and ranges are declared as `needs` when an analysis manager is
given, and computed by `compileImage` as today otherwise. Decided by measurement (script 02).

## Errors

- A cross `prepare` that returns neither correspondence entries nor a derivation: `PassError('badResult')` in the
  runner, "a cross-IR result needs correspondence entries or a derivation".
- A pending application given a store: `PassError('badResult')`, "a pending application publishes nothing".
- A cross specification that declares `writes` or `preserves`: an `Error` from `transformation()`.

## Left out

- A coverage policy declared on the cross form itself: coverage stays where it is declared today (a contract's
  correspondence requirement, or a derivation result), because the one coverage check is lane F41's.
- Removing `emittedKernels`: it lives in `cuda-source.ts`, which lane 4.8 owns. `runTixCuda` passes the manifest.

## Later

- `passAlgorithm` for a cross transformation, so a lowering can be a node of a strategy plan.
- The initial schedule and the emission as their own cross transformations, with the scheduling plan between them.
- `scheduleFunction` returning its pass results, so the lowering needs no second registry.
- One entity list per IR (D4).
