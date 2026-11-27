Implemented the reviewed Tix-to-CUDA lowering. [`src/tensor/index.ts`](src/tensor/index.ts) exports `cudaSource`, `runTixCuda`, and `checkLowering`. The backend emits one kernel per current Tix statement, preserves sequential reduction order, and preloads kernels before timing. The checked pass batches GPU cases against the original program’s f64 result using the unchanged Stage-1 tolerance.

**Verification:** `npm run build` succeeded. `node --test tests/tensor/*.test.mjs` passed all 24 tests, including all six corpus programs before and after optimization, a rejected CUDA candidate that dropped a reduction tail, and concurrent runs that reused an executable without mixing outputs.

**Measurements:** `node corpus/tensor/benchmark-cuda.mjs` completed all six workloads. GPU medians ranged from **0.171 to 0.976 ms**; f32 interpreter wall times ranged from **44.238 to 962.088 s** on the shared host. See the [per-program timings and methodology](ttmp/2026/11/26/IRWB-022-E--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/02-cuda-verification-and-corpus-timings.md).

**Framework changes:** None. [`tools/cuda-remote.mjs`](tools/cuda-remote.mjs) gained opt-in runtime-data exclusion from the compile key, isolated run directories, and locked atomic executable publication. Untimed locking behavior is unchanged.

**Deviations:** The binary frame groups all dimensions before the payloads so shapes can be validated first. The benchmark fixes five measured repetitions after one warm-up. Both details are documented; there were no other deviations.

Commits: `dc87f19` review revision · `aa14d97` implementation · `04a9da3` verification and timings. Worktree clean.
