**IRWB-030-B is complete.** On the GB10, inside layernorm ran **2.37× faster** than unfused, and inside attention ran **1.30× faster**. All eight lowerings passed the exact f32 contract, and fused and unfused output digests matched at every full benchmark size.

| Program | Kernels fused / unfused | Fused ms | Unfused ms | Parallel terms |
|---|---:|---:|---:|---|
| matmul | 1 / 1 | 0.214 | 0.213 | None |
| softmax | 1 / 4 | 0.384 | 0.802 | None |
| layernorm | 1 / 4 | 0.187 | 0.478 | None |
| attention | 1 / 6 | 0.753 | 1.048 | None |
| mlp | 1 / 3 | 0.727 | 0.936 | None |
| conv2d | 1 / 1 | 0.166 | 0.166 | None |
| layernorm, inside | 1 / 4 | **0.239** | **0.566** | Mean and variance |
| attention, inside | 2 / 5 | **1.149** | **1.492** | None |

Times are medians of three `benchmark: true` calls per mode at the requested sizes. Matmul and conv2d emit identical source in both modes. The 0.001 ms matmul difference is within measurement noise.

**Term staging.** For a row scalar with one ordinary reduction axis and a costly body, block threads compute independently rounded terms into shared memory. After a barrier, thread zero folds them in the original index order. If the terms would displace existing shared rows, the kernel retains the serial fold.

**Fusion selection.** The planner cuts a legal group before a divided contraction that reads a matrix at `[reduction index, trailing output index]`. This gives inside attention’s output contraction its own grid. On a single-row stress case, forcing fusion took **2.695 ms**. The selected, byte-identical stage-2 lowering took **0.177 ms**. The performance finding applies to the measured shapes and hardware.

**Framework and tools.** Both required zero changes. The existing transformation, differential contract and timed runner supported the implementation. The 280 exact-contract cases took 2.51–4.70 seconds per cold check and 0.65–4.73 ms on replay. All 48 tensor tests passed across the run and a targeted retry after an SSH upload reset. The source-digest tests confirmed `fuse: false` preserves stage 2 byte for byte.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-am-irwb-030-b/ttmp/2026/11/27/IRWB-030-B--ordered-parallel-terms-for-tix-fusion/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-am-irwb-030-b/ttmp/2026/11/27/IRWB-030-B--ordered-parallel-terms-for-tix-fusion/design-doc/01-ordered-term-staging-and-fusion-selection.md) · [Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3b-am-irwb-030-b/ttmp/2026/11/27/IRWB-030-B--ordered-parallel-terms-for-tix-fusion/reference/02-gb10-results-for-ordered-term-staging-and-fusion-cuts.md)

Last commit `86ecf2b103ab6d527719ad8f4c801d55be6b17c8`. The worktree is clean.