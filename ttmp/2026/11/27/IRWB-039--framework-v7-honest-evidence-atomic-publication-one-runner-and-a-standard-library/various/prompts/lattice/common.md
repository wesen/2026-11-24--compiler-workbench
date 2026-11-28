You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **library extraction**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

The standard library lives in `src/stdlib/` (read `src/stdlib/index.ts` first: its admission rule, its layering, and the one module that exists, `flow/liveness.ts`, with `tests/stdlib/`). A library module is a pure, synchronous implementation of a named algorithm over a small shape interface, never over a domain's types, and it imports nothing outside `src/stdlib/` (`tests/stdlib/layering.test.mjs` enforces that). Every module needs at least two clients in the repository and an executable test, and it **moves** code that exists, rather than writing a second copy: each client must call the library and its old copy must be deleted.

## Your task: `stdlib/lattice`, the lattices of dataflow analysis
Move the framework's lattices into `src/stdlib/lattice/`: the lattice interface and the set, flat, interval (with its widening with thresholds, added by a recent step) and map lattices of `src/framework/dataflow/lattices.ts`. The framework's `dataflow` layer then re-exports them from the library, so its callers keep working unchanged.

The second client is SCCP (`src/typed/sccp.ts`, Wegman and Zadeck), which keeps a private three-level lattice per SSA name. Make it use the library's flat lattice if that is the same lattice; if it is not, say why in your report and leave it.

The fixpoint solver (`src/framework/dataflow/solver.ts`) is not part of this step.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/stdlib/`: the lattice laws (join is commutative, associative and idempotent; bottom is its identity; widening is an upper bound of its arguments and stabilizes an increasing chain) checked on each lattice over generated values, plus the interval lattice's widening with thresholds.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/stdlib/lattice/` (new), `src/stdlib/index.ts`, `src/framework/dataflow/lattices.ts`, `src/typed/sccp.ts`, and tests. Not `src/framework/dataflow/solver.ts` or `src/typed/analyses.ts`: another step changes those now.
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
