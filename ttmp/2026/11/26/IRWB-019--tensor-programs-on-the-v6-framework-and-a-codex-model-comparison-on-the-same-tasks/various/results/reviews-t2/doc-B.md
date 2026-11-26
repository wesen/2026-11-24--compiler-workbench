# Review of doc B

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
