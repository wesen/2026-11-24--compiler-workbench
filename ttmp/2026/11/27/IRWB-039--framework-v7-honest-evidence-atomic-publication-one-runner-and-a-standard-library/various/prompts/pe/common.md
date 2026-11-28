You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **library extension with a decision point**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: `solveFor` and `pe` (phase 4), tested on B1's specializer
Read first: the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`), the library table rows **lattice** (`solveFor` with on-demand unknowns) and **pe** (division and congruence; polyvariant unfold; budget: refuse, generalize, fall back), and the migration step "solveFor and pe"; then `src/stdlib/index.ts` (the admission rule and layering) and `src/stdlib/flow/`.

The library's solver works on a fixed graph. Two things in the codebase need more:
- **SCCP** (`src/typed/sccp.ts`, Wegman and Zadeck) explores only the blocks it finds executable, and it already uses the library's flat lattice.
- **B1's specializer** (`src/typed/specialize.ts` and `src/typed/pe.ts`; B1 specializes Typed's bytecode VM on its bytecode, the first Futamura projection, giving Fibonacci in 110 instructions) runs its own binding-time division, memo table, worklist and cloner. R3 found that a static-graph solver can express a division but not polyvariant unfolding, which must intern and schedule new residual program points as it discovers them.

1. **`solveFor`** in `src/stdlib/flow/` (or `lattice/`, by the layering): equations whose right-hand side reads other unknowns through a `get` that registers a dependency and may create the unknown (Fecht and Seidl's local solving; R3 quotes the interface: `rhs(unknown, get)`, `widenAt?`, `solveFor(eqs, roots, budget)`). Port SCCP onto it as the first client.
2. **`pe`** in `src/stdlib/pe/`: a binding-time division (congruence) on `solveFor`, and polyvariant unfolding with a memo of (program point, static environment), a budget, and the three outcomes on exhaustion (refuse, generalize, fall back). Restate B1's specializer on it as the second client.

**Decision point:** count the lines of B1's specializer (`specialize.ts` + `pe.ts`) before and after. If the restated specializer is not at most half of the original, `unfold` is not earning its place: say so, keep B1 as it is, and keep `solveFor` with SCCP only.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/stdlib/`: `solveFor` on equation systems with known solutions, including one that creates unknowns on demand and one that needs widening; the division on a small program with known binding times; unfolding that hits the budget under each of the three outcomes.
- **B1 unchanged:** the B1 tests in `tests/typed/` pass, and the specialized programs' instruction counts are unchanged (Fibonacci under `promote+speed`: 110).
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/stdlib/flow/` (additions), `src/stdlib/pe/` (new), `src/stdlib/index.ts`, `src/typed/sccp.ts`, `src/typed/specialize.ts`, `src/typed/pe.ts`, and tests. Not `src/framework/`, `src/typed/tx.ts`, `src/typed/rules/` or `src/tensor/`: other steps change those now.
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
