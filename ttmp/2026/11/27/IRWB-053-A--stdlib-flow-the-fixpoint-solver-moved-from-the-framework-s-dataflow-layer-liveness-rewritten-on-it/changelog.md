# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

The fixpoint solver moved to stdlib/flow/solve (framework re-exports it); liveness rewritten on it over the set lattice, the all-blocks scope carried by fake entry-edges mapped to bottom; equal corpus speed on the interleaved A/B, baselines no differences

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-solver-g-h-irwb-053-a/src/stdlib/flow/liveness.ts — The hardcoded backward sweep deleted, results identical
