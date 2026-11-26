## 1

I’ll use the docmgr and diary skills to create IRWB-017, then check the corpus conventions and Typed support before writing and committing the design.

## 2

The Workbench already supports fixed buffer fixtures and entry-scoped checks through `Program`. I also found that the corpus loader doesn’t pass entry lists through yet. The design will flag that small wiring change and distinguish verified Workbench behavior from the upstream chess details that require a port-time audit.

## 3

A small probe passed through the `speed` pipeline, the Workbench RV32 backend, and the reference compiler. It also confirmed that frame arrays need tape ingestion. I’ll use that path for the search stack and keep chess-sized step counts as an implementation acceptance check.

## 4

The design and diary are written, and `docmgr doctor` passed. I’ll verify the document links and staged paths, then commit the ticket.

## 5

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-017/ttmp/2026/11/26/IRWB-017--typed-chess-search-corpus-project/design-doc/01-porting-typed-chess-search-into-the-corpus.md)
- [IRWB-017 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-017/ttmp/2026/11/26/IRWB-017--typed-chess-search-corpus-project/)
- Commit `01cec245035b32d0cac0146c4ee9e47bdad6be54`

The design specifies a single corpus project with legal move generation, perft, and fixed-depth explicit-stack alpha-beta search. It defines the buffer layout, generated cases, independent chess oracles, qualification against the 20,000-statement pass limit, and RV32 instruction measurements. A smoke test verified the required tape ingestion path and agreement with both RV32 images. The worktree-only scope left the upstream engine and host runner for the implementation audit. The commit contains only the ticket documents.
