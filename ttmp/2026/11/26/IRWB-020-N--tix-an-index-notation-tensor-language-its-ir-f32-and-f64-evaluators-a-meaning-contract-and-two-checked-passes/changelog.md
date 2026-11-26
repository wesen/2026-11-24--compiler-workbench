# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Design for stage 1 written (design-doc/01); framework-fit probe found F1 (applyPass needs a rewritable adapter) and F2 (no synchronous checked pass application)

## 2026-11-26

Stage 1 implemented: framework F1+F2 in define-pass.ts, src/tensor (Tix front end, tensor.tix IR, evaluator, exact/tolerance contracts, inline/split-sum + wrong variants), corpus/tensor, tests (tensor 37, framework 228, typed 40 pass)

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-op-m-irwb-020-n/src/framework/passes/define-pass.ts — F1 lazy edit, F2 applyPassSync
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-op-m-irwb-020-n/src/tensor/index.ts — fixed API
