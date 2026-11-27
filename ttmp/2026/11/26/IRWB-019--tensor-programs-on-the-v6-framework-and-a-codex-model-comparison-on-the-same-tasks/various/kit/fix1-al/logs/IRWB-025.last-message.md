IRWB-025 was already complete in this worktree. I verified the three commits and the clean working tree. I made no additional changes or push. The test and GPU results below come from the [ticket diary](ttmp/2026/11/26/IRWB-025--framework-and-tensor-fixes-f14-f19-f20/reference/01-diary.md).

| Fix | Commit | Regression failure before the fix | Files changed |
|---|---|---|---|
| F14 · Tix pass reporting | `64ad12a` | Two whole-step comparisons in `passes.test.mjs` failed. Steps lacked `changed`, and the rejected split lacked the reason `No comparable case for g`. | `src/framework/passes/define-pass.ts`, `src/tensor/index.ts`, `tests/tensor/passes.test.mjs`, and the ticket README, index, changelog, tasks, and diary |
| F19 · Concurrent cold checks | `a48047e` | The counting engine in `cuda.test.mjs` received **two batches** for concurrent checks of the same key. The test also verifies that both callers see the failure and a later check retries successfully. | `src/framework/contracts/differential.ts`, `tests/tensor/cuda.test.mjs`, and the ticket diary |
| F20 · CUDA library linking | `a30c60f` | The `remote runner` test in `cuda-gpu.test.mjs` produced the same build hash with two libraries as it did without either library. | `tools/cuda-remote.mjs`, `tests/tensor/cuda-gpu.test.mjs`, the [cuBLAS probe](ttmp/2026/11/26/IRWB-025--framework-and-tensor-fixes-f14-f19-f20/scripts/01-cublas/main.cu), and the ticket index, changelog, diary, and docmgr close receipt |

The untimed `--link cublas` probe compiled on `manuel@bling`, exited **0**, and matched the CPU product exactly: `[[19, 22], [43, 50]]`.

The final recorded build passed. The framework and tensor run had **258 passed, 0 failed, 0 skipped**, including the GB10 tests.