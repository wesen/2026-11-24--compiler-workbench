IRWB-020-B is complete. `src/tensor/` contains the Tix parser and checker, v6 tensor IR, f32 and f64 evaluators, meaning contract, and checked `inline` and `split-sum` passes. The build exports exactly `compileTix`, `runTix`, and `optimizeTix` from `dist/tensor/index.js`. All six requested programs are in `corpus/tensor/`, with independent numerical checks in `tests/tensor/`.

The seven-element sum demonstrated the intended contract distinction. Sequential f32 returned `1`, blocked f32 returned `1.000000238418579`, and the original f64 reference returned `1.0000001788139343`. The exact gate rejected the split and the tolerance gate accepted it. The same pass runner rejected both deliberately wrong variants.

**Framework finding.** The only framework source change was in `src/framework/passes/define-pass.ts`. The existing runner is asynchronous and opens an edit transaction even for native results. The new `applyNativePassSync` takes an existing `Pass` and a `(before, candidate)` gate. Both runners share native artifact preparation and write enforcement. The tensor domain owns the baseline and tolerance policy.

| Verification | Result |
|---|---|
| `npm run build` | Passed |
| `node --test tests/tensor/*.test.mjs` | All 3 files passed. A second run with `--test-isolation=none` confirmed all 16 individual tests. |
| `node --test tests/framework/*.test.mjs` | All 18 files passed |
| `node --test tests/typed/{passes,program,mutate,strategies}.test.mjs` | All 4 files passed |

**Deviations from the revised design.** The sample work limit counts actual scalar visits and loop iterations during origin evaluation instead of estimating cost beforehand. The synchronous runner also refuses a pass carrying a manager-dependent transformation contract, because its two-artifact gate cannot enforce that contract’s guarantees.

**Commits:** `9b0c3ff` initial design · `4e0b7eb` reviewed design · `1a99a16` framework entry and executable IR · `69bb106` checked rewrites, corpus and tests · `343f7a8` verification and ticket closure. The worktree is clean.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b/ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md) · [Design and framework change ledger](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b/ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-semantics-and-checked-tensor-rewrites.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-am-irwb-020-b/ttmp/2026/11/26/IRWB-020-B--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-implementation-diary.md)