You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **framework concept applied to both domains**, in one session of up to four hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-059--v7-phase-4b-rules-over-a-term-signature-lowering-as-cross-ir-transformations-staged-choice/design-doc/01-intern-guide-the-ir-workbench-and-phase-4b-term-rules-cross-ir-lowering-staged-choice.md` explains the system and this round, including your lane. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: lowering as cross-IR transformations (phase 4, item 4.2)
Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) section **K1 · Typed transformation** (ports in, ports out; an endomorphic pass is the special case) and the migration step "Cross-IR transformations", after the guide.

Every pass is now a `Transformation` run by `runTransformation` (`src/framework/passes/transformation.ts`), but a transformation maps an IR to itself. The two lowerings sit outside it:
- **Typed → RV32:** `lowerToImage` (`src/typed/backend/compile.ts`, around line 442) is a plain function returning the image and `imageCorrespondence` (`src/typed/backend/image.ts`). Its meaning check, `rv32.image-agrees` (`src/typed/backend/run.ts`, `imageAgrees`), runs only in tests and workbench views.
- **Tix → CUDA:** `tensor.lower-cuda` (`src/tensor/cuda-contract.ts`, `createCudaLowering`) is declared with `defineTransformation`, a correspondence (`kernelCorrespondence`) and the `tensor.cuda-meaning` invariant, but it runs through the manager's asynchronous `execute`, and the path callers use, `cudaSource()` in `src/tensor/index.ts`, bypasses it.

1. **`Transformation<In, Out>`:** generalize the transformation type and the runner to an input IR and an output IR, with today's same-IR passes as the special case (no change for them). Publication, derivations and correspondence across the boundary follow the existing rules.
2. **Typed lowering on the runner:** `lowerToImage` becomes a transformation from `typed.blocks` to `rv32.image` with relation `exact`, `rv32.image-agrees` as its `ensures`, and the image correspondence as its declared output; the callers use it.
3. **Tix lowering on the runner:** `tensor.lower-cuda` runs on the runner (asynchronous driver: the check runs on the remote GPU), and `cudaSource()` produces its source through the same transformation without the GPU check (a declared, recorded choice, not a bypass). Optionally pass the kernel manifest to `runTixCuda` so the emitter's source-hash side table (`emittedKernels`) can go.
4. **Composition:** the correspondence from Tix statements to kernels, composed through the schedule passes and the emission, must equal today's `kernelCorrespondence`; the Typed one must equal `imageCorrespondence`.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/framework/` and the domains: a same-IR pass is unchanged; the Typed lowering rejects a planted wrong image (for example one instruction changed) through its `ensures`; the composed correspondences equal today's on the whole corpus; `cudaSource()` output is byte-identical.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: image bytes, instruction counts and CUDA source stay byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/passes/`, `src/framework/contracts/` (only what cross-IR ports need), `src/typed/backend/compile.ts`, `image.ts`, `run.ts` and their callers in `src/typed/` and `src/workbench/`, `src/tensor/cuda-contract.ts` (not `modesOf`), `src/tensor/index.ts`, `src/tensor/cuda-runtime.ts` (only to take the manifest), and tests. Not `src/stdlib/`, `src/typed/rules/`, `src/tensor/passes.ts`, `schedule.ts`, `cuda-source.ts`, or `src/framework/ir/derivation.ts`: other lanes change those now.
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
