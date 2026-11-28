You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **cleanup**, in one session of up to one hour. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: three small cleanups after the phase 3 migration
Since phase 3, every Typed and Tix pass is a `Transformation` (`src/framework/passes/transformation.ts`: `relation`, `eligible`, `prepare`, `obligations`) run by one runner, `runTransformation`, under a synchronous or an asynchronous driver (`src/framework/contracts/steps.ts`); the strategy interpreter has `execute` and `executeSync`.

1. **Move `steps.ts` into `core`.** `src/framework/contracts/steps.ts` (`Steps`, `wait`, `driveSync`, `driveAsync`, `drive`) is generic, and the strategy interpreter now imports it, which is the strategy layer's first import outside `core`. Move it to `src/framework/core/steps.ts`, update the imports, and keep `tests/framework/layering.test.mjs` passing (strategy, contracts and ir import from core only the modules its allow-list names; add `core/steps.js` there, and say so).
2. **One identity algorithm.** `tix.keep` (`src/tensor/index.ts`, around line 42) and `typed.keep` (`src/typed/strategies.ts`, around line 144) are the same strategy algorithm: return the input unchanged, used as the fallback of an `attempt`. Define it once in the framework's strategy layer and use it from both.
3. **One plan builder.** `optimizeTix` (`src/tensor/index.ts`, around lines 50-70) and Typed's `pipelinePlan` (`src/typed/strategy.ts`, around line 19) build the same plan shape: a sequence of `attempt`s, each a pass with the identity as fallback. Put that builder in the framework (`src/framework/strategy/builders.ts`) and use it from both, keeping each caller's options (for example `tolerate`).

## Acceptance (all of these, checked on your last commit)
- **Existing tests** pass unchanged (the layering test may gain one allow-list entry).
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/core/`, `src/framework/contracts/steps.ts` and its importers, `src/framework/strategy/`, `src/tensor/index.ts`, `src/typed/strategies.ts`, `src/typed/strategy.ts`, `tests/framework/layering.test.mjs`. Nothing else: other steps change `src/framework/passes/`, `src/framework/ir/`, `src/tensor/fusion.ts`, `schedule.ts`, `strategy.ts` and `src/typed/` rules now.
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
