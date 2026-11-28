You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **framework concept applied to a domain**, in one session of up to four hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: fusion and scheduling as decide, eligible, prepare (phase 4, concept K6)
Since phase 3, every Typed and Tix pass is a `Transformation` (`src/framework/passes/transformation.ts`: `relation`, `eligible`, `prepare`, `obligations`) run by one runner, `runTransformation`, under a synchronous or an asynchronous driver (`src/framework/contracts/steps.ts`); the strategy interpreter has `execute` and `executeSync`.

Read first: the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`), section **K6 · Decisions as data** and the worked defect "5 · The extent-17 reduction-order counterexample", and the migration step "Fusion as decide, eligible, prepare".

K6 splits a transformation that makes a choice into three parts: an **untrusted `decide`** that returns a plan (a serializable value: which statements to fuse, which loop order and tiling to use); a **small `eligible(plan)`** that decides whether that plan is legal on this IR; and **`prepare`**, which applies it. Only `eligible` must be trusted, so it should be small and grounded in standard theory: here, the affine library's dependence distance vectors (`src/stdlib/affine/`) and the legality of loop reordering and strip-mining over them.

Today:
- **Fusion** (`src/tensor/fusion.ts`, `planFusion` with `joinDepth`, now on the library's distance vectors) decides and applies in one step.
- **Scheduling** (`src/tensor/schedule.ts`, T6's checked scheduling passes with a `legal` precondition, and its output validator `orderViolation` around line 298) and the hand-written scheduling rule in `src/tensor/strategy.ts` (`lowerSchedule`).
- The CUDA runtime finds the fused/unfused gate names with a regex over the emitted source (`src/tensor/cuda-runtime.ts`, around line 142).

1. **Fusion** as decide/eligible/prepare: the plan is the grouping; `eligible` checks it with the distance vectors.
2. **Scheduling** the same way: the plan is the loop order, tiling and bindings of each kernel variant; `eligible` replaces both the per-pass `legal` checks and `orderViolation`. The extent-17 counterexample must be rejected: T6's `orderViolation` simulates three extent vectors (11, 1 and 0, all below the strip-mining factor 16) and accepts a variant whose reduction order differs from the source's at extent 17, which changes f32 results (reviewer B's probe, copied to `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/various/reference-probes/r3-b-05-reduction-order.mjs`; it shows the variant, the order and the two sums; adapt it into a test in `tests/tensor/`).
3. **The hand-written rule** in `src/tensor/strategy.ts` becomes a strategy plan run under `executeSync`.
4. **A manifest** of the emitted kernels and gates, produced with the CUDA source, drives the runtime's gate names; delete the regex.

**Decision point:** if fusion and scheduling need different `eligible` signatures (they cannot share one plan-checking interface without contortion), say so with the two signatures and keep them separate: that withdraws K6's unification for this pair.

## Acceptance (all of these, checked on your last commit)
- **Your tests:** the extent-17 variant is rejected by `eligible`; fusion and scheduling plans round-trip through serialization; `eligible` accepts every plan the corpus produces today.
- **The GPU suite** `tests/tensor/*-gpu.test.mjs` passes at the end.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: CUDA source is byte-identical for every Tix program.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`): other agents share this machine. You may run the `*-gpu.test.mjs` files (the GPU is remote, reached through `tools/cuda-remote.mjs`); you are the only agent using it, so run one GPU job at a time. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/tensor/fusion.ts`, `src/tensor/schedule.ts`, `src/tensor/strategy.ts`, `src/tensor/cuda-*.ts`, `src/stdlib/affine/` (additions only), and tests. Not `src/tensor/passes.ts`, `src/tensor/index.ts`, `src/framework/`, or `src/typed/`: other steps change those now.
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
