Implemented IRWB-020-C. The fixed synchronous API builds to `dist/tensor/index.js`. [Source](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/src/tensor) · [Six-program corpus](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/corpus/tensor) · [Tensor tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/tests/tensor)

On the rounding witness, exact comparison rejected `split-sum` and tolerance accepted it. The same gates rejected the tail-dropping split and the swapped-axis inline.

The sole framework source change adds `applyNativePassSync` so the fixed API can reuse native artifact validation, diffs, correspondence, and declared-write checks with a mandatory synchronous gate. [define-pass.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sm-irwb-020-c/src/framework/passes/define-pass.ts)

**Verification**

- `npm run build` passed.
- `node --test tests/tensor/*.test.mjs` passed all 17 tests across three files.
- `node --test tests/framework/*.test.mjs` passed all 18 files.
- `node --test tests/typed/{passes,inline,meaning-memo,strategies}.test.mjs` passed all four files.
- Prettier and docmgr validation passed.

**Deviations from the revised design** — None. The worktree is clean.

**Commits**

- `4cedbf87af1de21d66b28178712c54d8cca6a7b0` — Revised design
- `ce9cf4d281e6025466b198ea3061fa8edfe76f1a` — Implementation, corpus, tests, and diary