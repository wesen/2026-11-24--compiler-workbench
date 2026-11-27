You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
- **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
- **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).

Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and every edit carries a correspondence back to the IR before it. The framework is being refactored in small steps (ticket `ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/`, design doc `design-doc/01-...md`). Your step is one of them.

Your ticket is <ID>. This is a **specified framework change**, in one session of up to two hours. Create your ticket with docmgr under `ttmp/2026/11/27/`, keep a short diary, and end with a short report in the ticket.

## Your task (F35): correspondence that is checked for what it claims
A transformation contract can require an entity correspondence between its input and output. The manager checks it (`src/framework/contracts/analysis-manager.ts`, around lines 1110-1128) only for membership: the declared endpoint lists must equal the IR's entities, and every entry must name known entities. It never checks that the entries cover anything, or that they agree with what actually changed. So a correspondence with complete lists and zero mapping groups is accepted, and so is a group that says a surviving entity was deleted. R3's probe is `ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/r3-synthesis/scripts/04-correspondence-content.mjs`.

Add two checks:
1. **Coverage:** a correspondence requirement declares what its mapping must cover (for example: partial, every source entity, every target entity, or both), and the manager rejects a mapping that does not cover it. Choose the default so that every existing correspondence in the repository still passes, and say what each existing requirement now declares.
2. **Consistency with the structural diff:** an entry may not contradict what the diff of the two revisions shows (for example, an entity the diff shows unchanged or updated cannot be mapped to nothing). The framework's structural diff is in `src/framework/ir/diff.ts`.

Write a short design first (the coverage vocabulary, the default, the consistency rule), commit it, then implement.

## Acceptance (all of these, checked on your last commit)
- **The test:** `F35: zero mapping groups and a false group are rejected; the honest mapping is accepted` in `tests/framework/r3-defects.test.mjs` passes without its `todo`.
- **The baselines:** `node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check` (after `npm run build`) prints `no differences`. It compares RV32 image hashes, instruction counts and edit records for every corpus project under r0, O2 and `speed`, and the CUDA source and `optimizeTix` revisions for every Tix program. This step must not change them.
- **The suites:** `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, and `tests/tensor/*.test.mjs` except the `*-gpu.test.mjs` files, all pass, apart from the `todo` tests of other steps.
- `npm run check` (tsc) is clean, and `node tools/build-site.mjs` builds if you changed `src/framework/` or `src/workbench/`.

## Repository facts
- **Build and test:** build with `npm run build` (`tsc`, into `dist/`). Tests are `node --test tests/<dir>/<name>.test.mjs` and import from `../../dist/...`; on Node 24, pass files, not a bare directory. Do not run the full suite (`npm test`) and do not run the `*-gpu.test.mjs` files (there is no GPU here): other agents share this machine. Prettier: 110 columns, single quotes; `npm run format:check` covers `src/**/*.ts`; run Prettier only on files that were formatted before you changed them.
- **Tests of the correct behaviour already exist.** `tests/framework/r3-defects.test.mjs`, `tests/tensor/r3-tix-in-plans.test.mjs` and `tests/typed/d2-defects.test.mjs` hold one `todo` test per refactor step. Your step's test is named in the acceptance above: make it pass and remove its `todo` option in the same commit. Do not weaken a test's assertions; if you believe one is wrong, say so in your report and leave it.
- **Scope:** `src/framework/` and tests; `src/typed/` and `src/tensor/` only where an existing correspondence must declare what it covers.
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
