You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It holds a reusable IR framework (`src/framework/`) in which every pass is checked, with two domains on it. One is Typed, a small statically typed language compiled to 32-bit RISC-V (`src/typed/`, the corpus in `corpus/`, the workbench in `src/workbench/`). The other is Tix, a tensor language (`src/tensor/`).

Your ticket is <ID>. Make five small fixes on the Typed side, each with a regression test. Create the ticket with docmgr ("Typed-side fixes F2 to F6"), keep a short diary, and commit each fix separately, with messages starting `<ID>: F<n>`. Do not push.

## The fixes

**F2: `imageFromCode` signatures can be omitted.** `imageFromCode` (`src/typed/backend/run.ts`) takes the reference compiler's `signatures` as an optional last argument that defaults to `[]`. A caller that forgot them got an image whose f32 functions were called with the wrong convention, so `dot3` showed 100 disagreements that were not real.
- Needed: make the mistake impossible. Either require the argument, or carry the signatures with the compile result, so that callers pass them without knowing.
- Choose the smaller change and say why in the diary. Update every caller.

**F3: `tools/reference-check.mjs` ignores its project argument.** It always checks every project in the corpus. Four implementers worked around it.
- Needed: project ids given on the command line restrict the check to those projects. Unknown ids are an error. With no ids, it checks all projects, as now.

**F4: `wrapProse` mis-wraps list items that are already wrapped.** `wrapProse` (`src/typed/format.ts`) hard-wraps Markdown paragraphs and list items. Given a list item whose text already continues on indented lines, it drops the continuation indent and splits the item in two. So `tools/format-corpus.mjs` refuses the chess project's `notes.md`.
- Needed: wrapping an already-wrapped list item keeps it one item, with its continuation indent. Wrapping is idempotent: wrapping wrapped text changes nothing.

**F5: corpus-wide tests hard-code totals.** Some tests in `tests/typed/` assert corpus-wide totals: numbers of projects, functions and cases. Adding six projects broke five of them, while every per-function assertion passed.
- Needed: assert per-project properties, or derive the totals from the corpus, so that adding a valid project breaks no test. Keep every property the tests check now.
- List the tests you changed and what each now asserts.

**F6: two parsers for `project.json`.** `projectSource` (`src/typed/project.ts`) and the workbench's `metaOf` (`src/workbench/projects.ts`) each read `project.json`. So a new field had to be wired twice (`ingest` and `entries`).
- Needed: one parser, used by both, with the same results for every project in the corpus.

## How

- **Read before changing:** the code in question and its tests.
- **Tests first:** for each fix, write the regression test first, run it on the unfixed code, and record in the diary how it fails. Then make the smallest change that passes it.
  - For F5, the "regression test" is the changed tests. Show that they pass now, and that they would still pass with one more valid project. You can try that with a temporary copy of a corpus project, which you then remove.
- **Do not change** the compiler's output, the corpus's results, or any behaviour the fixes do not need.
- **Build:** `npm run build` (`tsc`, into `dist/`).
- **Tests:** `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Run `tests/typed/*.test.mjs` and `tests/workbench/*.test.mjs` (whichever exist) before your last commit. Do not run the full suite (`npm test`): other agents share this machine.
- **Formatting:** TypeScript sources keep the repository's Prettier settings. Run Prettier only on files that were formatted before you changed them.
- **Scripts:** put every probe, scratch test and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Outside your worktree,** use nothing.

## Your final message

For each fix:
- the commit hash;
- the test that failed before the fix, and how it failed (for F5, the tests changed);
- the files changed.

Then the test counts from your last run.
