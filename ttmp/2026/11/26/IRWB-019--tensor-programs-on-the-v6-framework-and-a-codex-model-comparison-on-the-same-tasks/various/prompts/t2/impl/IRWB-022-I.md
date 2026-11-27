A reviewer has read your design for IRWB-022-I. The review:

# Review of your design

## Must change

1. **Use the framework's batch and memo.** "Retain a bounded process-local memo of completed semantic verdicts and share one in-flight Promise per identical check", because it "avoids modifying the generic differential loop that Stage 1 uses per case". That loop needs no modification. `DifferentialSpec.decide`, run by `runDifferentialAsync`, receives all undecided indices in one async call, and `baselineKey`/`subjectKey` keep decided verdicts. A second tensor memo duplicates this, and you would maintain its seven-part key by hand. Use `differential`, or name what it lacks.
2. **`gpuMs` includes kernel loading.** "The standalone public runner reports a kernel interval for its own call." Only the benchmark warms up. Under CUDA 13's default lazy loading, the first launch of each kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up.

## Cut

1. "Model the pinned device/compiler configuration as a versioned read-only resource in `MemoryResources`." Nothing writes this resource, and reading it adds effect declarations. The key can carry the profile.
2. "Allow a pinned `--nvcc` path for the contract." The tool already reads `CUDA_REMOTE_NVCC`.
3. "Take a shared GPU lock for ordinary runs". This changes the documented behaviour ("untimed runs do not wait for it") for every user.
4. "Include execution identity in results". Only the memo in Must change 1 uses it.

## Framework and tool changes

- No framework change: acceptable, but the reason given is wrong (see Must change 1).
- `--runtime-input`, kept out of the compile key: needed, minimal, opt-in, correctly placed.
- Per-invocation directory, compile lock, atomic install: needed once the data leaves the key.
- `--nvcc`, the shared lock and the identity field: not needed.

## Keep

Keep the CUDA double `exp`/`log`/`tanh`, rounded once with `__double2float_rn`, under an honest tolerance claim: your probe found no non-NaN word mismatch, and NaN payloads are why you do not claim bit identity. Also keep the index and tail mutation tests.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-I:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
