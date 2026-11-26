# Review of doc-I

## Must change

1. **`split-sum` goes beyond the brief.** The design has "Every `sum` reduction without a `block` gets `block: 4`" and "`split-sum` splits every sum on its first index … Single-index sums only would leave conv2d untouched". The brief's pass rewrites "a `sum` reduction over one index". Splitting conv2d's `sum(c, di, dj)` on `c` widens the pass beyond that definition. Restrict it to sums over a single index.
2. **Definition identity on the manager path.** The design has "`tensorContract(relation, params)`", and a test expects "the same verdicts through `applyPass` with an `AnalysisManager` and `tensorContract`". A second definition object with the same id@version makes `ContractRegistry.register` throw "cannot be redefined", and `applyPass` reports that throw as `contractRejected`. State that `tensorMeaning` and `tensorContract` return one cached object per parameter set, as Typed's `meaningKept` does.

## Cut

Nothing material. The Later and Left-out lists already keep later-stage material out of the design.

## Framework changes

- **F1 `applyPassSync`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal, with a `CheckResult` gate and a refusal of `needs`, `preserves` and `contract`, and it is in the right file. Drop `SyncApplyOptions.store`: with a native result, `openIR(after, adapter, store)` throws `ir.unpublished`, because the store already holds a head for the same artifact id.
- **F2 (open the edit only when `rebuild` exists):** needed. Probe A is right, and the manager parity test runs `applyPass` on your read-only adapter. It is minimal and correctly placed.
- **F3/F4 (no change):** correct. The non-finite and −0 limits of the canonical form are real, and the IR avoids them.

## Keep

Keep the `tau·s` tolerance, with its measured margins and the calibration test "within `tau/8`". Keep `block` on the reduction: index ranges stay the same, so the one checker remains exact as the IR validator. Keep the two-field steps, and an origin that is carried across calls.
