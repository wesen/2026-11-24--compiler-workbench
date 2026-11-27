Completed [IRWB-029-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-sm-irwb-029-a/ttmp/2026/11/26/IRWB-029-A--checked-tix-cuda-fusion/index.md). The [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-sm-irwb-029-a/ttmp/2026/11/26/IRWB-029-A--checked-tix-cuda-fusion/design-doc/01-order-preserving-cuda-fusion.md) was committed before implementation. The [final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-sm-irwb-029-a/ttmp/2026/11/26/IRWB-029-A--checked-tix-cuda-fusion/reference/02-checked-fusion-results.md) includes per-kernel traffic estimates and measured contract costs.

Fusion lives in CUDA lowering. A planner proves thread or row ownership from the Tix IR before emission, so intermediate values can stay in registers or shared memory while each reduction retains its sequential order. Attention’s final value contraction and MLP’s second contraction remain separate kernels. The existing exact GPU contract and timed runner covered this path without changes to `src/framework/` or `tools/cuda-remote.mjs`.

| Program | Unfused kernels | Unfused ms | Fused kernels | Fused ms |
|---|---:|---:|---:|---:|
| matmul | 1 | 0.2174 | 1 | 0.2175 |
| softmax | 4 | 0.7967 | 1 | 0.3732 |
| layernorm | 4 | 0.4640 | 1 | 0.1695 |
| attention | 6 | 1.0537 | 2 | 0.7754 |
| mlp | 3 | 0.9310 | 2 | 0.8554 |
| conv2d | 1 | 0.1653 | 1 | 0.1673 |

All six full-size fused outputs matched their unfused output digests. The build, 23 local tensor tests, 13 GB10 tests, and 12 randomized exact checks passed. The exact contract rejected a fused kernel with its sum order reversed.

Last commit `fcef95916feb3e129ed142af9cba54e49381f2a7`. The worktree is clean.