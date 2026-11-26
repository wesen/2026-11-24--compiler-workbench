IRWB-020-I is complete. Stage 1 implements Tix parsing and checking with `line:col` diagnostics, a v6 tensor IR, f32 and f64 evaluators, and checked `inline` and `split-sum` passes. The built `dist/tensor/index.js` exports exactly `compileTix`, `runTix`, and `optimizeTix`. [Implementation](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/src/tensor/index.ts) · [Six corpus programs](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/corpus/tensor) · [Tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/tests/tensor)

**Framework changes.** Both changes are in [define-pass.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/src/framework/passes/define-pass.ts). `applyNativePassSync` supports the fixed synchronous API and shares candidate preparation, structural diff, correspondence, and write checks with `applyPass`. The asynchronous runner now opens `ctx.edit` on demand, so native passes can use a read-only IR projection.

**Contract results.** On the eight-term witness, serial f32 produced `0x3f800000` and blocked f32 produced `0x3f800001`. Exact comparison rejected the rewrite. The blocked result matched the original f64 reference and passed tolerance. The contract also rejected an inline that lost a negation and a split that dropped the ninth term.

| Check | Result |
|---|---|
| `npm run build` | Passed |
| `node --test tests/tensor/*.test.mjs` | 19 tests across 3 files passed |
| `node --test tests/framework/*.test.mjs` | All 18 files passed |
| `node --test --test-concurrency=2 tests/typed/{passes,inline,strategies,audit,ssa,parallel,f32,mutate,meaning-memo,rules}.test.mjs` | All 10 files passed |

All four review cuts were adopted. There were no deviations from the revised design. The worktree is clean. [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md) · [Revised design and framework ledger](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-tensor-ir-and-checked-rewrites.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ax-irwb-020-i/ttmp/2026/11/26/IRWB-020-I--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

**Commits:** `312f72c` initial design · `0ed7084` review revision · `ecf9a93` framework runner · `d73d247` language, IR and evaluators · `c6032fa` contract and passes · `8b94514` corpus verification and ticket closure.