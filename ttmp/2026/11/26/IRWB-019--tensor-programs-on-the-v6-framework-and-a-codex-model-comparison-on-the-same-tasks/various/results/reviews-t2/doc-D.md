# Review of doc D

## Must change

1. **Benchmark mode is unspecified.** "In benchmark mode only, copy inputs once, launch a warm-up sequence then three measured sequences using the same allocated buffers". The unit has a single `main`. The design never says how this mode is selected (a program argument, or a field in `in.bin`) or whether `cudaSource` emits it. Program arguments are not part of the tool's hash. Specify the switch.
2. **`gpuMs` of `runTixCuda` includes kernel loading.** "`gpuMs` is the elapsed time between events on that stream immediately surrounding the sequence". Outside benchmark mode, nothing loads the kernels before timing. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up.

## Cut

1. "`--describe` below is one cheap identity lookup per check even on replay", and the stamp in the run JSON. The memo is process-local, so an SSH query on every replay buys little.

## Framework and tool changes

- Batch-only `differential` variant: a small, real finding, since today's type forces placeholder `run`/`compare` when `decide` decides everything. Keep it to a spec type with `decide` required and no `run`/`compare`, plus guards on the sync and worker paths. It belongs in `differential.ts`; your tests are right.
- Compiler build and flags in the compile key: fine. `--describe`: not needed.
- Private invocation directory with a per-content compile lock: with the full-input key, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal. Your test uses "different echoed arguments", but nothing in the design passes arguments.

## Keep

Keep the rounding-site table, the origin f64 budget with "do not increase the budget", the single `decide` batch with the references in the cases, failing the batch before memoizing anything, and the mutant submitted through `verifyTransformation`.
