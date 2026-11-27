Committed as `e17d03c` — **IRWB-028: F5 per-project expectations**.

The changed tests now use a shared [expectation table](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/fix2-tl-irwb-028/tests/typed/corpus-expectations.mjs):

- **`backend.test.mjs`** checks each project’s function count, inconclusive cases, reference agreement and O2/reference image sizes. It also checks that the corpus and table contain the same projects.
- **`passes.test.mjs`** checks each project’s function, total, agreed and inconclusive case counts.
- **`ssa.test.mjs`** checks each project’s function and SSA-get counts, alongside the existing correctness assertions.
- **`tape.test.mjs`** checks each project’s expected identical, checked-address or skipped path.

The tests also retain the book’s figures over the 44 projects present when chapter 13 was published: 70 functions, 6,986 decided cases, 14 inconclusive cases, and image sizes of 5,160 and 7,628 bytes.

To check additions, I copied Blend as a temporary project. The tests first reported the missing row; after adding one copied row, all six affected full-corpus checks passed. The script then restored the table and removed the copy.

Validation: `npm run build` passed. The Typed and workbench suite reported **176 tests: 173 passed, 3 skipped, 0 failed**. The final temporary-project run reported **6 passed, 0 failed**.