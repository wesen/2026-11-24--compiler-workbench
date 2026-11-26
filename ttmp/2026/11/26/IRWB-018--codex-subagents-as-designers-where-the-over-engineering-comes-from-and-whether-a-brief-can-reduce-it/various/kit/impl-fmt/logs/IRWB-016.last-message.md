Reformatted `main.typed`, `scripts/compare.js`, `project.json`, and `notes.md` under `corpus/projects/f32-dsp/`. All four fit the tile limits, and the butterfly focus still points to line 36.

- `node tools/format-corpus.mjs` reformatted two files. `--check` reported zero pending changes.
- `node --test tests/typed/format.test.mjs` passed all four tests outside the sandbox after the sandbox blocked its nested Node process.
- `node --test --test-isolation=none tests/typed/f32-dsp.test.mjs` passed all three tests.

Commit `e43c9f25e518502dcb0208c901177bce391f614f`. The worktree is clean.