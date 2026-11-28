You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **migration: the chosen design applied to the whole codebase**, in one session of up to four hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: one pass runner for every pass (phase 3 migration)
Your branch already contains the winning phase 3 spike (IRWB-051-C, three commits on top of the base). Read its design and report first: `ttmp/2026/11/27/IRWB-051-C--one-pass-runner-with-two-drivers-and-a-transformation-type-phase-3-spike/design-doc/01-one-runner-two-drivers-design.md` and `ttmp/2026/11/27/IRWB-051-C--one-pass-runner-with-two-drivers-and-a-transformation-type-phase-3-spike/reference/02-report.md`. It added `src/framework/contracts/steps.ts` (a step yields what it would `await`; `driveSync` refuses a promise, `driveAsync` awaits it), turned the analysis manager's `analyse` and `preserve` into generators driven by both drivers (`analyseSync`, `preserveSync`), and added `src/framework/passes/transformation.ts` (the `Transformation` type with `relation`, `eligible`, `prepare`, `obligations`, and the runner `runTransformation` with `applyTransformation` and `applyTransformationSync`). Two passes use it: Tix `inline` and Typed `strength`. Two other spikes reached the same design independently, so the design is settled; your job is to finish it and move everything onto it.

1. **Contracts as steps.** `verifyTransformation` (`src/framework/contracts/analysis-manager.ts`, with `deferCommit`) always returns a promise, so under the synchronous driver a contract obligation is refused and the spike passes the meaning check as a plain function, unrecorded. Convert the contract path to steps (about 13 `await`s), so the synchronous driver records contract executions and facts in the manager exactly as the asynchronous one does, under F33's acceptance boundary (nothing is committed or published before every obligation passes).
2. **A synchronous strategy driver.** Convert the strategy interpreter (`src/framework/strategy/interpreter.ts`, about 27 `await`s) to steps with both drivers. Then make `optimizeTix` (`src/tensor/passes.ts`) run its pass list as a strategy plan under the synchronous driver, with the same revisions as today.
3. **Every pass on the runner.** Move every Typed pass (`src/typed/passes.ts`, built by `definePass`) and every Tix pass (`src/tensor/passes.ts`) onto the transformation type. Delete the synchronous runner's restriction (in `applyNativePassSync`, which refuses `needs`, `preserves` and contracts). Leave one runner: `applyPass` and `applyNativePassSync` are either removed with their callers migrated or reduced to wrappers of a few lines over `runTransformation`; say which and why.
4. **One encoding of the Tix meaning gate.** The spike added `tixMeaning` next to the invariant and contract that `tixAlgorithm` builds (F27); they are the same gate. Keep one.
5. **The cleanup rule.** The synchronous driver abandons a run with `return()`, which runs `finally` but not `catch`; put every cleanup the runner and the manager need in `finally`, and add a test that a rejected synchronous application leaves the manager and the store as the asynchronous one does.

Not in this step (phase 4): derivations, `decide` and plans for fusion and scheduling, Tix → CUDA as a cross-IR transformation, a tolerance bound as data, and the hand-written scheduling rule in `src/tensor/strategy.ts` (leave it working as it is).

Measure, with the spike's script (`ttmp/2026/11/27/IRWB-051-C--one-pass-runner-with-two-drivers-and-a-transformation-type-phase-3-spike/scripts/04-revisions-and-timings.mjs`, copied into your ticket and extended), milliseconds per application for Tix `inline` on `corpus/tensor/attention` and Typed `strength`, before (the base, `v7-p2`) and after, in the same session; the machine is loaded, so report medians and ranges.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/framework/`: the cleanup test above; the synchronous driver records a contract execution; `optimizeTix` as a plan under the synchronous driver gives the same revision as today on every corpus program. The spike's `tests/framework/transformation-drivers.test.mjs` still passes.
- **Existing tests** pass unchanged, except tests that assert the restriction you delete or an API you remove; list each such change.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: every image, instruction count, edit record, CUDA source and Tix revision is byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/` (passes, contracts, strategy, and their callers), `src/typed/passes.ts` and other Typed callers of the runners, `src/tensor/passes.ts`, `src/tensor/contract.ts`, `src/tensor/index.ts`, `src/workbench/` callers, and tests. Not `src/stdlib/` or `src/framework/dataflow/` (another step moves the solver now), and not the CUDA lowering (`src/tensor/cuda-*.ts`, `src/tensor/schedule.ts`; another step works there).
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
