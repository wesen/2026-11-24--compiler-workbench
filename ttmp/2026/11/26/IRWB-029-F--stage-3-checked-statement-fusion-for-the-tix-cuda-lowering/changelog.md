# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Implemented the fusion planner (src/tensor/fusion.ts) and the fused row-group and chain kernels in the emitter behind options.fuse (default true). fuse:false verified byte-identical to the stage 2 lowering at the base commit via scripts/01.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-g-h-irwb-029-f/src/tensor/cuda-source.ts — Shared scalar walker plus row-group (shared staging, global fallback) and chain (register forwarding) kernels
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-g-h-irwb-029-f/src/tensor/fusion.ts — Pure fusion planner with refusal reasons

## 2026-11-27

Warp-per-row mapping after the block mapping measured 2x slower on softmax; contractions over row-free operands keep the per-element mapping after mlp's full fusion measured 2.5x slower; generalized register chain covers mlp's epilogue. Final report with kernel counts, benchmark medians, analytic bytes and contract costs.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-g-h-irwb-029-f/ttmp/2026/11/26/IRWB-029-F--stage-3-checked-statement-fusion-for-the-tix-cuda-lowering/reference/02-report.md — Final stage 3 report
