You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **small specified fix**, in one session of up to 90 minutes. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task (F36, F38): two Typed pass defects
Both were found by the previous stage (ticket `ttmp/2026/11/27/IRWB-037-G--missed-optimizations-found-from-provenance-hot-instructions-with-no-rule-new-verified-rules/`, report section "Found on the way, not changed").

- **F36, `bce` (`src/typed/passes.ts`, around line 615):** it accepts a dominating `i < buf.length` as proof for a later `buf[i]` when the index has the same *set* of reaching definitions at the branch and at the access. Equal sets are not equal values: in the test's program the only assignment to `i` lies between the two and reaches both. Today `bce` removes the check and only the meaning contract rejects the pass (16 of 40 cases disagree). The fix proposed there: compare values (SSA names), not definition sets.
- **F38, `lvn` (`src/typed/passes.ts`, around line 525):** run a second time before `rotate` on `regex-nfa`, it throws `[absent] v:regexMatch.587 is not used in regexMatch at this revision` (from `src/typed/tx.ts`). A pass should be applicable to any revision it is given. Find why it refers to a value that is no longer used, and fix it.

## Acceptance (all of these, checked on your last commit)
- **The tests:** `F36: bce keeps a bounds check when the index is reassigned between the guard and the check` and `F38: lvn can run a second time (speed with lvn again before rotate, on regex-nfa)` in `tests/typed/d2-defects.test.mjs` pass without their `todo`.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. A difference is allowed only in projects where your change to `bce` or `lvn` applies; list each one with its reason in the report, and no project may get slower (more instructions) than in the baseline.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass, apart from the `todo` tests of other steps.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier only on files that were formatted before you changed them.
- **Tests of the correct behaviour already exist.** `tests/framework/r3-defects.test.mjs`, `tests/tensor/r3-tix-in-plans.test.mjs` and `tests/typed/d2-defects.test.mjs` hold one `todo` test per refactor step. Your step's test is named in the acceptance above: make it pass and remove its `todo` option in the same commit. Do not weaken a test's assertions; if you believe one is wrong, say so in your report and leave it.
- **Scope:** `src/typed/` and tests. Not `src/framework/` or `src/tensor/`.
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
