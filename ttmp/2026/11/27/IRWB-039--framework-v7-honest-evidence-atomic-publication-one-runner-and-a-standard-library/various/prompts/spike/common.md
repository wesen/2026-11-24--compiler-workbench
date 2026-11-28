You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **design spike: a prototype to judge, not to merge**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: one pass runner with two drivers, and a transformation type (phase 3 spike)
Read first: the design doc's "Phase 3" section; the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`, sections K1, K3, K5 and "The v7 lifecycle, merged", and `verification.md`); `src/framework/passes/define-pass.ts` (both runners, `applyPass` and `applyNativePassSync`, the `legal` check, and the acceptance boundary added by F33); `src/framework/passes/bridge.ts`; `src/framework/contracts/analysis-manager.ts` (`analyse`, `verifyTransformation` with `deferCommit`).

Today there are two pass runners with different powers: `applyNativePassSync` refuses `needs`, `preserves` and contracts, because the analysis manager is asynchronous; `applyPass` supports them. Tix uses the first and therefore cannot use framework analyses; the strategy interpreter is asynchronous, so a synchronous caller (Tix's `optimizeTix`, its scheduling rule in `src/tensor/strategy.ts`) cannot run a plan.

Build a prototype that answers one question with measurements: **can one runner, written once, serve both, with a synchronous and an asynchronous driver, and can the synchronous driver answer analysis requests through the analysis manager's cache and records (an `analyseSync` for pure analyses), or does that duplicate the manager's logic so much that one pass specification with two thin runners is better?**

1. A runner written once, for example as a generator that yields its effects (analysis requests, the meaning gate or contract, publication) to a driver. R3 reviewer D's prototype of this shape is quoted in the synthesis under K5 (`scripts/04-one-runner-two-drivers.mjs` there): it bypasses the manager, which is the part this spike must settle.
2. A transformation type that declares its relation (exact or within a tolerance), its eligibility (today's `legal`), its preparation and its obligations (requires, ensures, preserves).
3. Port two passes onto it: Tix `inline` (`src/tensor/passes.ts`) and one Typed pass that declares `needs` and `preserves` (for example `licm` or `bce` in `src/typed/passes.ts`). Run each under both drivers.
4. Measure: identical revisions from both drivers and from today's runners on the corpus (the baselines script compares revisions); milliseconds per application under each driver against today's (Tix inline on `corpus/tensor/attention` runs in about 0.6 ms today); the size of `analyseSync` and how much of `analyse` it duplicates.

Write the design first, commit it, then the prototype. Keep every existing runner and caller working: this branch is judged, then one implementer migrates the codebase on the chosen design.

## Acceptance (all of these, checked on your last commit)
- **Your evidence:** the two ported passes give the same revisions under both drivers and under today's runners (a test in `tests/framework/`); the measurements above, in your report, with the commands that produced them; a recommendation (one runner with two drivers, or one specification with two thin runners) with the measurement that decides it.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. Your prototype must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/passes/`, `src/framework/contracts/`, `src/framework/strategy/` where a driver needs it, the two ported passes in `src/tensor/` and `src/typed/`, and tests. Do not migrate any other pass.
- **Scripts:** put every probe and temporary program you write in your ticket's `scripts/` directory, numbered (`01-name.mjs`), and commit them.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Commits:** commit on your current branch with messages starting `<ID>:`, as you go, so that your last commit always holds working code. Do not push.
- **Never use `git stash`:** every worktree of this repository shares one stash stack with other agents' worktrees. To set work aside, make a temporary commit.
- **Outside your worktree,** use nothing.

## Final message
- the ticket and report paths;
- what you changed, file by file, in one line each;
- the acceptance results: your tests, the baselines check output, the suites' pass/fail counts;
- anything you left out or believe is wrong in the brief;
- the last commit hash.
