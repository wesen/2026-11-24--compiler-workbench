You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **small follow-up fixes**, in one session of up to one hour. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-064--v7-phase-4c-attribution-and-classification-as-queries-keep-or-delete-the-unused-engines-e1-lowering-follow-ups/design-doc/01-intern-guide-attribution-and-classification-as-queries-the-e1-benchmark-and-the-unused-engines.md` explains the system and this round (phase 4c), including your lane; the phase 4b guide it points to explains the rest of the system. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: F42, lowering follow-ups from phase 4b
1. **One schedule registry.** `scheduleFunction` (`src/tensor/strategy.ts`) runs the schedule plan and drops the pass results, so `src/tensor/cuda-contract.ts` runs `schedulePlan` again on a registry of its own to collect the correspondences it composes. Make `scheduleFunction` return the pass results (and their correspondences), use them in `cuda-contract.ts`, and delete the second registry.
2. **The schedule memo.** Since IRWB-061, `cudaSource()` (`src/tensor/index.ts`, through `lowerTixCuda`) takes about 4.7 ms per lowering against 0.29 ms before, because the earlier body memoized the schedule. Restore a memo keyed by what the schedule depends on (the program revision, the function, the options), and measure before and after.

## Acceptance (all of these, checked on your last commit)
- **Your tests:** the composed correspondence still equals `kernelCorrespondence` on every corpus program (`tests/tensor/lowering.test.mjs`); `cudaSource()` is byte-identical; the measured cost per lowering, before and after, in your report.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: CUDA source stays byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/tensor/strategy.ts`, `src/tensor/cuda-contract.ts`, `src/tensor/index.ts`, and tests. Nothing else: other lanes change `src/framework/`, `src/labs/` and `src/typed/` now.
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
