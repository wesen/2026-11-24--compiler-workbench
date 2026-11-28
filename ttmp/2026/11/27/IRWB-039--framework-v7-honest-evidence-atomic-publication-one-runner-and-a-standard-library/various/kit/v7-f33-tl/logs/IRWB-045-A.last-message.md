**F33 is not implemented.** I created and committed the design, then documented the remaining work. Preservation operations can publish analysis records and resource effects, so they need to participate in the same deferred transaction as the contract and store publication.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f33-tl-irwb-045-a/ttmp/2026/11/27/IRWB-045-A--atomic-pass-acceptance/index.md)
- [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f33-tl-irwb-045-a/ttmp/2026/11/27/IRWB-045-A--atomic-pass-acceptance/design-doc/01-acceptance-boundary.md) — describes the proposed acceptance boundary.
- [Diary and report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-f33-tl-irwb-045-a/ttmp/2026/11/27/IRWB-045-A--atomic-pass-acceptance/reference/01-diary-and-report.md) — records the investigation and unfinished work.
- The other ticket files are docmgr’s generated workspace scaffolding. No framework or test files changed.

`npm run build` passed. The two F33 tests still have their `todo` markers; a filtered test invocation did not establish their results. The baseline check, requested suites, `npm run check`, and site build were not run, so suite pass/fail counts are unavailable. I found no issue with the brief or test assertions.

Last commit: `e804d814baa897303e48d6644b02f46c0acdd2fe`.