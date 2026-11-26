# Review of doc-G

## Must change

1. **Positive inputs and non-finite references.** "positive samples for log/sqrt" gives no rule for which parameters feed `log` or `sqrt`, and layernorm's eps form is unspecified. Together with "Fail closed if a required reference/candidate is nonfinite", a signed eps makes `sqrt(var + eps)` NaN and rejects the correct `split-sum` on a corpus program. State the eps form and the positive-sample rule in terms of the signature, or define how a non-finite origin reference is handled.
2. **Shape domain.** "Try shape bindings cycling through 1, 3, 4, 5, 9 and unequal per-axis permutations" does not say which assignments are generated, in what order, or how many are kept per function. Write the enumeration down.

## Cut

1. "Also check every candidate against original program: exact until an approximate step is accepted, tolerance thereafter (carry this state with the handle across calls)". Inline's exact check against its immediate input, on the same origin-derived cases, already implies this check. The extra check and its state can go.
2. "Parameter shape expressions define a linear system in shape names … at call time solve against actual dimensions", and "Carry unresolved shape-only inequalities as domain constraints on concrete shapes". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Measure deviations on corpus; report outliers rather than increasing threshold". This is a measurement plan, not stage-1 design.

## Framework changes

- **Shared native-candidate preparation plus a synchronous checked-native application:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It belongs in `define-pass.ts`.
- **"Give it a restricted spec type (pure native function of `before` and view; writes, IR, adapter)":** not minimal. `definePass` already carries this metadata. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change: the design does not call the async `applyPass` on a read-only adapter.

## Keep

Keep the nine-element witness with its 0.25 tail inside the domain (`1.25` against `1.2500001192092896`, verified), which catches both the reassociation and a dropped partial block. Also keep the elementwise, fail-closed comparison against the untransformed origin's f64.
