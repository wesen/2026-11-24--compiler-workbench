IRWB-020-L is ready for review. The design and diary are committed as `07b209d07950b1b7a53a93282559924c0a755ea8`.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md)
- [Stage 1 design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-stage-1-design-for-tix-tensor-programs.md)
- [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-sx-irwb-020-l/ttmp/2026/11/26/IRWB-020-L--tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

The proposed framework change is `applyNativePassSync` for the fixed synchronous `optimizeTix` API. It shares candidate validation, diffing, correspondence, and write checks with `applyPass`, supports read-only IR projections, and uses the existing differential runner for acceptance.

The build, targeted framework tests, and ticket validation passed. A Node probe confirmed that exact comparison rejects the blocked sum and tolerance against the f64 reference accepts it. Implementation awaits review.