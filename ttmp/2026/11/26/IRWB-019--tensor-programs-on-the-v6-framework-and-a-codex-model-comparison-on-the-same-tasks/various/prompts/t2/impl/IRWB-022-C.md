A reviewer has read your design for IRWB-022-C. The review:

# Review of your design

## Must change

1. **`gpuMs` includes kernel loading, and the warm-up is unspecified.** "Allocate buffers and copy inputs before recording a start event", and for the benchmark, "Run one warmup and a few repeats". Under CUDA 13's default lazy loading, the first launch of each kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. A one-case `runTixCuda` therefore reports start-up, which the fixed API excludes. Load the kernels before the start event, run the warm-up in the same process as the repeats, and fix "a few".
2. "one 1D launch of fixed blocks (e.g. 128 threads)". Fix the number.

## Cut

1. "a versioned read-only engine profile (`MemoryResources`, declared read in the invariant and transformation)". The `subjectKey` already carries these values. The resource adds effect declarations, and nothing ever writes a new revision of it.
2. "A small in-flight map keyed by the same complete pass identity shares concurrent identical checks". No caller of the fixed API needs this.

## Framework and tool changes

- No framework change: correct. Scalar ports with `execute`, `decide`, and `baselineKey`/`subjectKey` cover the batch and the replay.
- Opt-in `--cache-main`, which hashes the source apart from the case data: needed, minimal, correctly placed, and the default mode is kept.
- Per-invocation directory with a build lock and publication by rename: needed once the data leaves the key.
- No change missed.

## Keep

Keep the CUDA double `exp`/`log`/`tanh` and `__dsqrt_rn`, each rounded once, and the error argument for the budget ("about 336 f32 unit roundoffs"). Also keep comparing against the immediate revision with the f32 secondary oracle for nonfinite and zero-sign cases, and the separate exact witnesses for order and FMA.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-C:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
