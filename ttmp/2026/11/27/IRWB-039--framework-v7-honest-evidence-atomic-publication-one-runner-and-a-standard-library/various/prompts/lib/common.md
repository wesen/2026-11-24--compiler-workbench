You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **framework addition**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: start a standard library of compiler algorithms, with liveness
The refactor (design doc, "Phase 2") adds `src/stdlib/`: pure, synchronous implementations of standard compiler algorithms over small shape interfaces, never over a domain's types, usable by any domain. Admission rule: a named algorithm or law, at least two clients, and an executable test.

The first primitive is **liveness** (backward gen/kill dataflow over a control-flow graph). The register allocator and the copy coalescer each carry the same hand-written liveness sweep, line for line: `intervals` in `src/typed/backend/regalloc.ts` (around line 85) and the block at the start of `src/typed/backend/coalesce.ts` (around line 32).

1. **Lay out `src/stdlib/`** so later primitives (dominators and loops, lattices and a fixpoint solver, SSA construction, affine forms) have an obvious place, with an index. Keep it to what liveness needs now plus the directory convention; list the later modules as one line each.
2. **Write the liveness primitive** over a minimal interface (blocks, successors, per-block uses and definitions). A known trap: a block that no path from the entry reaches. R3 found that the machine liveness of `regalloc.ts` and the framework's entry-reachable solver disagree on such a block. The case: block 0 jumps to the join; block 1, which nothing reaches, also jumps to the join; the join uses registers 64 and 65. The machine code gives block 1 the live-out set {64, 65}; an entry-reachable solver gives {}. Make the scope explicit in the interface.
3. **Make both clients use it** and delete their copies.

Write a short design first (the interface, the scope decision, the layout), commit it, then implement.

## Acceptance (all of these, checked on your last commit)
- **The tests you add:** a test of the liveness primitive including a block that no path from the entry reaches (state which scope your primitive uses for it and why), and a test that fails if any module under `src/stdlib/` imports from `src/framework/`, `src/typed/` or `src/tensor/`. The existing `tests/typed/` backend tests must pass unchanged.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: the register allocator and the coalescer must produce byte-identical images.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass, apart from the `todo` tests of other steps.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier only on files that were formatted before you changed them.
- **Tests of the correct behaviour already exist.** `tests/framework/r3-defects.test.mjs`, `tests/tensor/r3-tix-in-plans.test.mjs` and `tests/typed/d2-defects.test.mjs` hold one `todo` test per refactor step. Your step's test is named in the acceptance above: make it pass and remove its `todo` option in the same commit. Do not weaken a test's assertions; if you believe one is wrong, say so in your report and leave it.
- **Scope:** a new `src/stdlib/`, `src/typed/backend/` for the two clients, and tests. Not `src/framework/` or `src/tensor/`.
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
