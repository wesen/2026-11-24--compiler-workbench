IRWB-020-V is ready for review. The design and diary were committed as `e1e1bf368323d09dfbc03677fc0f42f2eb564212`. The worktree is clean.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-v3-sm-irwb-020-v/ttmp/2026/11/26/IRWB-020-V--tix-language-tensor-ir-evaluators-contract-and-passes/index.md)
- [Stage 1 design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-v3-sm-irwb-020-v/ttmp/2026/11/26/IRWB-020-V--tix-language-tensor-ir-evaluators-contract-and-passes/design-doc/01-tix-stage-1-design.md)
- [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t1-v3-sm-irwb-020-v/ttmp/2026/11/26/IRWB-020-V--tix-language-tensor-ir-evaluators-contract-and-passes/reference/01-design-and-implementation-diary.md)

The sole proposed framework change extracts synchronous native pass preparation from `applyPass`. Tix would share artifact validation, diffs, correspondence, and declared-write checks with Typed, then use the existing synchronous differential runner for acceptance.

`docmgr doctor` and the baseline build passed. A standalone Node probe confirmed that the split-sum witness changes f32 bits and falls within the proposed f64 tolerance. The commit contains only ticket documentation.