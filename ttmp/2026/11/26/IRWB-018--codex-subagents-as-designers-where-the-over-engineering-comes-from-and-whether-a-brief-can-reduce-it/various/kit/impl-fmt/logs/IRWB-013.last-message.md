Reflowed [main.typed](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-013/corpus/projects/sha-chacha/main.typed) to 75 columns and [explore.js](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-013/corpus/projects/sha-chacha/scripts/explore.js) to 71. The SHA compression-loop focus still points to line 43.

- `node tools/format-corpus.mjs` and `node tools/format-corpus.mjs --check` both passed with zero changes.
- `node --test tests/typed/format.test.mjs` passed all four tests on rerun with subprocess permission. The first run hit a sandbox `EPERM`.
- `node --test tests/typed/sha-chacha.test.mjs` passed.

Commit `48a8c52` — `IRWB-013: fit SHA-256 and ChaCha20 files in workbench tiles`. The worktree is clean.