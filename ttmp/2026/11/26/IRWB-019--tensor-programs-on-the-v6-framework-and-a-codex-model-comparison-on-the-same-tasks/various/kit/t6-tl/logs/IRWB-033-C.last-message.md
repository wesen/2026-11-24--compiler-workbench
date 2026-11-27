**Stage 6 is incomplete.** I committed the design and a tested foundation for a schedule artifact, but did not implement tiled contractions or measure GPU performance.

The initial [schedule IR](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-tl-irwb-033-c/src/tensor/schedule.ts) carries the Tix function and the existing fusion plan. A v6 fusion pass produces a schedule revision with group correspondences and checks that the function is unchanged and the plan matches the existing fusion analysis. The CUDA emitter still makes scheduling decisions, so this is not yet the requested schedule-driven compiler. No framework or tool files changed.

`npm run build` and 22 focused CPU tests passed. No GPU checks or benchmarks were run, so there are no new contraction times, TFLOP/s figures, cuBLAS ratios, or no-regression claims.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-tl-irwb-033-c/ttmp/2026/11/27/IRWB-033-C--schedule-ir-and-exact-tiled-contractions/index.md)
- [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-tl-irwb-033-c/ttmp/2026/11/27/IRWB-033-C--schedule-ir-and-exact-tiled-contractions/design-doc/01-schedule-ir-and-exact-contractions.md)
- [Interim report and outstanding work](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-tl-irwb-033-c/ttmp/2026/11/27/IRWB-033-C--schedule-ir-and-exact-tiled-contractions/reference/02-interim-implementation-report.md)

Last commit: `1f28a18`.