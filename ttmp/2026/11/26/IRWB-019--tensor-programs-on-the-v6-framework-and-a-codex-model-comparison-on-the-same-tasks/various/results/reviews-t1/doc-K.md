# Review of doc-K

## Must change

None found. The domain, observation, both relations and their baselines are specified closely enough to implement without guessing:

- the deterministic shape schedule;
- the three value streams;
- finite-reference screening "chosen from the origin alone";
- declining a function with no comparable case.

The K = 7 pattern makes the exact rejection deterministic (blocked result `1.000000238418579`, f64 reference `1.0000001788139343`, verified).

## Cut

1. "While the pipeline has only exact steps, also require exact origin-to-candidate equality. Once a changed split has been accepted, keep the origin tolerance requirement for the remaining pipeline, including across repeated optimize calls". Inline's exact check against its immediate input, on the same origin-derived cases, already implies the origin check. The extra check and the carried state can go.
2. "Precompute an independent set of equations at compile time, checking full column rank … At call time solve over exact rationals". No corpus program needs this solver.
3. "carry symbolic shape-dependent validity conditions to specialization (e.g. `H-2 >= 0`)". This is a call-time error contract beyond compile errors with `line:col`.
4. "Check identity candidates too, so every reported step has a verdict". A pass that makes no change needs no check.

## Framework changes

- **A synchronous native-pass entry with shared preparation and write enforcement:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It belongs in `define-pass.ts`.
- **Not minimal as specified:**
  - "a versioned descriptor (IR, adapter, writes, synchronous native kernel and required synchronous check)" duplicates `definePass`. Take a `Pass` and refuse `needs` and `preserves`.
  - "call the gate with origin, current and candidate" puts the tensor domain's origin policy into a framework signature. A `(before, candidate) => CheckResult` gate can close over the origin.
- No missed change: nothing calls the async `applyPass` on the read-only adapter.

## Keep

Keep the shape and value schedule, with the half-ULP sequence in storage order. Keep the decision that a nonfinite candidate fails against a finite reference. Keep the mutants (identity-order substitution, `floor(K/4)`), which must produce valid changed artifacts and fail through the actual gate.
