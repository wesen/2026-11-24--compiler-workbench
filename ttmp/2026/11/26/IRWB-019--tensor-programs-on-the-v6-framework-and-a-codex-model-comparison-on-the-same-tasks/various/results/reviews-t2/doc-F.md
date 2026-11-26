# Review of doc F

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
