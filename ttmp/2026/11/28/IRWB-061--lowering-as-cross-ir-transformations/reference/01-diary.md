---
Title: Diary
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
LastUpdated: 2026-11-28T01:50:29.207510619-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: read the brief, the guide and the code; baseline

I read the brief, the intern guide (sections 1 to 2.9, 4.2 to 4.4, 5.2, 5.5, 6 to 8), R3's K1 panel and the
"Cross-IR transformations" migration step, then the runner, the two lowerings and their callers.

### Prompt Context

> Your task: lowering as cross-IR transformations (phase 4, item 4.2). [...] 1. `Transformation<In, Out>`:
> generalize the transformation type and the runner to an input IR and an output IR, with today's same-IR passes as
> the special case (no change for them). [...] 2. Typed lowering on the runner: `lowerToImage` becomes a
> transformation from `typed.blocks` to `rv32.image` with relation `exact`, `rv32.image-agrees` as its `ensures`,
> and the image correspondence as its declared output; the callers use it. 3. Tix lowering on the runner:
> `tensor.lower-cuda` runs on the runner (asynchronous driver [...]), and `cudaSource()` produces its source through
> the same transformation without the GPU check (a declared, recorded choice, not a bypass). Optionally pass the
> kernel manifest to `runTixCuda` [...]. 4. Composition: the correspondence from Tix statements to kernels, composed
> through the schedule passes and the emission, must equal today's `kernelCorrespondence`; the Typed one must equal
> `imageCorrespondence`.

(The full brief is `ttmp/2026/11/27/IRWB-039--…/various/prompts/lowering/claude/IRWB-061.md`.)

### What I did
- `npm run build`, then `node ttmp/2026/11/27/IRWB-039--*/scripts/02-baselines.mjs check` on the untouched branch.
- Created this ticket with `docmgr ticket create --ticket IRWB-061` and the three documents.

### Why
To know the state before any change, and how long the oracle takes.

### What worked
The baselines print `no differences` on `e01f5cb`; the check takes 3 min 17 s here.

### What didn't work
Nothing failed. The first baseline command hit the 120 s tool timeout and went on in the background.

### What I learned
- The runner already publishes an output of another lineage without a base (`publishAccepted`,
  `after.id === before.id ? { base } : {}`); `IRStore.publish` without a base refuses a lineage that has a head.
- `runCudaBatch` already takes `kernels`; only `runTixCuda` does not pass them.
- `TixIR.entities` (contract layer) lists statements; the Tix adapter lists functions, parameters and statements.
  `BlocksIR` and `ImageIR` declare no `entities`.
- `CudaIR` has no adapter; artifacts are built with `createArtifact(CudaIR, ...)`.
- `lowerToImage` has 3 callers in `src/typed` and `src/workbench` (`attribute.ts`, `strategies.ts`,
  `candela.ts`, `programs.ts`) and none passes facts.

### What was tricky
The scope list does not include `src/tensor/strategy.ts`, where `scheduleFunction` runs the schedule passes and
drops their results.

### What warrants a second pair of eyes
Nothing yet.

### Code review instructions
None: no code changed.

## Step 2: probe 01, the composed Tix correspondence

Before designing on the assumption that composition reproduces `kernelCorrespondence`, I measured it.

### What I did
`scripts/01-compose-probe.mjs`: for every corpus Tix program, at r0 and after `inline` + `split-sum`, for every
function, fused and unfused: build statements → initial kernels with `makeCorrespondence`, apply `fusePass` and
`loopsPass` with `applyTransformationSync` and the decisions `chooseFusion` / `chooseLoops`, add kernels → CUDA
kernels, fold with `composeCorrespondence`, and compare the set of (statement, kernel) pairs with
`kernelCorrespondence`'s. It also asserts the schedule reached equals `lowerSchedule`'s.

### Why
`composeCorrespondence` had not been used across IR kinds in this repository; the standing instructions ask for a
probe before relying on that.

### What worked
`24/24 composed mappings equal kernelCorrespondence's`.

### What didn't work
The first run failed: `Cannot find module '.../ttmp/dist/framework/passes/index.js'`. The script's root was one
directory short (`../../../../..` from `scripts/`); six levels is right.

### What I learned
`composeCorrespondence` only needs the intermediate revision and entity list to agree; it does not care that the
two ends are different kinds. The unfused path is a two-link chain.

