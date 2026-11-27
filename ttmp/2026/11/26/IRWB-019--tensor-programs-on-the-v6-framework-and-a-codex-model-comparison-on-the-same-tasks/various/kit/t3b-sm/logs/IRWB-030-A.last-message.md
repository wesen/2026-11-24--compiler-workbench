Implemented [IRWB-030-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-sm-irwb-030-a/ttmp/2026/11/27/IRWB-030-A--ordered-cuda-term-staging-and-fusion-profitability/index.md). The [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-sm-irwb-030-a/ttmp/2026/11/27/IRWB-030-A--ordered-cuda-term-staging-and-fusion-profitability/design-doc/01-ordered-terms-and-fusion-selection.md) was committed before implementation. The [final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-sm-irwb-030-a/ttmp/2026/11/27/IRWB-030-A--ordered-cuda-term-staging-and-fusion-profitability/reference/02-final-report.md) contains the raw measurements and reproduction commands.

CUDA lanes compute eligible costly row-reduction terms into a shared or scratch buffer. After a barrier, thread 0 folds the rounded terms in index order. This stages the `mean` and `variance` sums in inside-division layernorm.

The planner checks legality first. It then keeps the element grid for reduction-free block candidates, costly per-element reductions, and costly row reductions whose terms cannot be staged. Inside attention therefore fuses its three middle statements and keeps its two contractions separate. The rule addresses measured regressions on the GB10. Its timing guarantees are limited to the measured workloads.

| Program | Kernels fused / unfused | GB10 ms fused / unfused |
|---|---:|---:|
| Matmul | 1 / 1 | 0.218 / 0.214 |
| Softmax | 1 / 4 | 0.386 / 0.788 |
| Layernorm, outside division | 1 / 4 | 0.162 / 0.483 |
| Layernorm, inside division | 1 / 4 | 0.221 / 0.549 |
| Attention, outside division | 1 / 6 | 0.753 / 1.050 |
| Attention, inside division | 3 / 5 | 1.369 / 1.523 |
| MLP | 1 / 3 | 0.726 / 0.943 |
| Conv2d | 1 / 1 | 0.166 / 0.166 |

Times are medians of three benchmark calls. Matmul and conv2d emitted identical source in both modes. All eight full-size output pairs matched bit for bit, and the sampled contract accepted all eight as `exact`. The build, 31 CPU tensor tests, and 17 GPU tensor tests passed. `fuse: false` passed the stage-2 source-digest checks.

The existing framework contract and timed runner covered the implementation, so both required zero changes. The worktree is clean.

Last commit `a3cade221ab3030103b2d820619a071083a4f724`.