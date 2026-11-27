A reviewer has read your design for IRWB-022-G. The review:

# Review of your design

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

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-G:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
