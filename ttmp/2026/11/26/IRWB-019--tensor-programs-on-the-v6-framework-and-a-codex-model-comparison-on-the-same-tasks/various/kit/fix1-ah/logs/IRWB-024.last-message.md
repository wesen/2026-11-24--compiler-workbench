IRWB-024 was already complete in this worktree. I verified the three commits and their regression tests against the [ticket diary](ttmp/2026/11/26/IRWB-024--framework-and-tensor-fixes-f14-f19-f20/reference/01-implementation-diary.md). The worktree is clean. I made no additional commits or push.

| Fix | Commit | Regression before the fix | Files changed |
|---|---|---|---|
| F14 | `ba86419` | In `passes.test.mjs`, three assertions failed. An applied split and a repeated no-op both returned only `accepted: true`. The composed inline step also lacked `changed`, and a rejected split omitted its first counterexample’s reason. | `src/tensor/index.ts`, `tests/tensor/passes.test.mjs`, ticket README, index, changelog, tasks, and diary |
| F19 | `a2a8492` | In `cuda.test.mjs`, two concurrent cold checks submitted **2 batches instead of 1**. The regression also verifies that both callers see a shared failure and that the next check retries successfully. | `src/framework/contracts/differential.ts`, `tests/tensor/cuda.test.mjs`, ticket tasks and diary |
| F20 | `6089017` | In `cuda-gpu.test.mjs`, the remote link test exited **97** with an undefined reference to `cublasSgemm_v2` despite `--link m --link cublas`. After the fix, both library orders linked and produced distinct cache keys. | `tools/cuda-remote.mjs`, `tests/tensor/cuda-gpu.test.mjs`, ticket probe `scripts/01-cublas-product/main.cu`, index, changelog, tasks, diary, and docmgr close record |

**cuBLAS probe.** The recorded untimed run on `manuel@bling` exited **0**. `cublasSgemm` returned `[[19, 22], [43, 50]]`, matching the CPU computation at all four entries.

**Final pre-commit validation.** On Node 24.18.0, `npm run build` succeeded. Framework tests passed **227/227** and tensor tests passed **33/33**, for **260 passed, 0 failed, 0 skipped**. These are the recorded results from before `6089017`.