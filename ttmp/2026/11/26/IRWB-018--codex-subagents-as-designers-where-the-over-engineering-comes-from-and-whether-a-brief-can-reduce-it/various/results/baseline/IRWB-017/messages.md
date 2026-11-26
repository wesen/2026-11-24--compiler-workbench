## 1

I’ll use the docmgr and diary skills to inspect the chess engine and corpus checks, then write and commit the IRWB-017 design.

## 2

The upstream engine already uses explicit stacks for both search and perft. I’ll measure the unchanged source against the workbench’s statement limit so the design can specify concrete pass-check cases.

## 3

The probe found that opening perft at depth 1 takes 20,778 evaluator statements, already over the pass-check limit. A forced-move depth-1 search fits at roughly 12,800 statements. I’ll use that smaller case for pass checks and keep the opening and tactical fixtures for separate oracle and benchmark runs.

## 4

The design, links, and docmgr checks are complete. Git staging hit a read-only worktree index, so I’ll retry the ticket-only staging with elevated filesystem access.

## 5

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-017/ttmp/2026/11/26/IRWB-017--port-chess-search-into-the-corpus/design-doc/01-chess-search-corpus-project.md)
- [IRWB-017 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-017/ttmp/2026/11/26/IRWB-017--port-chess-search-into-the-corpus/)
- Commit `8daa63c80af86ba036c02a4cf7aa59f891fe860d`

The design specifies how to port the existing Typed move generator and explicit-stack alpha-beta search, check chess behavior against perft counts and reference positions, and measure optimization gains in RV32 instructions. A read-only probe found that opening perft at depth 1 exceeds the 20,000-statement pass limit, while a forced-move depth-1 search fits at about 12,800 statements before wrapper overhead. The commit contains only ticket documentation. The worktree is clean, and the commit is local.
