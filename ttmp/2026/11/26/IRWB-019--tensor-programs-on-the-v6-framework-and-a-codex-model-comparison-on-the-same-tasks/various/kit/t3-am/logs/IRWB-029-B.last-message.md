Implemented checked fusion in the CUDA emitter. Fusion lives there because it changes where intermediate values are stored and which threads compute them. The existing Tix IR already specifies every rounding point and reduction order.

Both lowering modes passed the sampled **exact** GPU contract on all six corpus programs. At full benchmark sizes, every fused output matched its unfused output byte for byte. All 23 local tensor tests and 13 GB10 tests passed.

| Program | Unfused kernels | Unfused ms | Fused kernels | Fused ms | Speedup |
|---|---:|---:|---:|---:|---:|
| matmul | 1 | 0.2155 | 1 | 0.2136 | — |
| softmax | 4 | 0.8041 | 1 | 0.3628 | 2.22× |
| layernorm | 4 | 0.4869 | 1 | 0.2355 | 2.07× |
| attention | 6 | 1.0483 | 3 | 0.8146 | 1.29× |
| mlp | 3 | 1.0539 | 2 | 0.8676 | 1.21× |
| conv2d | 1 | 0.1669 | 1 | 0.1649 | — |

Times are locked GB10 medians of three runs after warm-up. Matmul and conv2d emitted identical source in both modes. Softmax reached 2.22× against the measured baseline, below the earlier prototype’s 4.25×.

**Framework and remote tool changes:** none. Existing correspondence supports many statements mapping to one kernel, and the CUDA source artifact identifies the exact candidate checked. The public runner now exposes the existing benchmark timer and lock. The report includes per-kernel read and write counts and their streaming equivalents at 244 GB/s.

[Ticket IRWB-029-B](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-am-irwb-029-b/ttmp/2026/11/26/IRWB-029-B--checked-cuda-fusion/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-am-irwb-029-b/ttmp/2026/11/26/IRWB-029-B--checked-cuda-fusion/design-doc/01-order-preserving-fusion.md) · [Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-am-irwb-029-b/ttmp/2026/11/26/IRWB-029-B--checked-cuda-fusion/reference/02-fusion-results.md)

Last commit `a437618c7a23d1826049aeff12bd41f514f5b5e9`. The worktree is clean.