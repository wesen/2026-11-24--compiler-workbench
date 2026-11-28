You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **library extraction with a correctness fix**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

The standard library lives in `src/stdlib/` (read `src/stdlib/index.ts` first: its admission rule, its layering, and the one module that exists, `flow/liveness.ts`, with `tests/stdlib/`). A library module is a pure, synchronous implementation of a named algorithm over a small shape interface, never over a domain's types, and it imports nothing outside `src/stdlib/` (`tests/stdlib/layering.test.mjs` enforces that). Every module needs at least two clients in the repository and an executable test, and it **moves** code that exists, rather than writing a second copy: each client must call the library and its old copy must be deleted.

## Your task: `stdlib/affine`, exact affine forms and dependence distances
Tix indexes tensors with affine forms (`src/tensor/model.ts`, around lines 2-30: `constant`, `variable`, `add`, `substitute`, `value`, `plain`).
1. **Move the affine forms into `src/stdlib/affine/` and make them exact.** Today `add` checks only that the final coefficients are safe integers, while it computes `b.constant * scale` and the sums in doubles, so an intermediate can round. R3 found that `add(constant(-MAX_SAFE_INTEGER), constant(4503599627370497), 3).constant` is one more than the exact `3 * 4503599627370497 - MAX_SAFE_INTEGER`. Compute exactly, and reject a result that is not a safe integer with an ordinary error, as today.
2. **Add dependence distance vectors:** for a statement with axes and a read with affine indices, the distance at each position is the consumer's axis minus the read's index, zero meaning aligned. `planFusion`'s join test (`joinDepth` in `src/tensor/fusion.ts`, around lines 82-105) is exactly "the leading positions at which every read of the group has distance zero" (R3 verified it agrees on 13 of 13 programs). Rewrite `joinDepth` on the library's distances. That is the second client.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/stdlib/`: affine arithmetic on large integers, including the case R3 found (below), and distance vectors on small programs with known answers (an aligned read, a shifted read, a transposed read, a constant index).
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: CUDA source and Tix revisions stay byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/stdlib/affine/` (new), `src/stdlib/index.ts`, `src/tensor/model.ts`, `src/tensor/fusion.ts` (only `joinDepth`), their imports, and tests. Not `src/tensor/evaluate.ts` or `src/tensor/schedule.ts`: other steps change or depend on those now.
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
