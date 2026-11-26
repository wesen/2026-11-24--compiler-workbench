IRWB-020-D is complete. The [Tix domain](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/src/tensor) implements parsing, shape and index checking, a v6 IR artifact, f32 and f64 evaluation, and checked `inline` and `split-sum` passes. The build exports exactly `compileTix`, `runTix`, and `optimizeTix`. All six requested programs are in the [tensor corpus](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/corpus/tensor).

**Framework change.** [src/framework/passes/define-pass.ts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/src/framework/passes/define-pass.ts) adds `applyNativePassSync` so the synchronous optimizer can check a native revision without opening a graph edit. It takes an existing `Pass`, shares candidate preparation and declared-write checks with `applyPass`, and skips the gate for unchanged revisions.

**Contract results.** On the five-element witness, `split-sum` changed the f32 result from `0x3fa00000` to `0x3fa00001`. Exact comparison rejected it and tolerance against the original f64 program accepted it. The contract also rejected both faulty rewrites. All 697 original corpus ramp outputs met the tolerance. Layernorm’s worst error used 0.64% of its allowance.

| Check | Result |
|---|---|
| `npm run build` | Passed |
| `node --test tests/tensor/*.test.mjs` | All 3 files passed, 29 tests confirmed individually |
| `node --test tests/framework/*.test.mjs` | All 18 files passed |
| `node --test tests/typed/passes.test.mjs tests/typed/strategies.test.mjs` | Both files passed |

The implementation follows the [revised design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/ttmp/2026/11/26/IRWB-020-D--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-for-the-tix-tensor-domain.md) without deviations. The [diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-ah-irwb-020-d/ttmp/2026/11/26/IRWB-020-D--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-design-and-implementation-diary.md) records the review decisions and measurements.

Commits in order: `2e6222e` initial design, `e96f096` reviewed design, `0ae3433` framework runner, `5358570` Tix domain and corpus, `216faa0` final verification. The worktree is clean.