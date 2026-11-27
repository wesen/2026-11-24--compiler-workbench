Implemented and closed **IRWB-022-L**. The tensor API now exports `cudaSource`, `runTixCuda`, and `checkLowering`. The backend emits one CUDA kernel per Tix statement and preserves the reduction order of the current program, including after `inline` and `split-sum`. [API](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/src/tensor/index.ts) · [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/ttmp/2026/11/26/IRWB-022-L--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/index.md) · [Revised design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/ttmp/2026/11/26/IRWB-022-L--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/design-doc/01-checking-tix-cuda-lowering-on-the-gb10.md)

**Verification.** `npm run build` passed. `node --test tests/tensor/*.test.mjs` passed **29 of 29 tests**, with none skipped. All six corpus functions passed the origin-f64 tolerance check on the GB10 before and after optimization. The same gate rejected a kernel that dropped a reduction tail. [GPU tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/tests/tensor/cuda-gpu.test.mjs)

| Program | GB10 kernels, ms | Local f32 interpreter, s |
|---|---:|---:|
| matmul | 0.232 | 813.946 |
| softmax | 0.482 | 84.049 |
| layernorm | 0.454 | 98.367 |
| attention | 0.876 | 627.407 |
| mlp | 0.988 | 1,162.685 |
| conv2d | 0.166 | 281.867 |

GPU times are medians of three warmed CUDA-event intervals. Interpreter times are single full runs on the shared host. All six pairs had matching input hashes and output shapes. [Measurement report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/ttmp/2026/11/26/IRWB-022-L--checked-lowering-of-tix-to-cuda-on-the-gpu-machine/reference/02-cuda-lowering-results-and-corpus-timings.md)

**Framework and tool changes.** No framework edits were needed. The existing differential checker batches missing cases and replays their verdicts. The remote runner now isolates simultaneous invocations in private directories while sharing compiled binaries by input hash. The only deviation from the revised design was in verification: the regression measured delegation and replay during a real GPU check instead of using a local counting stand-in. [Checked pass](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/src/tensor/cuda-contract.ts) · [Remote runner](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t2-ax-irwb-022-l/tools/cuda-remote.mjs)

**Commits.** `b82a504` initial design, `196e944` review revision, `4546491` implementation, `ad1502a` GPU regressions, `1971375` GPU measurements, `709f8fb` final report. The worktree is clean.