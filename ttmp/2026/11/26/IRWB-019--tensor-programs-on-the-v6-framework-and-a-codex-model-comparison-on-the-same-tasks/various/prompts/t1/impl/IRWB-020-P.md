A reviewer has read your design for IRWB-020-P. The review:

# Review of your design

## Must change

1. **Definition identity on the manager path.** "`tensorContract(relation, domain)`: a `TransformationDefinition`…" and the test "`optimizeTix` and `applyPass` with `tensorContract` agree". `ContractRegistry.register` throws "cannot be redefined" for a second object with the same id@version, and `applyPass` turns any throw from `verifyTransformation` into `contractRejected`. If each call builds a fresh object, you get a false rejection. Say that each factory returns one cached object per parameter set, as Typed's `meaningKept` does.
2. **Case encoding in evidence.** "A case is `(function, shape binding, inputs)`", and no `describeCase` is given. On the manager path, counterexamples pass through `immutable`, which throws on typed arrays and non-finite numbers. A rejection would then carry the wrong reason. Specify a JSON-safe `describeCase`.

## Cut

1. "`optimizeTix(program, passes, options?: { relation?…; count?; seed? })`". This adds a second checking mode to the public API. Tests can show `exact` rejecting `split-sum` through `checkMeaning` or `applyPass` with `tensorContract`.
2. "Pass names are `inline`, `split-sum`, `wrong-inline` and `wrong-split-sum`". Keep the wrong variants out of the public table (your open question 2).
3. "A caller of the contract can give a parameter its own range". Only one corpus test uses this knob, and `optimizeTix` cannot pass it. The test would therefore check a domain the API never checks.

## Framework changes

- **F1 `applyPassSync`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal and in the right file. Drop `store?`. With a native result and a store, `openIR(after, adapter, store)` throws `ir.unpublished`, because the store already holds a head for the same artifact id. Make `check` required: an `optimizeTix` step without it is unchecked.
- **F2 lazy `edit`:** needed. I confirmed that the `Edit` constructor throws `ir.capability` without `rebuild`, and your async parity test applies `applyPass` to that adapter. It is minimal and correctly placed.
- No missed change.

## Keep

Keep the running-error-bound tolerance, with its measured separation between correct and wrong programs. Also keep the two baselines (exact against the input, tolerance against the origin's f64) and `TixProgram { origin, current }`, which carries r0 across calls.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-P:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
