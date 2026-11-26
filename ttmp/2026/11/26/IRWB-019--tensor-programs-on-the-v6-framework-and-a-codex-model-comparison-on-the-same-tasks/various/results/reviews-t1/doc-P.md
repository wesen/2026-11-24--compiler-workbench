# Review of doc-P

## Must change

1. **The exact rejection is not guaranteed.** "the checker generates 8 cases from seed 1", with shapes and values drawn uniformly. No case forces a sum of six or more terms or a bit-changing pattern. So "`split-sum` is rejected by exact … on matmul, softmax, layernorm and attention" may fail, and the implementer would have to re-tune the domain. Make the domain guarantee a bit-changing reassociation.
2. **Scope.** The design says "Add a test in `tests/framework/ext-e3-e6.test.mjs` … This is a new test case." That still edits an existing test file. The brief allows such edits only where the framework change requires them. Use a new file.
3. **Evidence encoding.** §6.5 sets no `describeCase`, yet a test runs "`applyPass` (async, with a manager)". There a counterexample goes through `immutable`, which throws on typed arrays and non-finite numbers, so a rejection reports the wrong reason. Specify a JSON-safe `describeCase`.

## Cut

1. "During implementation I will measure … the largest scaled error of each origin program … If the honest margin is under 10×, I will reopen this choice." This is a measurement plan.

## Framework changes

- **F1, lazy `ctx.edit`:** needed. I confirmed that the `Edit` constructor throws `ir.capability` when there is no `rebuild`, and your async parity test runs `applyPass` on a read-only adapter. The change is minimal and correctly placed.
- **F2, `applyPassSync` evaluating differential-only `ensures` with `runDifferential`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It belongs in `define-pass.ts`.
  - Drop `store?`. With a native result, `openIR(after, adapter, store)` throws `ir.unpublished`, because the store already holds a head for the same artifact id.
  - Creating each contract once is the right reading of the registry's rule.
- No missed change.

## Keep

- The `max(1, |r|)` tolerance, with "inconclusive" when the origin's own f32 result fails the bound.
- The guard-based split, together with the extension of the bounds rule, so validation still proves reads in bounds.
- `inline-wrong`: it reassociates inside the copied tree, which isolates what the exact relation adds over tolerance.
