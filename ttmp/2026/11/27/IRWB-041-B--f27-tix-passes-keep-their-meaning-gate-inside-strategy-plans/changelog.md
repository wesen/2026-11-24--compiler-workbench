# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

F27: Tix passes declare their meaning relation; tixAlgorithm keeps the gate inside strategy plans through the bridge's contract options; baselines unchanged

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f27-g-h-irwb-041-b/src/tensor/contract.ts — gateContract wraps meaningGate as an ensures invariant over input/origin/output
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f27-g-h-irwb-041-b/src/tensor/index.ts — optimizeTix uses the declared relation; tixAlgorithm exports the gated strategy algorithm
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f27-g-h-irwb-041-b/src/tensor/passes.ts — TixPass declares the pass's meaning relation (inline exact, split-sum tolerance)
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f27-g-h-irwb-041-b/tests/tensor/r3-tix-in-plans.test.mjs — F27 test un-todoed

## 2026-11-27

Ticket closed
