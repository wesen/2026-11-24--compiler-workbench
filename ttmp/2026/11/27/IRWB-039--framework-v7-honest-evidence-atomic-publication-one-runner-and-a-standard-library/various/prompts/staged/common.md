You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **framework concept applied to a domain**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-059--v7-phase-4b-rules-over-a-term-signature-lowering-as-cross-ir-transformations-staged-choice/design-doc/01-intern-guide-the-ir-workbench-and-phase-4b-term-rules-cross-ir-lowering-staged-choice.md` explains the system and this round, including your lane. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: staged choice (phase 4, item 4.8)
Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) section **K6 · Decisions as data** ("Plus staged choice: a launch-time variant with its guard, so the differential's arms are derived") and the migration step "Staged choice", after the guide.

Some of a CUDA lowering's choices are made at launch time, when the shapes are known: a fused kernel can have a gate (a fused and an unfused path), and a tiled contraction has several variants with a launch rule (`select` entries with `minBlocks`/`minTerms`, `src/tensor/schedule.ts`). Since IRWB-057 the emitter returns a manifest (`emitScheduleProgram` in `src/tensor/cuda-source.ts`), and the meaning check enumerates its cases' modes from it (`modesOf` in `src/tensor/cuda-contract.ts`). The gate and the variant rule are two different encodings of one idea.

1. **One construct:** a launch-time `select` in the schedule IR: a guard over launch-time values (grid size, number of terms, the gate's condition) and its arms. The gate and the variants with their launch rule become instances of it.
2. **The emitter and the runtime** print and evaluate it; the manifest describes it.
3. **Derived arms:** the differential's modes are derived from the `select` (every arm checked; adding an arm adds its check). Change `modesOf` in `src/tensor/cuda-contract.ts` to that derivation and nothing else in that file (another lane changes the rest of it now).
4. **Guard coverage:** report an arm that no launch can reach, and a launch that no arm accepts (today's rule requires a last entry that accepts every grid).

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/tensor/`: the derived modes equal today's modes for every corpus program and the schedule tests' kernels; a schedule with an extra arm gets that arm checked without other changes; an unreachable arm and an uncovered launch are reported.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: CUDA source stays byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/tensor/schedule.ts`, `src/tensor/strategy.ts`, `src/tensor/cuda-source.ts`, `src/tensor/cuda-runtime.ts` (the gate and variant evaluation only), `modesOf` in `src/tensor/cuda-contract.ts`, and tests. Not `src/tensor/passes.ts`, `src/tensor/index.ts`, `src/framework/`, `src/stdlib/` or `src/typed/`: other lanes change those now.
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
