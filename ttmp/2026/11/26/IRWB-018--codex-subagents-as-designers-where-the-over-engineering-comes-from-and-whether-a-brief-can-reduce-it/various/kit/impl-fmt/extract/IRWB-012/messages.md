## 1

I’ll check which Bytecode VM lines exceed the tile limits, reflow them, and verify that the source focus still points to the opcode fetch. Then I’ll run the format test and the VM test.

## 2

The Bytecode VM files now fit the tile limits, and the focus still points to line 10. The format test passed its width assertion, then hit a sandbox error when it tried to launch the formatter subprocess. I’ll rerun it with subprocess access.

## 3

Reformatted [project.json](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/project.json), [notes.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/notes.md), and [scripts/explore.js](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/scripts/explore.js). All Bytecode VM files fit their tile limits. The source focus still points to the opcode fetch on line 10.

- `node tools/format-corpus.mjs` formatted two files. The subsequent `--check` passed with zero pending changes.
- `node --test tests/typed/format.test.mjs tests/typed/bytecode-vm.test.mjs` passed all seven tests after rerunning with subprocess access.

Committed as `85e29a4`. The worktree is clean.
