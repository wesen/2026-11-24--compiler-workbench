# Review of doc K

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
