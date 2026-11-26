Implemented IRWB-020-F Stage 1. [`src/tensor/`](src/tensor/) provides Tix parsing with `line:col` diagnostics, a v6 tensor IR, f32 and f64 evaluators, and checked `inline` and `split-sum` passes. The fixed API is exported from `dist/tensor/index.js`. All six requested fixtures are in [`corpus/tensor/`](corpus/tensor/).

The tests show that exact checking rejects the length-six split-sum witness (`0x3f800001` vs `0x3f800000`), tolerance against the original f64 program accepts it, and both shape-valid mutants fail their semantic gates.

**Framework:** [`src/framework/passes/define-pass.ts`](src/framework/passes/define-pass.ts) adds `applyNativePassSync` and shares native artifact preparation and write checks with the async runner. No changes to `contracts/`.

**Design differences:** No substantive deviations from the [revised design](ttmp/2026/11/26/IRWB-020-F--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-tix-and-checked-tensor-passes.md). As documented there, I retained affine signature binding and concrete bounds checks to support legal signatures beyond the corpus.

| Check | Result |
|---|---:|
| `npm run build` | Passed |
| `node --test tests/tensor/*.test.mjs` | 23 passed |
| `node --test tests/framework/*.test.mjs` | 228 passed |
| `node --test tests/typed/{passes,inline,meaning-memo}.test.mjs` | 18 passed |

Commits: `fceafbe` (review revision), `a021809` (framework), `6e5fee7` (Tix, corpus, tests, and diary). Worktree clean; nothing pushed.
