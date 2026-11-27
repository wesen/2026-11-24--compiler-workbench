# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Designed fusion as a kernel-plan analysis beside the CUDA emitter: flat and row kernel forms, IR-decided legality rules, fuse option through the fixed API.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/src/tensor/cuda-source.ts — Emitter consumes the plan
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/src/tensor/fusion.ts — New fusion analysis module

## 2026-11-27

Implemented the checked fusion: fusion.ts plan analysis, flat and row emitters, staged inputs, branchless minmax, fuse/benchmark options; verified bit-identical on the GB10 and benchmarked the corpus.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/src/tensor/cuda-contract.ts — Fuse port and artifact payload v2
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/src/tensor/cuda-source.ts — Flat and row emitters, host changes, branchless minmax
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/src/tensor/fusion.ts — Kernel-plan analysis and legality rules
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/tests/tensor/cuda-gpu-fused.test.mjs — GB10 fused checks and fuzz
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t3-gf-h-irwb-029-i/tests/tensor/fusion.test.mjs — Plan and refusal tests
