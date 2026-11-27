IRWB-022-B is complete. The build exports `cudaSource`, `runTixCuda`, and `checkLowering` from `dist/tensor/index.js`. The backend lowers original and optimized Tix to one CUDA kernel per statement with sequential reductions. The remote tool separates runtime inputs from its compile cache and isolates concurrent jobs. [CUDA API](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sx-irwb-022-b/src/tensor/cuda.ts) · [Emitter](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sx-irwb-022-b/src/tensor/cuda-source.ts) · [Remote tool](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sx-irwb-022-b/tools/cuda-remote.mjs)

`npm run build` succeeded, and `node --test tests/tensor/*.test.mjs` passed all **26 tests**. All 30 corpus variants passed the direct f64 tolerance on the GB10. The worst sampled error used **24.67%** of the allowance. The implementation follows the revised design, with zero framework edits.

| Program | GB10 kernels (ms) | Local f32 interpreter (s) |
|---|---:|---:|
| matmul | 0.242 | 176.436 |
| softmax | 0.906 | 15.211 |
| layernorm | 0.681 | 25.442 |
| attention | 0.878 | 197.902 |
| mlp | 0.979 | 819.716 |
| conv2d | 0.201 | 390.126 |

GPU times are medians of five CUDA-event measurements after warm-up. CPU times are single wall-clock readings on the shared machine. Both used identical inputs at the requested sizes. [Verification and timing report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sx-irwb-022-b/ttmp/2026/11/26/IRWB-022-B--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/02-cuda-verification-and-corpus-timings.md)

Commits are `4a00e67` for the revised design, `aafb9f6` for implementation, and `6685804` for final verification and timings. The worktree is clean.