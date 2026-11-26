# Review of doc-N

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
