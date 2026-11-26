## 1

I’ll check the LZ project’s line widths, reflow the files, and update the decoder focus before running both requested tests.

## 2

All four LZ files fit their tiles, and the decoder focus now points to line 82. The round-trip test passed. The format suite also passed all four tests after I reran it outside the sandbox, where it could launch the nested formatter.

## 3

Reformatted `corpus/projects/lz-roundtrip/main.typed`, `project.json`, and `notes.md` to fit the Workbench tiles. The decoder focus now points to line 82. `scripts/explore.js` already fit at 73 columns. Updated the IRWB-014 diary and changelog.

- `node tools/format-corpus.mjs` applied formatting. The subsequent `--check` reported zero changes.
- `node --test tests/typed/format.test.mjs` passed all four tests after an out-of-sandbox rerun resolved a nested process permission error.
- `node --test tests/typed/lz-roundtrip.test.mjs` passed.

Commit `5ee005c93a77cbcf8b1b9a4e4534d02851499325`. The worktree is clean.
