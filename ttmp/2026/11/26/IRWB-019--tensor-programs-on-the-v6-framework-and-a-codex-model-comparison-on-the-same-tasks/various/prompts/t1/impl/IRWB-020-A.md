A reviewer has read your design for IRWB-020-A. The review:

# Review of your design

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

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-A:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
