You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **measurement with a decision point, then the change it supports**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-064--v7-phase-4c-attribution-and-classification-as-queries-keep-or-delete-the-unused-engines-e1-lowering-follow-ups/design-doc/01-intern-guide-attribution-and-classification-as-queries-the-e1-benchmark-and-the-unused-engines.md` explains the system and this round (phase 4c), including your lane; the phase 4b guide it points to explains the rest of the system. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: the E1 benchmark, and keep, move or delete the unused engines (phase 4, item 4.7)
Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) migration step "Keep or move the rewrite engine, the transaction layer and the 1,237-line core runtime" and `BACKLOG.md` item **E1** (incremental checking per function), after the guide.

R3 found three framework parts that no domain uses (probe 03/05): the **core runtime** (`src/framework/core/runtime.ts`, `query.ts`, `records.ts`; about 1,237 lines: queries with dependency tracking and early cutoff), the **rewrite engine** (`src/framework/ir/patterns.ts`, `rewrites.ts`, `traversal.ts`) and the **transaction layer** (`src/framework/ir/transactions.ts`). Their callers are the test domain in `src/labs/`, `src/conformance/`, framework tests, and `src/typed/rules/form.ts` (it builds a `NodePattern` for listing rules), and `src/framework/ir/view.ts` (`View.edit`, `walk`, `subgraph`, which no caller uses). Typed has its own transaction (`src/typed/tx.ts`), and rules now match through `src/stdlib/term`.

1. **The E1 benchmark** (in your ticket's `scripts/`): an edit stream on large corpus programs (chess, and Candela if it loads in time), applying small edits one at a time to programs of increasing size, measuring the cost of checking each edit (re-running the analyses and checks it invalidates) today, and with the core runtime's queries keyed by function part (early cutoff). Report cost per edit against program size.
2. **Decision point (R3):** adopt the runtime only if its per-edit checking cost falls with program size. If it does not, the runtime does not earn its place in the core.
3. **The change the measurement supports:**
   - Runtime: adopt it on the path the benchmark measured, or move it out of `src/framework/core/` (to `src/labs/` with its conformance tests) or delete it.
   - Rewrite engine and transaction layer: no measurement decides them; R3's evidence is that no domain uses them. Move `form.ts`'s listing onto `src/stdlib/term`, then move the engine and transactions with the test domain that uses them (`src/labs/`), keeping their tests passing, unless you find a domain use.
   - Record what you moved, deleted or kept, with the numbers, and the framework's line count before and after.

## Acceptance (all of these, checked on your last commit)
- **Your evidence:** the benchmark script, its output (cost per edit against program size, both configurations), and the decision with the numbers.
- **Existing tests** pass; tests of moved modules move with them.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/core/runtime.ts`, `query.ts`, `records.ts`, `src/framework/core/index.ts`, `src/framework/ir/patterns.ts`, `rewrites.ts`, `traversal.ts`, `transactions.ts`, `src/framework/ir/index.ts`, `src/framework/ir/view.ts` (only `View.edit`, `walk` and `subgraph`, which import `transactions.ts` and `traversal.ts`; no caller uses them), `src/labs/`, `src/conformance/`, `src/typed/rules/form.ts`, the framework tests of those modules, and your benchmark. Not `src/framework/ir/derivation.ts` or `correspondence.ts`, `src/framework/passes/`, `src/typed/attribute.ts`, `missed.ts`, `edit-classes.ts` or `src/tensor/`: other lanes change those now.
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
