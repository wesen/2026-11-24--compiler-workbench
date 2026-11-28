# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Moved the affine forms from src/tensor/model.ts into src/stdlib/affine/forms.ts and made add exact (BigInt coefficients; safe-integer admission unchanged, R3's rounding case fixed); added stdlib/affine/distances.ts (distanceVector, isZero) and rewrote fusion's joinDepth on the distances; model.ts re-exports the library; tests/stdlib/affine.test.mjs

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-affine-g-h-irwb-049-a/src/stdlib/affine/distances.ts — dependence distance vectors and isZero
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-affine-g-h-irwb-049-a/src/stdlib/affine/forms.ts — exact affine forms moved from the Tix model, add now exact
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-affine-g-h-irwb-049-a/src/tensor/fusion.ts — joinDepth rewritten on the library's distances
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-affine-g-h-irwb-049-a/src/tensor/model.ts — its copy deleted, re-exports the library

## 2026-11-27

Ticket closed
