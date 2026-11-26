Shortened a comment in [main.typed](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-015/corpus/projects/regex-nfa/main.typed) and wrapped [notes.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-015/corpus/projects/regex-nfa/notes.md) to 72 columns. The workbench focus still points to the `inRange` call on line 85.

- `node tools/format-corpus.mjs` reformatted the notes. The subsequent `--check` found zero pending changes.
- `node --test tests/typed/regex-nfa.test.mjs` passed.
- `node --test tests/typed/format.test.mjs` initially hit a sandbox `EPERM` when spawning Node. The escalated rerun of both test files passed all six tests.

Committed as `649338a`. The worktree is clean.