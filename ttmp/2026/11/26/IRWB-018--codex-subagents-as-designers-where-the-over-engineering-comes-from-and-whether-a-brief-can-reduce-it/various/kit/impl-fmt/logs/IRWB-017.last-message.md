Reformatted `main.typed`, `moves.typed`, `position.typed`, `search.typed`, `scripts/explore.js`, `project.json`, and `notes.md`. Updated `tests/typed/chess-search.test.mjs` for the focus move to assembled line 17 and recorded the fix in the ticket diary and changelog.

The Typed and JavaScript files fit within 80 columns. `project.json` and `notes.md` fit within 72. A before-and-after check confirmed identical r0 and reference RV32 image bytes and verified that the focus and ray links resolve.

- `node tools/format-corpus.mjs` and its `--check` run reported zero changes after the notes were wrapped by hand.
- `node --test tests/typed/format.test.mjs` passed all four tests after rerunning outside the sandbox, which had blocked the nested formatter process.
- `node --test tests/typed/chess-search.test.mjs` passed.

Committed as `7a57fd4`. The worktree is clean.