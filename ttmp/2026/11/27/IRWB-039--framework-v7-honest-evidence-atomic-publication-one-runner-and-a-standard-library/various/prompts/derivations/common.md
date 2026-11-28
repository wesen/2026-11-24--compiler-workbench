You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **framework concept**, in one session of up to two and a half hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task: derivations (phase 4, concept K2 of the R3 design)
Since phase 3, every Typed and Tix pass is a `Transformation` (`src/framework/passes/transformation.ts`: `relation`, `eligible`, `prepare`, `obligations`) run by one runner, `runTransformation`, under a synchronous or an asynchronous driver (`src/framework/contracts/steps.ts`); the strategy interpreter has `execute` and `executeSync`.

Read first: the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`), section **K2 · Derivation** and the migration step "Derivation and scoped correspondence"; and `src/typed/tx.ts` (Typed's edit transaction: `record`, around line 203, writes each edit with a `because`).

Today a pass's edits say *what* changed; the correspondence between the IR before and after is computed separately and only partly audited. A **derivation** is the producer's own record of *why*: for each step, the rule or decision it applied, the site (the entities it consumed and produced), and the premises (the facts or analysis results it relied on). The correspondence is then computed *from* the steps under a coverage policy (F35's vocabulary in `src/framework/ir/correspondence.ts`), and the existing diff audits it.

1. **The record:** a small framework type for a derivation step (rule or decision id, site, premises, relation) in `src/framework/ir/`, carried in a transformation's result next to its edits and correspondence.
2. **Typed writes rule ids:** make `Tx.record` (and its callers in `src/typed/rules/` and the passes that apply rules: simplify, fold, identities) record the rule that licensed each edit and the facts it used. R3 counted 183 verified-rule matches among the 2,021 O2 edit records of the corpus, and today 0 records cite a rule: that number must go from 0 to 183 (or explain each difference).
3. **Tix records merges:** Tix `inline` (`src/tensor/passes.ts`) records which statement was merged into which.
4. **Correspondence from steps:** for those passes, compute the correspondence from the derivation and check it against the one computed today: they must be equal. Reject empty and false mappings (a step whose site names entities that do not exist, or that the diff contradicts).
5. **Classification stays a query:** do not add a class field (`local`, `structural`) to a step; R3 decided against it (A0's two policies, 203 and 395 local edits, must both be computable from the same records). Show both numbers as queries in a test.

**Decision point:** measure the cost. If recording derivations makes the O2 corpus compile more than about 2× slower than today's correspondence computation, store the local terms only on demand, and report the numbers either way.

## Acceptance (all of these, checked on your last commit)
- **Your tests:** rule-citing records on the O2 corpus (0 → 183, or each difference explained); derivation-computed correspondence equals today's for every pass that records one; an empty and a false mapping are rejected; both A0 policies as queries over the same records.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. Edit records may gain fields; images, instruction counts, CUDA and Tix revisions must not change. If the census in the baselines changes only by new fields, say so and show it.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/framework/ir/`, `src/framework/passes/transformation.ts` (only to carry the derivation), `src/typed/tx.ts`, `src/typed/rules/`, the Typed passes that apply rules, `src/tensor/passes.ts` (only `inline`), and tests. Not `src/framework/strategy/`, `src/framework/core/`, `src/tensor/fusion.ts`, `schedule.ts`, `strategy.ts`, `src/typed/sccp.ts`, `specialize.ts` or `pe.ts`: other steps change those now.
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
