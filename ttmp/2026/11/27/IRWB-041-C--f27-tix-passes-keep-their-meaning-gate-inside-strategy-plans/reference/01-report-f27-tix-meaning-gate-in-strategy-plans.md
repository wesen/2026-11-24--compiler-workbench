---
Title: 'Report: F27 Tix meaning gate in strategy plans'
Ticket: IRWB-041-C
Status: active
Topics:
    - tensor
    - contracts
    - strategy
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/tensor/contract.ts
    - Path: src/tensor/index.ts
    - Path: src/tensor/passes.ts
      Note: declares the relation per pass
    - Path: tests/tensor/r3-tix-in-plans.test.mjs
    - Path: ttmp/2026/11/27/IRWB-041-C--f27-tix-passes-keep-their-meaning-gate-inside-strategy-plans/scripts/01-probe-tix-gate-in-plans.mjs
ExternalSources: []
Summary: 'F27 done: Tix passes declare exact/tolerance, the meaning gate travels as an ensures contract, and tixAlgorithm exports it to strategy plans; baselines unchanged.'
LastUpdated: 2026-11-27T18:15:00-05:00
WhatFor: To know what this step changed, what it proves, and what it deliberately left to later steps.
WhenToUse: When reviewing the F27 commit, or before the synchronous plan driver / phase 3 pass API that builds on it.
---

# F27: Tix passes keep their meaning gate inside strategy plans

## The defect

`optimizeTix` passed the Tix meaning gate to `applyNativePassSync` as an argument, and the Tix passes declared no
contract. A strategy plan applies passes through `passAlgorithm`, which knows nothing of that argument, so a plan
reported success for a pass that changed the program's meaning (probe: `scripts/01`, line 2 — the stock bridge
succeeds with the wrong program and its value is not the input).

## What changed

| File | Change |
|---|---|
| `src/tensor/passes.ts` | `Relation` is exported from `contract.ts`; `pass(name, relation, transform)` and `TixPass = Pass<Module, {}> & { relation }`; `inlinePass` declares `'exact'`, `splitPass` declares `'tolerance'`. `definePass` freezes its spec and `PassSpec` has no such field, so the relation is added by `Object.freeze({ ...definition, relation })`. |
| `src/tensor/contract.ts` | `meaningGateContract(relation)` (cached per relation): an invariant over `{ before, origin, after }` whose body is `meaningGate(origin, relation)`, plus a transformation whose one `ensures` binds input/origin/output to it — R3 probe 02 part 3, with its one adaptation (the gate's evidence carries an `undefined` field the analysis manager refuses, so evidence goes through a JSON round trip). |
| `src/tensor/index.ts` | `tixAlgorithm(pass, { origin, manager?, onResult? })`: refuses a pass that declares no relation, then `passAlgorithm(pass, { contract: meaningGateContract(relation), contractInputs: () => ({ origin }) })`. `optimizeTix` gates with `definition.relation` instead of `pass === 'inline' ? 'exact' : 'tolerance'`, and stays synchronous. |
| `tests/tensor/r3-tix-in-plans.test.mjs` | `todo: 'F27'` removed; assertions untouched. |
| `.../scripts/01-probe-tix-gate-in-plans.mjs` | the probe: the four paths, before and after. |

The shape is not new: `src/typed/passes.ts` `optimizationContract` plus `src/typed/strategy.ts` already hand a meaning
contract to `passAlgorithm` with `contractInputs: () => ({ origin })`. Tix now uses the same path, so no framework
file changed and the phase 3 pass API is not prejudged.

## Acceptance

- `F27: a wrong Tix pass is rejected inside a strategy plan; correct passes are accepted` — passes without `todo`
  (`tests/tensor` run: 45 pass, 0 fail, 0 todo).
- `02-baselines.mjs check` after `npm run build`: `no differences` (RV32 images, instruction counts, edit censuses,
  CUDA sources, and `optimizeTix` revisions for every Tix program). A plan of `inline` then `split-sum` yields the
  same revision as `optimizeTix` (probe line 4), which is why the revisions cannot drift.
- `tests/framework/*.test.mjs` + `tests/workbench/*.test.mjs`: 262 pass, 0 fail, 4 todo (F33 twice, F34, F35),
  1 skipped. `tests/typed/*.test.mjs`: 183 pass, 0 fail, 3 todo (F36, F37, F38), 2 skipped. No `*-gpu.test.mjs` run.
- `npm run check` clean; `node tools/build-site.mjs` not needed (no `src/framework/` or `src/workbench/` change).

## Decisions, and the simplest alternative each one rejected

- **A `relation` field on the pass vs. a table in `index.ts`.** A table keyed by pass id would keep
  `PassSpec` untouched, but it puts the claim in a file the pass does not own, exactly the by-name choice F27
  removes. The field is two lines and reads where the transform is written.
- **`tixAlgorithm` throws for a pass with no declared relation vs. defaulting to `'exact'`.** A default is a silent
  claim; `exact` would reject a legitimate tolerance pass and `tolerance` would accept a wrong one. The error names
  the pass.
- **The gate as a contract vs. a new bridge option for gates.** A gate option would change `src/framework/`, which
  this step is not allowed to do, and the contract path already exists (typed uses it), so the plan interpreter's
  existing rejection handling (`ctx.reject('contract-rejected', …)`, `attempt`/`fallback`) applies unchanged.
- **`meaningGateContract` in `contract.ts` vs. inside `index.ts`.** It is the meaning gate's own module; `index.ts`
  keeps the algorithm wiring and the exports.
- **`manager` optional.** The test builds `tixAlgorithm(...)` without one; a caller that keeps revisions in a store
  can pass its manager so facts and records accumulate in one place.

## Left out, on purpose

- **A synchronous plan driver.** `optimizeTix` still calls `applyNativePassSync` directly; running a plan
  synchronously is a later step (design doc, phase 3), as the brief says.
- **`relation` as a framework concept.** `PassSpec` still has no `relation`. The design doc's phase 3 spike puts
  `relation` in the transformation spec, with `eligible`, `prepare` and `obligations`; adding it to `PassSpec` now
  would be a framework change this step does not need.
- **The stock bridge is still ungated for Tix passes handed to it directly** (probe line 2). Making `passAlgorithm`
  gate by itself would need it to know a domain's meaning gate; the fix is that Tix's own algorithm supplies the
  contract, and any plan that uses `tixAlgorithm` is checked.
- **Duplication to note:** `optimizeTix` still looks a pass up by name (`pass === 'inline' ? inlinePass : …`). That
  is a lookup, not a choice of relation — but the pass registry the workbench would want (id → pass) still does not
  exist, so the list of Tix passes appears in `index.ts` and in the test.

## Nothing in the brief or the test looked wrong

The test's first assertion (`bad.status !== 'succeeded' || bad.value.revision === p.current.revision`) is satisfied
by the plan status `'rejected'`; it would also be satisfied by a plan that succeeded with the input as value, which
`attempt`/`fallback` makes possible — that is why the third block checks the sequence's revision against
`optimizeTix` rather than only the wrong pass's rejection.
