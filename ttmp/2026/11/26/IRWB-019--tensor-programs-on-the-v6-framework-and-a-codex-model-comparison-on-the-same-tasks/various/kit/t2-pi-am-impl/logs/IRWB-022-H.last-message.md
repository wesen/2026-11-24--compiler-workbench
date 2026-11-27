Implemented IRWB-022-H. `dist/tensor/index.js` exports `cudaSource`, `runTixCuda`, and `checkLowering`. The implementation is in `src/tensor/cuda-source.ts`, `cuda-run.ts`, and `cuda-contract.ts`.

All six corpus programs passed the sampled GB10 check against the original f64 reference. The largest observed error used **24.7% of the unchanged stage-1 budget**, in conv2d. The gate rejected a deliberately broken split-sum kernel after accepting the correct candidate.

**Verification:** `npm run build` succeeded. `node --test tests/tensor/*.test.mjs` passed **23/23**, including GPU execution, optimized programs, verdict replay, and wrong-candidate rejection. All six requested full-size CPU and GPU measurements are in the [results report](ttmp/2026/11/26/IRWB-022-H--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/02-gb10-results-and-framework-finding.md).

**Framework and tool changes:** None. The existing async differential checker batches undecided cases and replays verdicts. Generated CUDA preloads kernels with `cudaFuncGetAttributes` before recording timing events. The only reporting deviation from the [revised design](ttmp/2026/11/26/IRWB-022-H--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-lowering-and-checking-one-cuda-translation-unit.md) was collecting numerical margins separately rather than storing them with cached verdicts.

**Commits:** `2e89818` initial design · `15ea177` review revision · `9d8b846` emitter and runner · `e04fade` contract and tests · `0bf5f99` measurements and report. Working tree clean; nothing pushed.
