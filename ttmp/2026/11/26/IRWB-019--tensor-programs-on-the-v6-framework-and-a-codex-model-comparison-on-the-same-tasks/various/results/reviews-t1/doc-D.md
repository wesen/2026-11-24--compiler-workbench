# Review of doc-D

## Must change

None found. The domain, observation, both relations, the baselines, the deterministic shapes and value patterns, and the treatment of `f32[1]` parameters are specified well enough to implement without guessing. The motif `[1,0,0,0,2^-24,2^-24,0,0]` at K = 8 deterministically makes `exact` reject `split-sum` (I verified `0x3f800000` against `0x3f800001`).

## Cut

1. "Also check the candidate against the compiled origin using exact comparison until the first accepted reassociation and tolerance thereafter", together with the program's "accepted origin relation". Exact agreement with the immediate input, on the same origin-derived cases, already implies the origin check. The extra check and its state add nothing.
2. "Exact rational elimination covers signatures such as `f32[N+M,N-M]` with no bare anchor", and "At call time solve those same equations … and check redundant equations". No corpus program needs this. It adds a call-time error contract beyond compile errors with `line:col`.
3. "Symbolic restrictions that depend on call sizes describe the legal shape domain … Use these restrictions when instantiating check cases". This is a second constraint representation that exists only for item 2. Case generation can instantiate dimensions and drop illegal shapes directly.
4. "Verify an identity candidate under the already accepted origin relation". A pass that changes nothing needs no check.

## Framework changes

- **`applyNativePassSync(pass, before, verify)` taking a `definePass` pass, with shared native-candidate preparation:** needed, because the fixed `optimizeTix` is synchronous. It is minimal and in the right file. Binding the origin inside `verify` keeps domain policy out of the framework.
- **Lazy `ctx.edit`:** needed. I confirmed that the `Edit` constructor throws `ir.capability` without `rebuild`, and your sync/async structural comparison runs `applyPass` on a read-only adapter. It is minimal and correctly placed.
- No missed change.

## Keep

Keep the precise shape schedule (1, 8, 9, then 3/5/9) and the value patterns, including positive values for `f32[1]` so that layernorm's eps is valid. Also keep the per-pass baselines: exact against the input, and tolerance against the origin's f64.
