# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design written: the LiveBlock/LiveGraph interface with a required scope (all-blocks vs entry-reachable), the src/stdlib layout with flow/liveness as the first primitive, and the byte-identical argument

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-g-h-irwb-046-b/src/typed/backend/coalesce.ts — second client, the sweep from line 32
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-g-h-irwb-046-b/src/typed/backend/regalloc.ts — first client, intervals() carries the hand-written sweep from line 85

## 2026-11-27

Implemented: stdlib flow/liveness with a required scope, both backend clients on it (hand-written sweeps deleted), tests/stdlib with the primitive and layering tests, the trap-case probe; baselines no differences, suites 496 pass / 0 fail / 8 todo (other steps)

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-g-h-irwb-046-b/tests/stdlib/layering.test.mjs — the admission rule as a source-level import check
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-lib-g-h-irwb-046-b/tests/stdlib/liveness.test.mjs — primitive tests incl. the unreachable trap case under both scopes
