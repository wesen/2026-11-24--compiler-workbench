# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

bce compares SSA names of index and buffer through copies instead of equal reaching-definition sets (F36); lvn refreshes a seen entry whose value an earlier merge of the same run rebuilt away, instead of replacing a dead id (F38); both d2 todo tests pass, baselines show no differences

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f36-g-h-irwb-042-b/src/typed/passes.ts — bce needs typed.ssa now (nameOf), lvn keeps a replaced-id set per block and refreshes stale entries

## 2026-11-27

lvn's staleness check rewritten: a recorded occurrence is live exactly while its value is still in its statement's tree (the replaced-id sketch missed an ancestor of the recorded value being merged away); corpus-wide second-lvn probe (scripts/04): 0 thrown, 0 rejected, nothing slower
