# Review of doc L

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
