## 1

I’m using the docmgr and diary skills to open IRWB-020-L. I’ll trace how Typed uses the framework, then write and commit the Stage 1 design for review.

## 2

The framework already supports a custom comparison and uses v6 artifacts for native pass results. I found one API mismatch: `applyPass` and contract verification return promises, while `optimizeTix` must return synchronously. I’ll probe the narrowest way to bridge that gap and verify a rounding case that distinguishes the two relations.

## 3

The probe confirmed a second framework gap. The native pass runner opens an edit before using the pass’s native result, so it rejects a read-only projection. It also confirmed the numeric witness: flat and blocked sums differ by one f32 bit, and the blocked result matches the f64 reference. The design proposes one synchronous native-pass entry point and reuses the existing differential runner.

## 4

IRWB-020-L is ready for review. The design and diary are committed as `07b209d07950b1b7a53a93282559924c0a755ea8`.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md)
- [Stage 1 design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-for-tix-tensor-programs.md)
- [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

The proposed framework change is `applyNativePassSync` for the fixed synchronous `optimizeTix` API. It shares candidate validation, diffing, correspondence, and write checks with `applyPass`, supports read-only IR projections, and uses the existing differential runner for acceptance.

The build, targeted framework tests, and ticket validation passed. A Node probe confirmed that exact comparison rejects the blocked sum and tolerance against the f64 reference accepts it. Implementation awaits review.
