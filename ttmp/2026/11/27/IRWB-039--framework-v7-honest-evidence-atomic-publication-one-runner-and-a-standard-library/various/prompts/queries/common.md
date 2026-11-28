You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **framework concept applied to Typed, with a fixed check**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-064--v7-phase-4c-attribution-and-classification-as-queries-keep-or-delete-the-unused-engines-e1-lowering-follow-ups/design-doc/01-intern-guide-attribution-and-classification-as-queries-the-e1-benchmark-and-the-unused-engines.md` explains the system and this round (phase 4c), including your lane; the phase 4b guide it points to explains the rest of the system. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: attribution and classification as queries (phase 4, item 4.3)
Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) migration step "Attribution and classification as queries" and section **K2 · Derivation**, after the guide.

Three tools explain what the optimizer did by re-deriving it from IR trees, instead of reading the records the passes now write:
- **D1's instruction attribution** (`src/typed/attribute.ts`, `attributeSteps`; IRWB-034-G and its tables, `ttmp/2026/11/27/IRWB-034-G--*/scripts/04-attribution-tables.sh`) charges each executed RV32 instruction to the pass steps that produced it.
- **D2's provenance tool** (`src/typed/missed.ts`, `hotShapes`) finds hot instruction shapes that no rule touched.
- **A0's edit classifier** (`src/typed/edit-classes.ts`: `classifyApplication`, `rederive`, `sameTree`) classifies each edit as a local value rewrite or not, by re-matching rules on the trees before and after. Its two policies count 203 and 395 local edits on the O2 corpus; IRWB-056-B's queries over the derivation records gave 203 and 393.

Since phase 4.1 every Typed `Tx` pass records a derivation (`src/framework/ir/derivation.ts`: rule, site, premises), and since 4.2 the lowering is a cross-IR transformation whose correspondence maps blocks to instructions.

1. **Attribution as a query:** rewrite D1's attribution (and D2's provenance where it re-derives) as queries over the derivations and the composed correspondence chain from source to image. **Check:** the D1 tables reproduce exactly (run its script before and after).
2. **Classification as a query:** both A0 policies as queries over the same records, with no class field. Settle 203 against 395: explain the 393 (two `fold-add` records folding a tree the same application made, per IRWB-056-B's test), decide which reading A0 meant, and make the query and the test say so.
3. **One matcher:** `edit-classes.ts` still carries a copy of the rule matcher; move it onto `src/stdlib/term` (IRWB-060-B did this; see `git show v7-terms-ds-x/irwb-060-b:src/typed/edit-classes.ts`).
4. Delete what the queries replace (re-derivation code), and say what remains and why.

## Acceptance (all of these, checked on your last commit)
- **Your tests:** the D1 tables reproduce (attach the before and after output); both A0 policies as queries with the settled numbers; D2's hot-shape output unchanged on the corpus programs it was run on.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/typed/attribute.ts`, `src/typed/missed.ts`, `src/typed/edit-classes.ts`, a query module in `src/framework/ir/` next to `derivation.ts` if the queries are domain-independent, and tests. Not `src/framework/core/`, `src/framework/ir/{patterns,rewrites,traversal,transactions}.ts`, `src/labs/`, `src/conformance/`, `src/typed/rules/` or `src/tensor/`: other lanes change those now.
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