### What was tricky
Nothing.

### What warrants a second pair of eyes
The comparison is on pairs, not on grouping: composition groups entries differently from `kernels.map(...)`.

### Code review instructions
`node ttmp/2026/11/28/IRWB-061--*/scripts/01-compose-probe.mjs` after a build.

## Step 3: the design note

Wrote `design-doc/01-…md` before changing code: the cross form, the runner table, eight decisions with the simplest
alternative for each, three errors, what is left out and a Later list.

### What I did
Chose: extend the pass-layer runner (D1); keep `Transformation<S, N, P>` and add a cross type built by the same
constructor (D2); `bind` for contract ports (D3); restrict the correspondence handed to a contract to the port
types' entities (D4); a `pending` option (D5); `lowerToImage` as a pending application (D6); the composed Tix
correspondence as the lowering's own (D7); facts as `needs` when there is a manager (D8).

### Why
The brief asks for a design note first, and guide question 8.1 and 8.2 need an answer with a reason.

### What worked / What didn't work
Not applicable (no code).

### What I learned
The contract layer and the IR layer disagree on Tix's entity universe; a cross transformation checked by a contract
must reconcile them somewhere.

### What was tricky
D4. Three places could reconcile the universes; the runner is the only one that sees both the adapter and the
contract's port types.

### What warrants a second pair of eyes
D4 and D5: both add a rule to the runner.

### Code review instructions
Read the table in the design note against `runTransformation`.

## Step 4: the cross form in the runner (`src/framework/passes/`)

The runner now takes a transformation whose output is another IR. Same-IR passes go through the lines they went
through before; the cross form branches at five places.

### What I did
- `define-pass.ts`: `PassResult<S, Out = S>`; `CrossResult<Out>` and `prepareCross` (wrap the output with
  `to.adapter`, complete the entries or the derivation over both projections); `semanticCorrespondence` takes an
  optional `universe` and restricts the record to it; `publishAccepted` takes the head the revision replaces
  instead of deriving it from the input.
- `transformation.ts`: `IRSide`, `ContractPorts`, `CrossSpec`, `CrossTransformation`, `isCross`; `transformation`
  overloaded on `{ from, to }`; `runTransformation` and both drivers overloaded; `TransformationOptions.pending`;
  `ObligationEvidence.status`; `TransformationResult.pending`; the manager's own error kept as `cause` on a
  `contractRejected`.

### Why
Design note D1 to D5. The `cause` is there because the CUDA caller must tell "the check answered no"
(`ContractError('postcondition')`) from "the check could not run" (a transport failure), and the runner's
`PassError` carried only the text.

### What worked
`npx tsc --noEmit` clean after two fixes (below); `tests/framework/*.test.mjs` 266 pass, 0 fail, before any new test.

### What didn't work
First compile, three kinds of error:
- `error TS2339: Property 'from' does not exist on type 'CrossSpec<...> | (TransformationSpec<...> & Record<"to", unknown>)'`:
  `'from' in spec || 'to' in spec` narrows to a union TypeScript cannot use. Fixed with a cast to `CrossSpec` inside
  the branch.
- `error TS2454: Variable 'produced' is used before being assigned`: the cross branch never assigns it. Initialised
  to `undefined`.
- `error TS2394: This overload signature is not compatible with its implementation signature` on both drivers: the
  implementation took `Transformation` only. Widened to the union.

### What I learned
- An overloaded generator works: the overload signatures are plain declarations returning `Steps<...>`, and the
  implementation is `function*`.
- `IRStore` has no "does this lineage exist" query; `store.revisions(id).length` answers it.

### What was tricky
Publication across IRs. The first application opens the output's lineage (`publish` without a base). A second
application to the same output id must advance it, and `publish` without a base refuses a lineage that has a head.
So the runner reads the output lineage's head and generation right after `prepare`, before any asynchronous
`ensures`, and publishes with that base: the same compare-and-swap an edit uses.

### What warrants a second pair of eyes
- `pending` on a same-IR pass also skips its preservation claims. No caller uses that today.
- The restriction in `semanticCorrespondence` keeps an entry whose target side became empty (`x` maps only to
  pushes; in a universe without pushes the entry reads "x, no target"). That is the restricted relation, but it
  reads like a removal.

### Code review instructions
`git diff e01f5cb -- src/framework/passes/`; in `runTransformation` follow `cross` and `same`.

