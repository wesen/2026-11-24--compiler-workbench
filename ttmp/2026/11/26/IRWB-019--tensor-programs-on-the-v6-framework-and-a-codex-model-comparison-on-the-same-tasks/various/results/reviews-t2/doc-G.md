# Review of doc G

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
