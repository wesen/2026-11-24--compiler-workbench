A reviewer has read your design for IRWB-022-D. The review:

# Review of your design

## Must change

1. **Name the source of each identity field.** "profile identity (host, GPU/arch, compiler build/path/flags, driver)". A CUDA program, including your "tiny tool-run identity probe", can report the device, the driver and the runtime version (13000), but not the `nvcc` build. Your tool change computes `nvcc --version` for its compile key, but the ledger does not put it in the tool's JSON. Either add it there in the same change, or declare the compiler build a constant of the checker's version for the life of the process.

## Cut

1. "identify a profile once per verification session via a tiny tool-run identity probe; verify cold batch metadata matches it." Reuse is "process-local reuse only", so the process already pins the profile. The extra remote compile and run guard only against a toolchain change in the middle of a session.

## Framework and tool changes

- No framework change: correct. `decide` batches the pending indices, `baselineKey`/`subjectKey` replay verdicts, and `verifyTransformation` takes an IR input with a scalar output.
- Per-invocation directory with a build lock and atomic publication: with the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal and correctly placed. Your test's "different program arguments" has no caller in this design.
- `nvcc --version`, flags and length-framed names in the compile key: fine.
- No change missed.

## Keep

Keep the explicit rounding sites, the literal bits, the JS NaN and zero rules, and the origin f64 reference as one end-to-end budget. That budget has margin: on the stage-1 cases, the f32 meaning of every corpus program uses at most 25% of it (my local check). Also keep throwing before returning any verdict on an incomplete batch, and "initialize the context and load kernels before measuring". In my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-D:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
