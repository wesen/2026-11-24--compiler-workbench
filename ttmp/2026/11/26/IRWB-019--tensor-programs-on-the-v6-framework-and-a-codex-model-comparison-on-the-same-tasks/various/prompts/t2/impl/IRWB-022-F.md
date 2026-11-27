A reviewer has read your design for IRWB-022-F. The review:

# Review of your design

## Must change

1. **`gpuMs` includes kernel loading.** "Warm up once, then take three short repetitions". This does not say that the warm-up shares a process with the repetitions, and the one-case `runTixCuda` path has no warm-up at all. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up. State both points.
2. "asynchronously invoke `tools/cuda-remote.mjs` as a Node subprocess with explicit arguments and bounded execution". "Bounded" is undefined. Give the timeout and say what it returns, or drop the word.

## Cut

1. "Report worst observed error/budget ratio on the six full-sized corpus runs", and "Compute full-size f64 comparison errors outside timing". These are extra full-size f64 interpreter runs beyond the timing table, while your tolerance is a claim about the sampled cases.
2. "a short-lived process-local engine epoch … Scope baseline entries to the same epoch as well". The evidence is already process-local, the tool reports no toolchain version that could bump the epoch, and nothing else defines when it changes.
3. "Coalesce identical in-flight checks in the tensor layer and clear on settlement." No caller of the fixed API needs this.

## Framework and tool changes

- No framework change: correct. Two `defineIR` kinds with `execute` and an async `decide` cover the check, as your probe showed.
- Opt-in standalone mode with a per-invocation directory, an executable cached by source digest, and a compile lock: needed, minimal, correctly placed, and the legacy mode is kept.
- No change missed.

## Keep

Keep the current revision's f64 reference with the f32 fallback for nonfinite elements, the explicit rounding table and JS zero rules, one `decide` batch with the references stored in the cases, and the targeted exact-word tests for split order.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-F:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
