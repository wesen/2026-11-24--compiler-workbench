Completed IRWB-026 in three local commits. The worktree is clean, and no commits were pushed.

| Fix | Commit | Regression on unfixed code | Files changed |
|---|---|---|---|
| F14 | `3977b0b` | `optimization steps report no-ops and the first rejection reason` failed because steps omitted `changed` and the counterexample reason. The updated composition assertion also failed because the applied step omitted `changed: true`. | `src/tensor/index.ts`, `tests/tensor/passes.test.mjs`, and ticket scaffold files `README.md`, `index.md`, `changelog.md`, `tasks.md`, and `reference/01-diary.md` |
| F19 | `d4f7283` | `the lowering pass shares concurrent batches, replays verdicts and retries transport failures` failed because two concurrent cold checks issued two batches, where one was expected. | `src/framework/contracts/differential.ts`, `tests/tensor/cuda.test.mjs`, and the ticket diary |
| F20 | `6351b92` | `remote runner shares a compile across isolated jobs and invalidates on build input and library changes` failed because adding `--link cublas` produced the same build hash. | `tools/cuda-remote.mjs`, `tests/tensor/cuda-gpu.test.mjs`, and the ticket’s `index.md`, `changelog.md`, diary, and `scripts/01-cublas-probe/main.cu` |

The cuBLAS probe ran on the GB10 with `--link cublas`. `cublasSgemm` matched the CPU result exactly, yielding `[76, 100, 103, 136]` in column-major order. The second run reused the cached binary.

The final `npm run build` succeeded, and the combined framework and tensor run passed **259 tests**, with **0 failures, skips, or cancellations**. [IRWB-026 diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/fix1-sl-irwb-026/ttmp/2026/11/26/IRWB-026--framework-and-tensor-fixes-f14-f19-f20/reference/01-diary.md)