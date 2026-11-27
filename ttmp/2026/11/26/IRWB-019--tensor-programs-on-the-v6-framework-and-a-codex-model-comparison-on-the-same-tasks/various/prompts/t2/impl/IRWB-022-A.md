A reviewer has read your design for IRWB-022-A. The review:

# Review of your design

## Must change

1. **`gpuMs` of `runTixCuda` includes kernel loading.** "Record CUDA start and stop events on the launch stream around the contiguous kernel sequence." Only the benchmark warms up, so a one-case run times kernels that have not been loaded yet. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up, so say how kernels are loaded before the start event.
2. **The engine-change rule cannot fire.** "pinned engine configuration (host, GPU/architecture, toolkit and flags). Scope reuse to a process with a fixed execution environment, refreshing the namespace if the engine changes." Nothing in the design observes the toolkit or the driver: the tool does not report them, and you add no query. Declare these values constants of the checker's version for the life of the process, or name their source.

## Cut

Nothing material.

## Framework and tool changes

- No framework change: correct. `defineTransformation` with a text output, `decide` over all missing indices, and `baselineKey`/`subjectKey` cover the check, as your probe showed.
- Per-invocation directory with a per-hash compile lock: with the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal and correctly placed. Your verification's "distinct program arguments" has no caller in this design.
- No change missed.

## Keep

Keep the short, direct design: the rounding table with literal bits and the JS zero and NaN rules, and the origin f64 reference with the unchanged stage-1 budget (the f32 meaning of every corpus program uses at most 25% of it on the stage-1 cases; my local check). Also keep the references built inside `cases`, and the warm-up plus three intervals in one timed process.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-A:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
