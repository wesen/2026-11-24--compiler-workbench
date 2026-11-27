# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Attribution of executed RV32 instructions to pass decisions (src/typed/attribution.ts, Program.attribute); licm merges natural loops that share a head (bytecode VM under speed 9,286 -> 6,382 and 8,218 -> 5,710; regex-nfa faster; no project slower; parity clean). Hoist-once tried and kept as a patch (orders slower with coalesce).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-op-irwb-034-f/src/typed/attribution.ts — the attribution
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-op-irwb-034-f/src/typed/passes.ts — licm loopsByHead
