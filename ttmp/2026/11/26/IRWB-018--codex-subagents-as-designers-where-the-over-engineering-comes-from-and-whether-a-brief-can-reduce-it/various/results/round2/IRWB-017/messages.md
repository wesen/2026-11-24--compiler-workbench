## 1

I’ll use the docmgr and diary skills to create IRWB-017, inspect the corpus and the read-only chess source, and verify the design’s assumptions with small probes before committing the ticket.

## 2

The four upstream engine files ingest under the current Workbench front end. The probes found two integration constraints: ordinary projects check internal helpers as standalone functions, and several standard positions exceed the 20,000-statement limit at perft depth one. I’ll use those results to define the checked entries and size their inputs.

## 3

The depth-three mate fixture agreed across the evaluator, the reference image, and the Workbench images. The generated pass cases also finished within the existing limit. The design now records both workloads and the small entry-metadata change, and I’m checking the ticket contents before committing.

## 4

- [IRWB-017 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-017/ttmp/2026/11/26/IRWB-017--chess-search-corpus-project/index.md)
- [Chess search design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-017/ttmp/2026/11/26/IRWB-017--chess-search-corpus-project/design-doc/01-port-the-typed-chess-engine-into-the-optimization-corpus.md)
- Commit `7c2d38972f89cb2dadb1c05e3ea7adc75a3e362b`

The design specifies how to port the existing Typed alpha-beta search and perft into one corpus project, with generated cases sized for the 20,000-statement pass limit and a small loader change to scope checks to the two public entries. Probes confirmed that the bounded cases fit and that the depth-three mate fixture agreed across the evaluator and RV32 images. The commit contains only the ticket documentation.
