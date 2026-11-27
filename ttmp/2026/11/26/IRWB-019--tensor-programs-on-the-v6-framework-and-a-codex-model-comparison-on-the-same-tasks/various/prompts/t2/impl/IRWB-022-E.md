A reviewer has read your design for IRWB-022-E. The review:

# Review of your design

## Must change

1. **`gpuMs` includes kernel loading.** "For each case, allocate and transfer before recording the start event." Under CUDA 13's default lazy loading, the first launch of a kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. A one-case `runTixCuda` therefore reports start-up, which the fixed API excludes. Say how kernels are loaded before the start event.
2. "using a fixed block size (e.g. 256)". Fix the number.

## Cut

1. "Add a `--describe` target stamp … Refuse to cache evidence from a different stamp", and the stamp in the subject key. The evidence is process-local, so this adds a remote query to every check.
2. "Use a shared GPU run lock for untimed runs". This changes the tool's documented behaviour ("untimed runs do not wait for it") for every user. The brief asks only that measurements use `--timed`.
3. "use an in-process single-flight map keyed by full check identity". No caller of the fixed API needs this.
4. "Check full-size outputs against current f32 and, for evidence about tolerance, origin f64". These are extra full-size f64 interpreter runs, beyond the timing table. The tolerance concerns the sampled cases.

## Framework and tool changes

- No framework change: correct. Cross-kind `defineTransformation` with `execute`, `decide`, `baselineKey` and `subjectKey` covers the check.
- A runtime-data directory kept out of the compile key: needed, minimal, opt-in.
- Isolated invocation directory, build lock and atomic publication: needed once the data leaves the key.
- `--describe` and the shared lock: not needed.

## Keep

Keep the origin f64 reference with the unchanged stage-1 budget. It has margin: on the stage-1 tolerance cases, the f32 meaning of every corpus program, original and optimized, uses at most 25% of it (my local check). Also keep the single `decide` batch with the references precomputed in the cases, and keep aborting a failed batch without memoizing any verdict.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-E:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
