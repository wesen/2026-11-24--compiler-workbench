---
Title: 'Report: Tix passes keep their meaning gate inside strategy plans (F27)'
Ticket: IRWB-041-B
Status: active
Topics:
    - tensor
    - framework
DocType: report
Intent: long-term
Owners: []
RelatedFiles:
    - src/tensor/passes.ts
    - src/tensor/contract.ts
    - src/tensor/index.ts
    - tests/tensor/r3-tix-in-plans.test.mjs
ExternalSources: []
Summary: "F27 done: relations declared on the passes, tixAlgorithm exports the gated strategy algorithm, all baselines unchanged"
LastUpdated: 2026-11-27
WhatFor: "What this step changed and its acceptance evidence"
WhenToUse: "Review of IRWB-041-B"
---

# Report: Tix passes keep their meaning gate inside strategy plans (F27)

## What changed

- `src/tensor/passes.ts` — each pass now declares its meaning relation (`TixPass.relation`: `inline` is `exact`, `split-sum` is `tolerance`). The relation is attached after `definePass` (a literal would trip the excess-property check on `PassSpec`, and a framework change is out of scope) and survives a spread, so a re-derived pass such as the test's `r3.wrong` carries its origin pass's declaration.
- `src/tensor/contract.ts` — `gateContract(relation)`: the meaning gate as a transformation contract (`tensor.gated.<relation>`), an `ensures` invariant binding the pass's input, the origin (r0) and the output into `meaningGate`, with the probe's one adaptation (JSON round trip on the gate's evidence, whose `undefined` field the manager's encoder refuses).
- `src/tensor/index.ts` — `optimizeTix` gates each pass with its *declared* relation instead of choosing by name; new `tixAlgorithm(pass, { origin })` registers the pass through `passAlgorithm` with `contract: gateContract(pass.relation)` and `contractInputs: () => ({ origin })`, so a plan rejects a wrong pass where the stock bridge accepted it.
- `tests/tensor/r3-tix-in-plans.test.mjs` — the F27 test's `todo` removed in the same commit; assertions unchanged.
- `scripts/01-gate-in-plans.mjs` — probe: declared relations, the wrong pass rejected under its declared relation and inside `attempt`/fallback, plan `[inline, split-sum]` agreeing with `optimizeTix`'s revision and meaning.

`optimizeTix` stays synchronous, per the brief: driving it from a plan needs a synchronous plan driver (a later step).

## Acceptance (last commit `0308613`, plus this report commit)

- **The test:** `F27: a wrong Tix pass is rejected inside a strategy plan; correct passes are accepted` — passes, `todo` removed.
- **Baselines:** `node ttmp/2026/11/27/IRWB-039.../scripts/02-baselines.mjs check` after `npm run build` prints `no differences`.
- **Suites:** typed 188 tests → 183 pass, 0 fail, 2 skipped, 3 todo (F36-F38); framework 242 → 238 pass, 0 fail, 4 todo (F33-F35 + F34 sibling); workbench 25 → 24 pass, 0 fail, 1 skipped; tensor without `*-gpu.test.mjs` 45 → 45 pass, 0 fail, 0 todo. The only failing entries node lists are the todo tests of other steps.
- `npm run check` (tsc) clean; `src/framework/` and `src/workbench/` untouched, so no site build; `npm run format:check` flags only 9 pre-existing files, none changed by this step.

## Left out / notes

- No framework change: the bridge's existing `contract`/`contractInputs` options were enough. The relation lives on the Tix pass rather than in `PassSpec` because this step has no framework scope; if a later step adds a framework-level declared relation, `TixPass.relation` can move there.
- Each `tixAlgorithm` owns a private `AnalysisManager` (as in the probe); sharing one per plan would need a way to thread a manager through `tixAlgorithm`, which no current caller asks for.
- Nothing in the brief or the test looked wrong.
