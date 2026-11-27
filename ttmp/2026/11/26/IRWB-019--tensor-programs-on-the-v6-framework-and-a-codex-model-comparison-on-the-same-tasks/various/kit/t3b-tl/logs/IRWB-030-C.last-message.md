**The stage is incomplete:** parallel term computation is implemented and tested, but the planner still fuses every legal group. It does not yet have the requested measured profitability rule, so fusion is not guaranteed to be faster.

For a block-mode row scalar whose whole expression is a single-axis sum with division in its body, threads compute terms into a buffer. After a barrier, thread 0 adds them in the original order. Nested and multi-axis reductions, split bounds, and other expressions retain the serial path. The existing IR legality analysis and unchanged `fuse: false` lowering remain in place.

The table shows the median of three benchmark calls per program; each call itself reports the median of three timed launches. Fused and unfused output digests matched in every call. Some untimed GPU tests overlapped the measurements, so the timings have greater uncertainty than isolated runs.

| Program | Kernels fused / unfused | Fused ms | Unfused ms |
|---|---:|---:|---:|
| matmul | 1 / 1 | 0.214 | 0.218 |
| softmax | 1 / 4 | 0.386 | 0.796 |
| layernorm | 1 / 4 | 0.195 | 0.480 |
| attention | 1 / 6 | 0.754 | 1.051 |
| mlp | 1 / 3 | 0.728 | 0.935 |
| conv2d | 1 / 1 | 0.165 | 0.166 |
| layernorm, inside | 1 / 4 | 0.253 | 0.553 |
| attention, inside | 1 / 5 | 1.412 | 1.499 |

Only the inside-layernorm kernel stages reduction terms: its mean and variance. The other measured block kernels use the existing reduction path. The build, fusion tests, existing GPU fusion tests, and the new exactness GPU test passed. No framework or tool changes were made.

The [ticket](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-tl-irwb-030-c/ttmp/2026/11/27/IRWB-030-C--exact-parallel-reduction-terms-and-fusion-profitability/index.md>), [design](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-tl-irwb-030-c/ttmp/2026/11/27/IRWB-030-C--exact-parallel-reduction-terms-and-fusion-profitability/design-doc/01-parallel-terms-and-fusion-decision.md>), and [partial report](</home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-tl-irwb-030-c/ttmp/2026/11/27/IRWB-030-C--exact-parallel-reduction-terms-and-fusion-profitability/reference/02-final-report.md>) include the evidence and remaining work.

Last commit: `d7a7dd4`.