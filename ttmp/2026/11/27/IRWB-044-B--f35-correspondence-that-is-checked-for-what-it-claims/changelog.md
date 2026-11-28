# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design: coverage vocabulary (partial/sourceTotal/targetTotal/bothTotal, default bothTotal), the one-directional consistency rule against the structural diff's id-level classification, and what each existing requirement declares

## 2026-11-27

Implemented F35: CorrespondenceCoverage on requirements (default bothTotal), coverage check in the transaction verify, one-directional diff-consistency check in validateCorrespondence; kernels requirement declares targetTotal; F35 todo removed

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-g-h-irwb-044-b/src/framework/contracts/analysis-manager.ts — Coverage and consistency checks
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-g-h-irwb-044-b/src/framework/contracts/types.ts — Coverage vocabulary
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f35-g-h-irwb-044-b/src/tensor/cuda-contract.ts — kernels is targetTotal
