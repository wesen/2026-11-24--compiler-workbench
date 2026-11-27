The design is committed as `9adde9e`, but the corpus measurement and final report are **not complete**. I can’t provide reliable O2 or `speed` shares yet.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-tl-irwb-035-c/ttmp/2026/11/27/IRWB-035-C--measure-local-value-rewrites/index.md)
- [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-tl-irwb-035-c/ttmp/2026/11/27/IRWB-035-C--measure-local-value-rewrites/design-doc/01-edit-classification-and-corpus-measurement.md)
- [Report placeholder](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-tl-irwb-035-c/ttmp/2026/11/27/IRWB-035-C--measure-local-value-rewrites/reference/02-measurement-report.md)
- [Diary checkpoint](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/a0-tl-irwb-035-c/ttmp/2026/11/27/IRWB-035-C--measure-local-value-rewrites/reference/01-implementation-diary.md)

An uncommitted classifier, test, and measurement scripts are present. The build and an initial targeted classifier test passed, but the classifier changed afterward. The broad test run was interrupted after excessive concurrency loaded the shared machine; a bounded rerun was started. The census must also be rerun because it began before the final classifier adjustment. Attempts to inspect and stop the stale run were stalling, so the tmux jobs may still be running.

No framework files were changed. The rule-citation and rule-match coverage figures remain unmeasured.