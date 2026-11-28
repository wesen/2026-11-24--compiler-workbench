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
