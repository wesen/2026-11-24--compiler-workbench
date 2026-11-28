You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **library extraction**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

The standard library lives in `src/stdlib/` (read `src/stdlib/index.ts` first: its admission rule, its layering, and the modules that exist: `flow/liveness.ts`, `graph/`, `lattice/`, `affine/`, `num/`, with `tests/stdlib/`). A library module is a pure, synchronous implementation of a named algorithm over a small shape interface, never over a domain's types, and it imports nothing outside `src/stdlib/` (`tests/stdlib/layering.test.mjs` enforces that). Every module needs at least two clients in the repository and an executable test, and it **moves** code that exists, rather than writing a second copy: each client must call the library and its old copy must be deleted.

## Your task: `stdlib/flow`, the dataflow fixpoint solver
Move the framework's fixpoint solver into `src/stdlib/flow/`: `solve` and its `FlowGraph`, `SolveOptions` and `Solution` types (`src/framework/dataflow/solver.ts`; it already takes its depth-first order from `stdlib/graph`). It iterates a monotone transfer function over a graph to a fixpoint, in either direction, widening at loop heads; it takes its lattice from the caller (the lattices are in `stdlib/lattice`). The framework's `dataflow` layer then re-exports it from the library, so its callers (`src/framework/dataflow/analysis.ts`, and through it Typed's dataflow analyses) keep working unchanged.

The second client is the library's own liveness (`src/stdlib/flow/liveness.ts`), which hardcodes its own backward fixpoint; the index says the solver "generalises it". Rewrite liveness on `solve` with a set lattice and the same results. Liveness runs inside the register allocator and the coalescer on every function, so measure the corpus compile time under `speed` before and after (the baselines script prints nothing about time; time the build of a few corpus projects, or write a probe) and report it. If the solver makes liveness more than about 10% slower on the corpus, say so and keep both, with the numbers.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/stdlib/`: the solver on small graphs with known fixpoints, forward and backward, with a loop that needs widening, and with an unreachable block; liveness through the solver equals the old liveness on generated graphs (compare against a copy of the old function kept inside the test).
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/stdlib/flow/`, `src/stdlib/index.ts`, `src/framework/dataflow/` (solver, analysis, index), the import in `src/typed/analyses.ts`, and tests. Not `src/framework/passes/`, `src/framework/contracts/`, `src/framework/strategy/`, `src/typed/passes.ts` or `src/tensor/`: other steps change those now.
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
