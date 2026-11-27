---
Title: Implementation diary
Ticket: IRWB-041-B
Status: active
Topics:
    - tensor
DocType: diary
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "F27: Tix passes declare their meaning relation, and tixAlgorithm keeps the gate inside strategy plans"
LastUpdated: 2026-11-27
WhatFor: "Chronological record of the F27 step"
WhenToUse: "Resume context for this ticket"
---

## Step 1: the defect, confirmed from the R3 probe

R3's probe 02 (`ttmp/2026/11/26/IRWB-019.../various/r3-synthesis/scripts/02-tix-passes-in-strategy-plans.mjs`) already demonstrated both halves: Tix passes run in plans through `passAlgorithm`, and the stock bridge accepts a wrong pass (2b: `y(origin) 4 y(result) 6`) because the meaning gate lives in `optimizeTix`'s closure, not on the pass. Part 3 of the same probe showed the fix shape: wrap `meaningGate` as an `ensures` invariant over input/origin/output and hand it to the bridge's `contract`/`contractInputs` options, with one adaptation — the gate's differential evidence carries an `undefined` field the manager's canonical encoder refuses, so it goes through a JSON round trip.

## Step 2: the relation moves onto the pass

`src/tensor/passes.ts` now builds each pass with a `relation` field (`TixPass` interface: `inline` is `exact`, `split-sum` is `tolerance`). Declaring it inside the object literal handed to `definePass` would trip TypeScript's excess-property check on `PassSpec`, and extending `PassSpec` in the framework is out of this step's scope, so the helper attaches it after `definePass` and freezes the result; a spread like the test's `{ ...inlinePass, id: 'r3.wrong' }` keeps the declared relation. `optimizeTix` now reads `definition.relation` instead of `pass === 'inline' ? 'exact' : 'tolerance'`.

## Step 3: `tixAlgorithm(pass, { origin })`

`gateContract(relation)` in `src/tensor/contract.ts` builds the probe's invariant (`tensor.meaning-gate.<relation>`) and transformation (`tensor.gated.<relation>`) for a declared relation; `tixAlgorithm` in `src/tensor/index.ts` passes it to `passAlgorithm` with `contractInputs: () => ({ origin })`. Each algorithm gets its own `AnalysisManager`, as in the probe. `optimizeTix` stays synchronous per the brief (a synchronous plan driver is a later step).

Probe `scripts/01-gate-in-plans.mjs`: declared relations `exact tolerance`; the wrong pass is `contractRejected` under its declared relation; in a plan the wrong pass falls back to the input inside `attempt`; plan `[inline, split-sum]` reaches the same revision as `optimizeTix`; `y(origin) 4 y(plan result) 4`.

## Step 4: acceptance

- `tests/tensor/r3-tix-in-plans.test.mjs` F27 passes with its `todo` removed (commit also removes it).
- Baselines (`02-baselines.mjs check` after `npm run build`): `no differences`.
- Suites: typed 183 pass / 0 fail / 3 todo (other steps), framework 238 / 0 / 4 todo, workbench 24 / 0, tensor (without `*-gpu`) 45 / 0. The remaining failures printed by node are exactly the todo tests of F33-F38.
- `npm run check` clean; no `src/framework/` or `src/workbench/` change, so no site rebuild. `npm run format:check` flags 9 pre-existing files, none of them mine.

One process note: my first tensor suite run used a bare glob and also executed the `*-gpu.test.mjs` files (they passed or skipped; no GPU work was harmed), then I re-ran the seven non-GPU files explicitly for the reported counts.
