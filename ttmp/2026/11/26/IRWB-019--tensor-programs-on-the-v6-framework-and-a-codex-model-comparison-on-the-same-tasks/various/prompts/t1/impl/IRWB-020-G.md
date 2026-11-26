A reviewer has read your design for IRWB-020-G. The review:

# Review of your design

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

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-G:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
