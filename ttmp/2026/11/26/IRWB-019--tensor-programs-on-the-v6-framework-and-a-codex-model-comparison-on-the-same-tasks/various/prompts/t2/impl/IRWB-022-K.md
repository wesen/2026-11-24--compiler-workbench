A reviewer has read your design for IRWB-022-K. The review:

# Review of your design

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

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-K:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
