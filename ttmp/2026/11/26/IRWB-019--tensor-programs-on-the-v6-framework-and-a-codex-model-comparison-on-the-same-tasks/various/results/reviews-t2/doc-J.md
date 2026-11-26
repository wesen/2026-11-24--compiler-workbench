# Review of doc J

## Must change

1. **Warm up inside the timed process, including in `runTixCuda`.** "Run an untimed warm-up, then three short measured GPU executions under `--timed` … A batch can carry the repetitions." For one-case runs: "Keep allocations, … process startup and context creation outside the events." Under CUDA 13's default lazy loading, the first launch of each kernel in a process loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. Put the warm-up and the three intervals in one batch, and load the kernels before the start event in `runTixCuda`.
2. **Say which tag you compare.** "verify its device/compiler tag on a cold batch before storing verdicts". The executable can report the device and the runtime version (13000), but not "nvcc 13.0.88", and the tool's JSON has no compiler identity. Name the fields you compare, and treat the rest as constants of the checker's version.

## Cut

Nothing material.

## Framework and tool changes

- Batch-only overload in `differential.ts`: a small, real finding. Keep it to a spec type with `decide` required, plus a guard on the sync and worker paths. That is the right place, and your focused test is right.
- Per-invocation directory with a compile lock: with the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal. The justification "two legitimate calls with identical files and different program arguments" has no caller here.
- No change missed.

## Keep

Keep the origin f64 reference with the unchanged stage-1 budget (on the stage-1 cases, the f32 meaning of every corpus program uses at most 25% of it; my local check), the fixed count of 15, and one `decide` batch per miss group. Also keep the word-level split witness and the dropped-tail mutant run through the real postcondition.
