You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **defect investigation and fix on the GPU**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: F39, an intermittent exactness rejection on the GPU
Tix lowers its tensor programs to CUDA (`src/tensor/schedule.ts` tiles contractions; `src/tensor/cuda-contraction.ts` and `src/tensor/cuda-source.ts` emit kernels; `src/tensor/cuda-contract.ts` and `src/tensor/cuda-runtime.ts` run them and compare the results with the interpreter, bit for bit). The GPU is on a remote machine: the `*-gpu.test.mjs` tests reach it through `tools/cuda-remote.mjs` (read it first; it compiles with `nvcc` and runs there over ssh). **You are the only agent using the GPU during your session**; run one GPU job at a time.

The defect: `tests/tensor/schedule-gpu.test.mjs:35` ("every tiled variant of the feature contractions is exact on every case (each variant forced)") failed once in four runs of the GPU suite, with the `batched` variant's lowering check returning `accepted: false`; it passed the other three times, once with `--test-concurrency=1`. The batched contraction is `t[b,i,j] = sum(k) a[b,i,k] * b[b,k,j]` in that test file. A result that changes between runs of the same kernel on the same input points at a race (missing synchronization between tile loads and reads, a shared-memory reuse across iterations, an out-of-bounds read of a tail), which would undercut every exactness claim the lowering makes. It could also be outside the kernel: the remote runner (a truncated transfer, a stale binary, two runs sharing a file name), or the checker's case generation.

1. **Reproduce:** run the batched variant's check in a loop (a probe in your ticket's `scripts/`, not the whole suite) until it fails, and record the failure rate. Capture the disagreeing case: the inputs, the positions that differ, the GPU and interpreter values.
2. **Find the cause,** with evidence (for example `compute-sanitizer --tool racecheck` or `--tool memcheck` on the remote machine, or a deterministic reproduction).
3. **Fix it** at the cause, and show the loop no longer fails over at least ten times as many runs as it took to fail before. If the cause is outside the kernel, fix it there.

## Acceptance (all of these, checked on your last commit)
- **Your evidence,** in your report: the failure rate before and after, with the probe that measured it; the captured case; the cause.
- **The GPU suite:** `tests/tensor/*-gpu.test.mjs` pass (you may run these).
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. If your fix changes emitted CUDA, the baselines will show it: report every difference and why each is expected; do not re-record them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`): other agents share this machine. You are the only agent using the GPU during your session (see your task). Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/tensor/schedule.ts`, `src/tensor/cuda-*.ts`, `tools/cuda-remote.mjs`, `tests/tensor/`, and your ticket. Not `src/tensor/passes.ts`, `src/tensor/strategy.ts`, `src/framework/` or `src/stdlib/`: other steps change those now.
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
