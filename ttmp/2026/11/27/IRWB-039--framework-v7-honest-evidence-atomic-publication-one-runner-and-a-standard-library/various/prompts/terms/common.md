You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`; this round is ticket IRWB-059). Your step is one of them.

Your ticket is <ID>. This is a **library module and two domain ports, with a decision point**, in one session of up to three hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:** `ttmp/2026/11/28/IRWB-059--v7-phase-4b-rules-over-a-term-signature-lowering-as-cross-ir-transformations-staged-choice/design-doc/01-intern-guide-the-ir-workbench-and-phase-4b-term-rules-cross-ir-lowering-staged-choice.md` explains the system and this round, including your lane. Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action (a design decision, a change, a failure and its fix, a measurement, a commit), more often than you commit. Each step has: a short prose summary; Prompt Context (the task, quoted once in step 1); What I did; Why; What worked; What didn't work (exact commands and error text); What I learned; What was tricky; What warrants a second pair of eyes; Code review instructions. Write a short design note before you change code, and end with a report in the ticket.

## Your task: rules over a term signature (phase 4, item 4.6), and F40
Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/index.html`) library row **terms** and the migration step "Rules over a term signature", after the guide.

Typed already keeps its rewrite rules as data (`src/typed/rules/`: the tables in `simplify.ts`, `fold.ts`, `identities.ts`; the matcher `matchPat`, `firstMatch`, `indexRules` and guards in `compile.ts`; rule verification in `verify.ts`), but the matcher and the verifier are written against Typed's value handles. Tix's `inline` and `split-sum` (`src/tensor/passes.ts`) are hand-written rewrites of Tix expressions. Several places compare trees by hand (R3 counted `sameTree` twice, LVN and LICM keys, and copies of the matcher in A0's tools).

1. **`src/stdlib/term/`:** terms over a signature (a small interface a domain implements: operator, arity, children, constant), structural hash and equality, `match` and `instantiate` for patterns with variables, and a rule-verification interface (`verifyRule` over the signature plus a domain-supplied semantics and case generator), stated in standard terms (first-order rewriting; Alive-style validation of a rule by evaluation on generated cases).
2. **Typed on it:** the rule tables match and instantiate through the library over Typed's signature, and `verify.ts` verifies through the library's interface with Typed's semantics. The edit records, the derivations (rule ids, 183 rule-citing O2 records since IRWB-056-B) and every image must not change.
3. **Tix on it:** `inline` and `split-sum` as rules over Tix's expression signature, through the same library.
4. **F40:** Tix `inline`'s correspondence still says `removed` for a merged statement (the merge is only in the derivation, `mergedInto`). Record it truthfully as `merged`, as IRWB-056-A did (`git show v7-derivations-g-h/irwb-056-a:src/tensor/passes.ts`), and update the equality test that pinned the old entry.

**Decision point:** measure the rule path against today's compiled matcher on the O2 corpus (interleave both in one process; the machine is loaded). If the library path is materially slower (more than about 10% of compile time), keep Typed's compiled visitor, share only the matcher and the verifier, and report the numbers.

## Acceptance (all of these, checked on your last commit)
- **Your tests** in `tests/stdlib/`: match and instantiate on small signatures, hash and equality laws (equal terms hash equally), a rule verified and a wrong rule refused with a counterexample; Tix `inline` and `split-sum` give the same revisions as before on every corpus program; the F40 correspondence test.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them: images, instruction counts, edit records and CUDA stay byte-identical.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/stdlib/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/`, `src/stdlib/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files: other agents share this machine, and the coordinator runs the GPU suite at merge. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier on the files you create or change that were formatted before.
- **Existing tests:** do not weaken an assertion to make your change pass. If an existing test asserts behaviour your step is meant to change, update it and say which test and why in your report.
- **The coordinator's files are read-only:** never modify anything under `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/` (its baselines and scripts are the oracle). If the baselines differ, report the differences; do not re-record them.
- **Scope:** `src/stdlib/term/` (new), `src/stdlib/index.ts`, `src/typed/rules/`, the Typed passes that apply rules, `src/tensor/passes.ts`, and tests. Not `src/framework/`, `src/typed/backend/`, `src/tensor/schedule.ts`, `cuda-*.ts` or `index.ts`: other lanes change those now.
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