## Step 5: `typed.lower-rv32` and script 02 (the cost, and D8)

### What I did
- `image.ts`: `coverEntries` split out of `imageCorrespondence` (which now completes them).
- `run.ts`: `loweringContract(params)`: ports `program` and `image`, the `covers` correspondence requirement, and
  `rv32.image-agrees` as its condition.
- `compile.ts`: `imageLowering(check, facts)`; `lowerToImage` as a pending application; `lowerImageChecked`.
- `scripts/02-typed-lowering-cost.mjs`: for 50 projects at r0 and after O2, the earlier body of `lowerToImage`
  against the new one, interleaved, best of 5; and one application with facts through a fresh `AnalysisManager`.

### Why
D6 (one path) needs the cost known; D8 (facts as `needs`) needs the manager's cost known.

### What worked
`{"artifacts":100,"equalImageAndCorrespondence":100,"directMs":2067.2,"runnerMs":2000.2,"ratio":0.968,"needsThroughFreshManagerMs":3321}`:
the same image revision and the same canonical correspondence on 100 of 100, and no measurable cost (0.97, inside
the noise of a best-of-5).

### What didn't work
`node .../02-typed-lowering-cost.mjs` first failed with
`Error: noVendor: typedWasm is not loaded (see vendor/ds-js-os/VENDOR.json and setVendor)`: I had guessed
`tools/vendor.mjs`; the installer is `tools/node-vendor.mjs` (as the baselines script imports it).

### What I learned
Facts through a fresh manager cost about 1.6 times the direct solve (3,321 ms against about 2,050 ms, one run).
So D8 stands as written: `needs` when the caller has a manager (the checked application), `compileImage`'s own
solve when it has none (`lowerToImage`).

### What was tricky
`needs` are static per transformation, and the pending path has no manager. Two definitions (`'own'`, `'needs'`)
share one `prepare`; the cache key is the facts mode and the contract's version.

### What warrants a second pair of eyes
`imageLowering(check, 'needs')` always declares `ranges`, also when `useRanges` is off for an application.

### Code review instructions
`src/typed/backend/compile.ts` from `LoweringParams` to `lowerImageChecked`; run script 02.

## Step 6: `tensor.lower-cuda` on the runner; an existing test changed

### What I did
- `cuda-contract.ts`: `cudaAdapter` (kernels as entities); `lowerTix` (initial schedule, `schedulePlan` on a
  registry whose pass algorithms report their results, emission, the four-link composition); the contract without
  its `run` body (version 3); the transformation `tensor.lower-cuda`; `supplied(candidate)` for a caller's unit;
  the check function drives the runner and exposes `lowering`; `cudaLowering`.
- `index.ts`: `lowerTixCuda` (the pending application); `cudaSource` and `runTixCuda` use it; `runTixCuda` passes
  the unit's manifest to `runCudaBatch`.
- `tests/tensor/fusion.test.mjs`: one test updated (below).

### Why
Brief items 3 and 4.

### What worked
`tests/tensor/*.test.mjs` without the GPU files: 51 pass after the test update.

### What didn't work
`tests/tensor/fusion.test.mjs:146` failed:
```
✖ the lowering records which statements each kernel computes, and fused and unfused share their cases
  + undefined
  - [ true ]
  at tests/tensor/fusion.test.mjs:167
```
It read `correspondence.evidence.evidence.gated`, a field `kernelCorrespondence` put in the record's evidence. The
record is now the runner's, whose evidence is the IR layer's (format version, relation labels, entity lists). It
also compared `entities` in manifest order; the IR layer's correspondence is in canonical order.

### What I learned
The composed relation labels read as the chain: `scheduled > fused > emitted`.

### What was tricky
Three things.
- `makeCorrespondence` canonicalises (sorts ids and entries), so writing the entries in manifest order in `prepare`
  had no effect; I removed that code and kept only the grouping (one entry per kernel).
- A supplied unit has no chain to compose; its correspondence is what its manifest claims (`manifestEntries`).
- `TixIR.entities` lists statements and the adapter lists functions and parameters too (D4).

### What warrants a second pair of eyes
The test change. I kept both assertions' content: the gated flags are read from the kernels of the recorded output
(`execution.outputs.subject.value.kernels`), and the entities are compared after sorting both sides.

### Code review instructions
`git diff e01f5cb -- tests/tensor/fusion.test.mjs src/tensor/`.

