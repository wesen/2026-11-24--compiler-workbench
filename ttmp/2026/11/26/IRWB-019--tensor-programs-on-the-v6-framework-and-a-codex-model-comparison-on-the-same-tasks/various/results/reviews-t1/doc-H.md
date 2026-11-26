# Review of doc-H

## Must change

1. **The async parity test cannot run as designed.** "A parity test will run a changed candidate through the async wrapper and manager", but the adapter has none: "native-result passes don't need a graph-to-native rebuilder". `applyPass` calls `view.beginEdit()` before the pass runs, and the `Edit` constructor throws `ir.capability` for an adapter without `rebuild`. I confirmed this in `ir/transactions.ts`. Either open the edit lazily in `applyPass` and add that change to the ledger, or drop the async parity test.
2. **Sample counts are deferred.** "Specify sample ordering and counts in fixtures" leaves the number of seeded draws per shape, and the case order, to the implementation. Fix both in the design.

## Cut

1. "Acceptance bindings: initially exact checks `origin.f32` vs `candidate.f32`. For inline **always** check `current.f32` vs `candidate.f32`; after an accepted approximation also enforce the origin tolerance", together with the handle's "accepted origin relation". Exact agreement with `current`, on the same origin-derived cases, already implies the origin check.
2. "Bind from actual lengths at call time by exact integer/rational elimination", and "obligations depending on actual parameters, e.g. `H-KH+1 >= 0`, are checked at binding". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Report the largest absolute and scaled error per corpus test and review any failure before changing it." This is a measurement plan.

## Framework changes

- **`prepareNativeCandidate` extracted from `applyPass`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal and correctly placed. Keeping the verdict in tensor code is the narrowest version of this seam among the designs.
- **Missed:** the lazy edit (item 1), if the async parity test stays.

## Keep

Keep screening the tolerance cases on the origin alone, with "a nonfinite candidate on a finite reference always fails". Keep the nine-element witness (serial `1`, blocked `1.000000238418579`, verified). Keep the requirement that the mutants be valid IR whose rejection is numerical.
