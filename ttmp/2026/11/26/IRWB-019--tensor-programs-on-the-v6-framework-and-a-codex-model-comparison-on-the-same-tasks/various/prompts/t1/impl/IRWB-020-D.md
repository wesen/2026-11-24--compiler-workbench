A reviewer has read your design for IRWB-020-D. The review:

# Review of your design

## Must change

1. **The ramp's scale is undefined.** The design asks for "(a) a positive, nonuniform row-major ramp … Offset the ramp by parameter ordinal" but gives no range. The tolerance is the tightest of all the designs: `1e-6 + 1e-5 * abs(origin64)`. If the ramp grows with the offset, layernorm's `x - mean` cancels, and the origin's own f32 result can miss the bound. A correct `split-sum` would then be rejected. Give the ramp's values (its range and step), and check that the tolerance holds for the origin on them.

## Cut

1. The table row "`inline`: … Also check against the compile-time origin under the relation already established for the chain", plus the handle's "accepted origin relation". Exact agreement with the immediate input, checked on the same origin-derived cases, already implies this.
2. "Solve a remaining coupled system by exact linear elimination, then check all input equations when concrete sizes arrive", and "Bounds depending on concrete sizes can be evaluated when binding shapes". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "An identity candidate keeps the incoming chain relation and is checked under it". A pass that makes no change needs no check.

## Framework changes

- **`applyNativePassSync` with native-candidate preparation extracted from `applyPass`:** needed. The fixed `optimizeTix` is synchronous, while `applyPass` is async and opens an edit eagerly. It belongs in `define-pass.ts`. "The caller can bind the origin in that gate" keeps domain policy out of the framework.
- **"The small pass declaration reuses the existing ID, version, IR, adapter and declared-write fields":** this is a second declaration type next to `definePass`. Take a `Pass` and refuse `needs` and `preserves`.
- No missed change: nothing calls the async `applyPass` on the read-only adapter.

## Keep

- Block size 2, matched to the shape set 1, 3 and 5 and the five-element witness (`0x3fa00000` against `0x3fa00001`, verified). The design reasons explicitly about which extents reassociate.
- Tolerance screening on finite origin f64 outputs, with "never discard a candidate mismatch as inconclusive".

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-020-D:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
