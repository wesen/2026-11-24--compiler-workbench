---
Title: 'Diary: F27 Tix meaning gate in strategy plans'
Ticket: IRWB-041-C
Status: active
Topics:
    - tensor
    - contracts
    - strategy
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - src/tensor/passes.ts
    - src/tensor/contract.ts
    - src/tensor/index.ts
    - tests/tensor/r3-tix-in-plans.test.mjs
ExternalSources: []
Summary: Chronological account of F27: the defect probe, the declared relation, the gate as a contract, and the checks.
LastUpdated: 2026-11-27T18:05:00-05:00
WhatFor: To see what was tried, what the commands printed, and why each choice was made.
WhenToUse: When reviewing this step, or when a later step (a synchronous plan driver, the phase 3 pass API) needs to know how the gate reached the bridge.
---

# Diary

## Step 0: read the ground, and the baseline before touching anything

Read `src/tensor/index.ts` (`optimizeTix`), `src/tensor/passes.ts` (`pass()` / `inlinePass` / `splitPass`),
`src/framework/passes/bridge.ts` (`passAlgorithm` and its `contract` / `contractInputs` options),
`src/framework/passes/define-pass.ts` (`applyNativePassSync`: it takes the gate as an argument, and it *refuses* a
pass that carries its own `contract`, "This pass requires the asynchronous analysis manager"), and R3 probe 02 part 3.

Built and ran the IRWB-039 baselines check on the untouched tree:

```
npm run build
node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check
-> no differences from .../various/baselines/main.json
   timing: inline on attention 0.527 -> 2.294 ms per application
```

The timing line is informational (it is not compared), and this machine is shared, so it moves a lot between runs.

## Step 1: reproduce the defect (scripts/01)

`scripts/01-probe-tix-gate-in-plans.mjs` runs the same wrong pass (inline, but multiplies by 3) through four paths.
Before the change:

```
0. declared relations: tensor.inline=(none), tensor.split-sum=(none)
1. optimizeTix runner with the store gate, wrong pass -> THROWS PassError[contractRejected]: at [0] expected 1065440815, got 1069678918, allowed 0
2. stock bridge (no contract), wrong pass inside attempt/fallback -> succeeded, result is the input: false
3. tixAlgorithm -> not exported yet (the defect this step fixes)
```

Line 2 is the defect: the plan accepts the wrong program and its value is *not* the input, so the wrong output was
published. Line 1 is what still works today, because `optimizeTix` hands the gate to `applyNativePassSync`.

## Step 2: the relation belongs to the pass

`src/tensor/passes.ts`: `pass(name, relation, transform)` and `TixPass = Pass<Module, {}> & { relation }`, with
`inlinePass` = `'exact'` and `splitPass` = `'tolerance'`. `optimizeTix` now gates with `definition.relation`; the
`pass === 'inline' ? 'exact' : 'tolerance'` expression is gone.

`definePass` freezes its spec, so the relation is added by returning `Object.freeze({ ...definition, relation })`
rather than by a field inside the spec literal: `PassSpec` has no such field, and this step does not change
`src/framework/`. The type is a plain intersection, so no cast is needed.

## Step 3: the gate as a contract (`meaningGateContract`)

`src/tensor/contract.ts`: `Relation` is exported, and `meaningGateContract(relation)` builds (and caches per
relation) an invariant over `{ before, origin, after }` whose body is `meaningGate(origin, relation)` itself, plus a
transformation whose single `ensures` binds the input, the origin and the output to it — exactly R3 probe 02 part 3,
including the one adaptation it needed: the gate's evidence carries an `undefined` field, which the analysis manager
refuses to record, so the evidence goes through a JSON round trip. This is the typed compiler's own pattern
(`optimizationContract` in `src/typed/passes.ts`), which is why it is a contract and not a new bridge option.

## Step 4: `tixAlgorithm(pass, { origin })` in `src/tensor/index.ts`

Three lines of substance: throw if the pass declares no relation (rather than silently gate it with a default nobody
stated), then `passAlgorithm(pass, { contract: meaningGateContract(relation), contractInputs: () => ({ origin }) })`.
`manager` is optional and defaults to a fresh `AnalysisManager`; `onResult` is passed through for a host.

After the change the same probe prints:

```
0. declared relations: tensor.inline=exact, tensor.split-sum=tolerance
1. optimizeTix runner with the store gate, wrong pass -> THROWS PassError[contractRejected]: ... allowed 0
2. stock bridge (no contract), wrong pass inside attempt/fallback -> succeeded, result is the input: false
3. tixAlgorithm, wrong pass inside attempt/fallback -> succeeded, result is the input: true (the fallback ran)
3b. tixAlgorithm, wrong pass alone (no fallback) -> rejected: [contractRejected] Pass probe.wrong output rejected: tensor.meaning-gate.exact: at [0] expected 1065...
4. correct passes in one plan vs optimizeTix -> succeeded, same revision as optimizeTix: true
```

Line 2 is expected to stay as it is: the stock bridge knows nothing of Tix and is not changed by this step; the fix
is that Tix's own algorithm (`tixAlgorithm`) hands it the gate. Line 4 is the acceptance that matters for the
baselines: a plan of `inline` then `split-sum` produces the same revision as `optimizeTix`.

## Step 5: checks

```
npm run check                              -> clean
npm run build                              -> clean
npx prettier --check src/tensor/{index,passes,contract}.ts
                                           -> only src/tensor/index.ts needed reformatting, done
```

`npm run format:check` reports 9 files (`src/framework/contracts/differential.ts`, `src/framework/core/data.ts`,
`src/framework/ir/correspondence.ts`, `src/framework/ir/store.ts`, `src/typed/{candela-render,evaluate,ir,model,program}.ts`),
none of them touched here: `src/framework/core/data.ts` at HEAD~1 is already unformatted, so the tree was not
Prettier-clean before this step and these warnings are not its doing.

```
node --test tests/tensor/{corpus,cuda,fusion,language,passes,r3-tix-in-plans,schedule}.test.mjs
                                           -> 45 pass, 0 fail, 0 todo (the F27 test without its `todo`)
node --test tests/framework/*.test.mjs tests/workbench/*.test.mjs
                                           -> 262 pass, 0 fail, 4 todo (F33 x2, F34, F35), 1 skipped
node --test tests/typed/*.test.mjs         -> 183 pass, 0 fail, 3 todo (F36, F37, F38), 2 skipped
node .../02-baselines.mjs check            -> no differences
```

`node tools/build-site.mjs` was not run: this step changes no file under `src/framework/` or `src/workbench/`.

## What was deliberately left out

- `optimizeTix` still calls `applyNativePassSync` with the gate closure: running a plan synchronously needs a
  synchronous plan driver, which is a later step (design doc, phase 3).
- No framework change: `PassSpec` still has no `relation` and no bridge option changed. Whether `relation` should be
  a framework concept (the phase 3 spike's `relation` in the transformation spec) is that spike's question.
- The remaining by-name lookup in `optimizeTix` (`pass === 'inline' ? ... : ...`) is a lookup, not a choice of
  relation; the relation is now read from the pass.