## Step 7: script 03, what `cudaSource()` costs now

### What I did
`scripts/03-cuda-source-cost.mjs`: 12 lowerings (6 programs, fused and unfused), the earlier body against
`cudaSource()`, warm, best of 7, and the first call.

### What worked
`{"lowerings":12,"sameSource":12,"earlierWarmMs":3.43,"runnerWarmMs":56.35,"runnerColdMs":111.93,"perLoweringWarmMs":4.7}`

### What didn't work
Nothing failed.

### What I learned
The earlier body memoizes the schedule per function (0.29 ms warm); the runner path schedules, emits, builds the
artifact and composes each time: 4.7 ms per lowering. Every caller of `cudaSource` and `runTixCuda` is a test, the
baselines script, or a call followed by a remote compile and run that takes seconds, so I added no memo.

### What was tricky
Nothing.

### What warrants a second pair of eyes
Whether 4.7 ms matters to a caller I did not find. A memo keyed by the input revision, function and `fuse` would
be sound (artifacts are content-addressed).

### Code review instructions
Run script 03.

## Step 8: the tests

### What I did
- `tests/framework/cross-transformation.test.mjs` (6 tests): a toy lowering from the expression lab to stack code.
- `tests/typed/lowering.test.mjs` (5 tests): the corpus equality (100 lowerings), options pass-through, the chain
  r0 → O2 → image, the planted bug.
- `tests/tensor/lowering.test.mjs` (4 tests): byte-identical source and the composed correspondence on 24
  lowerings; the checked application on the runner.

### Why
The acceptance list.

### What worked
Typed and Tix test files passed on their first run; the planted bug (the first spill reload of `pressure` under
`{ registers: 1 }` replaced by a nop) is rejected with `contractRejected`, cause `postcondition`, and the function
that holds the reload among the counterexamples.

### What didn't work
Three of six framework tests failed on the first run, all three my test's mistakes:
- `Error [IRError]: Unknown source entity squareCopy`: my toy pass named `squareCopy` on a program that no longer
  has it (the second application). The pass now returns the value unchanged then.
- `assert.ok(chain.entries.some(e => e.from.includes(id) && squareInsns.every(i => e.to.includes(i))))`: composition
  does not keep my grouping; I compare the union of targets.
- `assert.ok(!record.entities.some(e => e.from.includes('x')))`: the restricted record keeps `x` with an empty
  target (see step 4).

### What I learned
`makeCorrespondence` already refuses an entry naming an entity neither side has, so `prepareCross` needs no
membership check of its own.

### What was tricky
Planting a wrong image that still passes `validateImage`: the code bytes, the word, the text and `sym` of the one
record must agree.

### What warrants a second pair of eyes
The corpus test takes 25 s (50 projects through O2).

### Code review instructions
`node --test tests/framework/cross-transformation.test.mjs tests/typed/lowering.test.mjs tests/tensor/lowering.test.mjs`

## Step 9: acceptance on the final source, and the report

### What I did
- Moved the runner's same-IR candidate handling into one `else` block (it had an empty `if (cross) {}` arm), then
  rebuilt and ran everything on that source (commit `38f0704`): `npm run check`, the five suites, `node
  tools/build-site.mjs`, `npm run format:check`, and the baselines.
- Wrote `reference/02-report.md`; marked the tasks; added a changelog entry.

### Why
The acceptance is judged on the last commit.

### What worked
- Baselines: `no differences`.
- Suites: typed 198 pass, 0 fail, 2 skipped; framework 272 pass; workbench 24 pass, 1 skipped; stdlib 61 pass;
  tensor without the GPU files 55 pass.
- `npm run check` clean; the site builds.

### What didn't work
Nothing failed. The baselines run takes 3 to 4 minutes and went to the background each time.

### What I learned
The skipped tests are gated on `IRWB_FULL=1` and were skipped before this change as well.

### What was tricky
Nothing.

### What warrants a second pair of eyes
The GPU suite, which this lane does not run: `checkLowering`, `runTixCuda` with the manifest, and the mutant tests
that call `checkCudaLowering(p.current, fn, cudaArtifact(...))` all go through the runner now.

### Code review instructions
`node ttmp/2026/11/27/IRWB-039--*/scripts/02-baselines.mjs check` after `npm run build`, then the suites as the
brief lists them.
