**Recommendation: one pass runner with two drivers.** `analyseSync` is a seven-line entry point that shares the manager’s cache, validation, record construction, and history with `analyse`. The measured timing ranges overlap, so the recommendation rests on sharing the lifecycle and acceptance order.

[IRWB-051-A ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-spike-sl-irwb-051-a/ttmp/2026/11/27/IRWB-051-A--one-pass-runner-with-two-drivers/index.md) · [Report and reproduction commands](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/v7-spike-sl-irwb-051-a/ttmp/2026/11/27/IRWB-051-A--one-pass-runner-with-two-drivers/analysis/01-spike-report.md)

Both drivers matched the existing runners on all **6 Tix programs and 50 Typed projects**. Four additional manager and publication tests passed. The coordinator baseline check printed `no differences`. `npm run build`, `npm run check`, and `node tools/build-site.mjs` passed.

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Typed | 186 | 0 | 2 |
| Framework | 303 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Stdlib | 7 | 0 | 0 |
| Tix, GPU files excluded | 45 | 0 | 0 |

The three skips were existing opt-in Candela tests. I used Typed `constprop` because LICM and BCE both have empty preservation lists in this checkout. The prototype covers same-IR native passes with pure synchronous analyses. Synchronous strategy plans and manager contract transactions remain future work.

**Changed files**

- `src/framework/contracts/analysis-manager.ts` adds synchronous analysis and transfer through shared manager logic.
- `src/framework/contracts/differential.ts` shares sampled evidence-to-verdict conversion.
- `src/framework/contracts/effect-driver.ts` adds the synchronous and asynchronous effect drivers.
- `src/framework/passes/define-pass.ts` adds the transformation type and shared generator runner.
- `src/tensor/passes.ts` ports Tix `inline`.
- `src/typed/passes.ts` ports Typed `constprop`.
- `tests/framework/transformation-drivers.test.mjs` checks corpus parity, cache reuse, transfer, and rejection before publication.
- `scripts/01-measure-drivers.mjs` measures application time and manager code size.
- `design-doc/01-runner-spike-design.md` records the design committed before implementation.
- `analysis/01-spike-report.md` records the measurements, validation, and recommendation.
- `log/01-diary.md` records decisions and verification.
- `index.md` links the ticket evidence.
- `README.md` records the ticket workspace structure.
- `tasks.md` records completed checks.
- `changelog.md` records the prototype and report milestone.

Last commit `80f3ad86519945572f9947d7413773577045f0df`. The worktree is clean.