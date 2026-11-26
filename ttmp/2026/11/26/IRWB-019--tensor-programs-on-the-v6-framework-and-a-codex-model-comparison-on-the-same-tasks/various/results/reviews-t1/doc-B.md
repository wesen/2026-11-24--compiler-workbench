# Review of doc-B

## Must change

1. **Non-finite outcomes reject a correct pass.** The rule "On an applicable tolerance check a nonfinite output is a failed comparison" meets all-zero, alternating-sign and seeded `[-1,1]` inputs. Layernorm's eps is unspecified. If eps is an input, `sqrt(var + eps)` is NaN on some cases, and the correct `split-sum` is rejected on a corpus program. State the eps form and how a non-finite *reference* is treated.
2. **Wrong variants.** "Exercise the deliberately wrong native rewrites … using test-local definitions and explicit witness inputs." The contract must reject them. Show the rejection on its generated cases, not on hand-picked inputs.
3. **Budget.** "the candidate must complete every selected case within the budget". Cases are screened on the origin, and `split-sum` adds outer-loop visits, so a correct candidate near the cap is rejected. Say how the candidate's budget is set.
4. **Case selection.** "Select up to eight distinct legal bindings per function, prioritizing empty, singleton, full block and tail reductions when present". The ranking is undefined, so the implementer must invent it.
5. **Scope.** "Add focused framework coverage to `tests/framework/ext-e3-e6.test.mjs`". The brief allows edits to existing tests only where the framework change requires them. Use a new file.

## Cut

1. "Use exact elimination over affine forms for parameter binding and compile-time bounds … eliminate variables from linear inequalities over rationals". No corpus program needs this solver.
2. "Keep the source dimension constraints in the function signature in the artifact, including those of annotated temporaries". These constraints serve call-time shape errors, which go beyond compile errors with `line:col`.

## Framework changes

- **Extract native-candidate preparation, plus `applyNativePassSync` with a `(before, after) => CheckResult` gate:** needed, minimal and correctly placed.
- **`defineNativePass`:** not needed. `definePass` already describes a native-result pass. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change.

## Keep

Keep the half-ULP witness in the contract's domain, which makes exact rejection deterministic. Keep the tolerance anchored at the origin's f64 across steps and calls.
