Implemented IRWB-017 in [corpus/projects/chess-search/](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-017/corpus/projects/chess-search). The project includes the Typed alpha-beta search and perft entries, 12 reference positions, a fixture and measurement runner, and a workbench inspector. Added [scoped tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-017/tests/typed/chess-search.test.mjs) and updated the [ticket diary, tasks, and changelog](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-017/ttmp/2026/11/26/IRWB-017--chess-search-corpus-project).

- `npm run build` passed. `node --test tests/typed/chess-search.test.mjs` passed, and a rerun without test isolation reported all four named tests passing.
- `node tools/parity.mjs chess-search --json` accepted 18 changed revisions and agreed on all 200 final cases, with zero rejections or inconclusives.
- The project’s `fixtures.mjs` and `fixtures.mjs measure` commands passed. Opening perft returned 20, 400, and 8,902. The depth-three search found `d6c7` with score 29,997, and all three RV32 images matched the evaluator’s result and guest memory.

| Quiet mate in two | RV32 instructions |
|---|---:|
| r0 | 14,804,396 |
| Checked `speed` with `chains`, `coalesce`, and `homes` | 10,079,349 |
| Reference compiler | 10,827,760 |

Typed requires `state.typed` before the wrapper, so the assembled focus is line 16. The current loaders already support `entries`. The project runner handles the scoped reference comparison because `tools/reference-check.mjs` scans every project even when given an ID.

Committed as `ddfddc3` and `1d01966`. The worktree is clean.