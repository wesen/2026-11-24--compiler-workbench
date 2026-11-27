Implemented `cudaSource`, `runTixCuda`, and `checkLowering` in `src/tensor/` and verified their exports from `dist/tensor/index.js`. All six corpus functions passed the GB10 contract before and after `inline` and `split-sum`, using the original f64 reference and the stage-1 tolerance. [Revised design](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-checked-cuda-lowering-and-numerical-evidence.md) · [Results](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/02-cuda-lowering-results-and-corpus-measurements.md) · [Diary](ttmp/2026/11/26/IRWB-022-A--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/01-design-diary.md)

| Program | GB10 kernels (ms) | Local f32 interpreter (s) |
|---|---:|---:|
| matmul | 0.250 | 139.604 |
| softmax | 0.510 | 15.800 |
| layernorm | 0.468 | 25.380 |
| attention | 1.003 | 192.660 |
| mlp | 0.925 | 813.613 |
| conv2d | 0.162 | 399.577 |

GPU times are medians of three CUDA event intervals after warm-up. The single-case public API also preloads every kernel before timing. Local times are single wall-clock observations on the shared machine.

**Verification.** `npm run build` passed. `node --test tests/tensor/*.test.mjs` passed all 29 tests. The live contract rejected a compiled candidate with an incorrect output store and replayed evidence for a repeated check.

**Framework and tool changes.** `src/framework/` required no edits. Its existing transformation, async batch, and verdict-reuse APIs covered the lowering. `tools/cuda-remote.mjs` now isolates each run’s files and locks compilation per input hash. Two simultaneous cold-cache calls compiled once and retrieved identical complete outputs.

**Design deviation.** Malformed batches were tested at the binary decoder. Rejection and replay were tested on the real GB10 in place of the proposed fake runner.

**Commits.** `8b56655` initial design · `8404a06` review revisions · `da01eb9` implementation · `ba8474d` verification · `816012a` measurements. The worktree is clean.