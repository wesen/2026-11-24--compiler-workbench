# Review of doc-O

## Must change

1. **The wrong variants are artifact edits, not pass variants.** The design says "Change an inlined addition to subtraction while keeping the artifact valid" and "Mutate a blocked sum with a fixed extent of seven to stop at four". The brief requires that the contract reject a deliberately wrong *variant of each pass*. Define each wrong variant as a kernel, run it through `applyNativePassSync`, and check it on the contract's generated cases, not as a hand-mutated artifact.
2. **Scope.** "`tests/framework/ext-e3-e6.test.mjs` | Check that a read-only projection supports the new native path…". The brief allows edits to existing framework tests only where the framework change requires them. Put the new tests in a new file.
3. **Which program is the reference across calls.** The design says "`TixProgram` is a v6 `Artifact<TensorIR>`" and "`split-sum` always compares to the pipeline origin's flat f64 evaluation". On a second `optimizeTix` call, the pipeline origin may already be split, so its f64 run is no longer flat. State which program is the tolerance reference, and where it is kept.

## Cut

1. "check that the affine input axes determine every shape name uniquely by rank over the rationals". No corpus program needs this solver.
2. "Discharge remaining shape-dependent access and extent conditions when actual shapes are bound, before indexing". This is a call-time error contract beyond compile errors with `line:col`.

## Framework changes

- **`applyNativePassSync` sharing candidate creation, diff, correspondence and write checks with `applyPass`:** needed, because the fixed `optimizeTix` is synchronous and `applyPass` is async. It is minimal, and correctly placed in `define-pass.ts`. The design does not say whether it takes a `definePass` `Pass`. It should, so that pass metadata is not declared a second time.
- No missed change. Your probe correctly found the `beginEdit` capability error, and the sync path avoids it.

## Keep

- Matching nonfinite references by NaN or signed infinity, instead of failing them. This keeps zero and signed-zero inputs usable.
- The 2⁻²⁵ witness, which separates the two orders (`0x3f800000` against `0x3f800001`, verified).
- One origin-derived suite per call.
