Reformatted [project.json](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/project.json), [notes.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/notes.md), and [scripts/explore.js](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm/scripts/explore.js). All Bytecode VM files fit their tile limits. The source focus still points to the opcode fetch on line 10.

- `node tools/format-corpus.mjs` formatted two files. The subsequent `--check` passed with zero pending changes.
- `node --test tests/typed/format.test.mjs tests/typed/bytecode-vm.test.mjs` passed all seven tests after rerunning with subprocess access.

Committed as `85e29a4`. The worktree is clean.