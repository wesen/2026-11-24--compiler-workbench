# Review of doc I

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
