# Review of doc-J

## Must change

1. **Layernorm can fail tolerance.** "signed generated epsilon may make a layernorm tolerance case nonfinite and reject", with "Reject nonfinite results for this relation". A correct `split-sum` on a corpus program would then be rejected. Constrain eps, or define how a non-finite origin reference is handled.
2. **No origin across calls.** "`TixProgram = Artifact<TensorModule>`" cannot carry the compiled program, yet the design says "Every reassociating step checks the same original f64". State where the original lives when `optimizeTix` receives an optimized program.
3. **`inline` is narrower than the brief.** "The load must give a full-axis bijection of plain, distinct consumer indices". The brief's `inline` substitutes any single-use pointwise statement into its consumer, which includes affine reads such as `t[i+1]`. Align the rule with the brief.
4. **Contradictory coverage rule.** "At least one decided case is required **per function**" conflicts with "If no shape with decided cases exists for any function, reject the changed candidate". Pick one.
5. **Case selection.** "keep up to eight valid tuples, favoring distinct/tail sizes" does not define the selection, so the implementer must invent it.

## Cut

1. "Use integer/rational arithmetic with `BigInt` internally … solve the exact equations on a call" and "retain shape-dependent bounds as call-entry predicates". No corpus program needs this, and it adds a call-time error contract beyond compile errors with `line:col`.

## Framework changes

- **`applyPassSync` with shared native preparation:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is correctly placed in `define-pass.ts`.
- **`contracts/` "new `pure-sync.ts`" and "Factor reusable named-port and check-result validation out of the manager":** not needed. Without `decide`, a differential invariant's `check` is already synchronous, and `runDifferential(differentialSpec(inv), ports)` gives the verdict a `CheckResult` gate needs. Refactoring the manager for this change is not minimal.
- No missed change.

## Keep

Keep the length-8 witness in the contract fixtures (`0x3f800002`, equal to f64, verified). Keep the negative controls, which assert that the meaning gate caused the rejection, and the exact-then-tolerance argument by induction.
