IRWB-022-J is complete. [The tensor API](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sm-irwb-022-j/src/tensor/index.ts:53) exports `cudaSource`, `runTixCuda`, and `checkLowering`. It lowers original and optimized Tix functions directly to CUDA C, preloads kernels before timing, and checks each generated function in one remote batch per cache miss.

The [remote tool](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sm-irwb-022-j/tools/cuda-remote.mjs) now supports opt-in source caching, serialized builds, and isolated run directories. **No framework files changed.** The existing v6 transformation and async differential checker handled acceptance and verdict reuse.

`npm run build` passed, and `node --test tests/tensor/*.test.mjs` passed all **33 tests**. The GB10 checks covered all six corpus programs, the distinct result bits of ordered and split reductions, and rejection of a deliberately incorrect CUDA candidate.

| Program | GB10 kernel median (ms) | Stage 1 f32 interpreter (s) |
| --- | ---: | ---: |
| matmul | 0.246 | 177.804 |
| softmax | 0.938 | 17.333 |
| layernorm | 0.816 | 27.367 |
| attention | 1.119 | 209.486 |
| mlp | 1.087 | 828.263 |
| conv2d | 0.162 | 394.405 |

The benchmark used one full-size CPU trial per workload instead of the three planned because the interpreter runs were long on the shared machine. Each GPU median uses five trials. [Verification report and raw timings](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-sm-irwb-022-j/ttmp/2026/11/26/IRWB-022-J--lowering-tix-to-cuda-checked-on-the-gpu-machine/reference/02-cuda-verification-and-corpus-timings.md)

Commits are `7076326` for the design revision, `daa175f` for implementation and tests, and `dcc3de3` for verification and timings. The worktree is clean.