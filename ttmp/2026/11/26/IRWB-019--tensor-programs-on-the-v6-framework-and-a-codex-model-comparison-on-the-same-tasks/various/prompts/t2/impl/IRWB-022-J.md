A reviewer has read your design for IRWB-022-J. The review:

# Review of your design

## Must change

1. **Define exactly when rule 2 applies.** "Where f64 is an unsuitable oracle for the specified f32 evaluation". State that rule 2 applies exactly when rule 1's condition fails: either reference is nonfinite, or `abs(s - r) > budget(r)/2`. As written, the implementation has to guess, and some coordinates may fall under neither rule.
2. **`gpuMs` includes kernel loading.** "Allocate/copy inputs and initialize the CUDA context before timing." Creating the context does not load the kernels. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. A one-case `runTixCuda` has no warm-up, and the fixed API excludes start-up.

## Cut

1. "Give ordinary executable runs a shared GPU lock". This changes the documented behaviour ("untimed runs do not wait for it") for every user. The brief asks only that measurements use `--timed`.
2. "Use a process-local map of active verdict promises to coalesce concurrent calls". No caller of the fixed API needs this.
3. "Count coordinates under each rule in the benchmark report", and "the comparison's maximum errors and coverage". These need f64 references at full size, which means extra full-size interpreter runs beyond the timing table.

## Framework and tool changes

- No framework change: correct. `execute` with an async `ensures`, `decide`, and `baselineKey`/`subjectKey` already batch and replay.
- Standalone-source cache mode: needed, opt-in, minimal, correctly placed.
- Per-invocation directory, build lock and rename: needed once the data leaves the key.
- Shared lock: not needed.

## Keep

Keep comparing against the current revision with both references stored in the cases, and the double-precision `exp`/`log`/`sqrt`/`tanh` rounded once (no non-NaN word mismatch in your probe). Also keep the signed-zero check, and the order-sensitive bit witness tested apart from the tolerance.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-J:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
