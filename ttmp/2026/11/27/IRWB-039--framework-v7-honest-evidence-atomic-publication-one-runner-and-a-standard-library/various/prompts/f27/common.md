You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **small specified change**, in one session of up to 90 minutes. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task (F27): Tix passes keep their meaning gate inside strategy plans
Tix passes already run in strategy plans through the framework's bridge (`passAlgorithm` in `src/framework/passes/bridge.ts`), but they lose their meaning check there. `optimizeTix` (`src/tensor/index.ts`, around lines 32-45) hands the gate to `applyNativePassSync` as a closure, `meaningGate(origin, pass === 'inline' ? 'exact' : 'tolerance')`, and the Tix passes (`src/tensor/passes.ts`) declare no contract, so the bridge checks nothing: a wrong pass is accepted.

Do two things:
1. **Declare each pass's relation on the pass** (`inline` is exact, `split-sum` is within tolerance) and have `optimizeTix` use the declared relation instead of choosing it by name.
2. **Export `tixAlgorithm(pass, { origin })` from `src/tensor/index.ts`:** a strategy algorithm for the pass whose meaning gate is a contract, passed through the bridge's existing `contract` and `contractInputs` options. R3's probe `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/scripts/02-tix-passes-in-strategy-plans.mjs`, part 3 (lines 48-66), shows a working way to wrap `meaningGate` as an `ensures` invariant, including the one adaptation it needed.

`optimizeTix` stays synchronous: making it run a plan needs a synchronous plan driver, which is a later step.

## Acceptance (all of these, checked on your last commit)
- **The test:** `F27: a wrong Tix pass is rejected inside a strategy plan; correct passes are accepted` in `tests/tensor/r3-tix-in-plans.test.mjs` passes without its `todo`.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass, apart from the `todo` tests of other steps.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier only on files that were formatted before you changed them.
- **Tests of the correct behaviour already exist.** `tests/framework/r3-defects.test.mjs`, `tests/tensor/r3-tix-in-plans.test.mjs` and `tests/typed/d2-defects.test.mjs` hold one `todo` test per refactor step. Your step's test is named in the acceptance above: make it pass and remove its `todo` option in the same commit. Do not weaken a test's assertions; if you believe one is wrong, say so in your report and leave it.
- **Scope:** `src/tensor/` and tests. Not `src/framework/`: this step needs no framework change.
- **Scripts:** put every probe and temporary program you write in your ticket's `scripts/` directory, numbered (`01-name.mjs`), and commit them.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Commits:** commit on your current branch with messages starting `<ID>:`, as you go, so that your last commit always holds working code. Do not push.
- **Never use `git stash`:** every worktree of this repository shares one stash stack with other agents' worktrees. To set work aside, make a temporary commit.
- **Outside your worktree,** use nothing.

## Final message
- the ticket and report paths;
- what you changed, file by file, in one line each;
- the acceptance results: the test, the baselines check output, the suites' pass/fail counts;
- anything you left out or believe is wrong in the brief or the test;
- the last commit hash.
