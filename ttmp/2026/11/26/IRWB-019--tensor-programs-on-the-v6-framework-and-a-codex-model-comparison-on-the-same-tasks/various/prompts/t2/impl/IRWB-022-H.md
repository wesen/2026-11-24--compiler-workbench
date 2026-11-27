A reviewer has read your design for IRWB-022-H. The review:

# Review of your design

## Must change

1. **Your framework premise is wrong.** "Synchronous `runDifferential` is per case; batching belongs in the domain invariant". `DifferentialSpec.decide`, run by `runDifferentialAsync`, already receives all undecided indices in one async call, and `baselineKey`/`subjectKey` replay decided verdicts. Your replacement is "a versioned async `ctx.analysis` on the CUDA artifact, with canonical JSON parameters encoding the small packet (base64)" in a "Process-local manager". It duplicates that mechanism and keeps up to a megabyte of packets in the analysis records of a long-lived manager. Use `differential` with `decide`, or show what it lacks.
2. **`gpuMs` includes kernel loading.** "Allocate and transfer before recording the start event". Under CUDA 13's default lazy loading, the first launch of a kernel loads its module inside the interval. In my probe on the GB10, a trivial kernel's first interval was 0.115 ms and its second 0.003 ms; after `cudaFuncGetAttributes` the first was 0.004 ms. The fixed API excludes start-up, so say how `runTixCuda` loads kernels before timing.

## Cut

1. "Pin/verify the environment fingerprint at session creation through the tool", and the "lightweight profile query for evidence reuse". The evidence is process-local.
2. "a changed host, nvcc path/version, flags, architecture, driver or protocol starts a new profile/manager". This only matters together with Cut 1.
3. "If concurrent callers share an outstanding invocation, coalesce only identical full keys". No caller of the fixed API needs this.

## Framework and tool changes

- No framework source change: acceptable, but record the corrected finding.
- Isolated invocation directories with a build lock: with the full-input key, two runs collide only if they upload byte-identical directories at the same time. Your coalescing prevents that within one process, so this is needed only across processes. Minimal, but not required.
- Compiler identity and flags in the compile key: fine. Profile query: not needed.

## Keep

Keep the ordinal identifiers, the rounding rules, the origin f64 oracle with the stage-1 budget and the refusal to enlarge it, one remote invocation per check, and the wrong-candidate test through the real gate.

Now do the following in this session:
1. **Revise the design document** according to the review. Where you disagree with a review item, keep your design and state the reason in the document. Record the revision in your diary, and commit.
2. **Implement stage 1 as revised:** `src/tensor/`, `tests/tensor/`, `corpus/tensor/`, and any changes to `src/framework/` your design needs (record each, with its reason). After `npm run build`, the API in the brief must be exported from `dist/tensor/index.js` exactly as specified; implementations are compared on it. Commit at sensible points with messages starting `IRWB-022-H:`, and keep the diary at each significant step.
3. **Check it.** Run your own tests (`node --test tests/tensor/*.test.mjs`; on Node 24 a bare directory argument fails with MODULE_NOT_FOUND). If you changed `src/framework/`, also run `node --test tests/framework/*.test.mjs` and the tests in `tests/typed/` that cover the change. Do not run the full suite (`npm test`): many agents share this machine.
4. **Final message:** what you built (paths); how it was checked (commands and results); the framework changes (file: reason); deviations from the revised design; the commit hashes.
