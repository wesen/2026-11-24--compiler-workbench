You are working in a git worktree of the IR Workbench repository (TypeScript, Node). It contains a compiler from Typed, a small statically typed language with TypeScript-like syntax, to 32-bit RISC-V (RV32IMF), built on an IR framework in which every optimization pass is checked against the original program. Your task: implement the corpus project designed in your ticket <ID>. The design document is in `ttmp/2026/11/26/<ID>--*/design-doc/`. It has been reviewed; implement it as designed. Where the design turns out to be wrong about the code, follow the code and record the deviation in your diary.

## Read first
- Your design document.
- `corpus/reference.md` and two or three existing corpus projects (for example `corpus/projects/sort`, `checksum`, `histogram`).
- `tests/typed/project-meta.test.mjs`: `project.json` now supports `"ingest": { "tape": true }` (needed for frame arrays) and `"entries": [...]` (checks generate cases for the listed entry functions only), in `Program.fromProject`, `ingestProject` and `tools/parity.mjs`.

## Deliverables
- The corpus project under `corpus/projects/<name>/` as the design describes (`.typed` sources, `project.json`, `notes.md`, any scripts the design calls for).
- The tests and checks the design calls for, under `tests/typed/`.
- Your ticket's diary (use your docmgr and diary skills), tasks and changelog, kept current as you work.

## Environment
- `node_modules` is found from the repository root. Run `npm run build` once before using `dist/`.
- Six agents share this machine. Run only your own tests (`node --test tests/typed/<your-test>.test.mjs`) and, for your project, `node tools/parity.mjs <name>` or `node tools/reference-check.mjs <name>` if useful. Do not run the full test suite (`npm test`), corpus-wide tools without a project argument, or anything that touches Candela.

## Constraints
- Do not modify `src/`, `tools/`, other corpus projects, other tickets, or existing tests. Adding your project's id to `corpus/projects/index.json` is allowed.
- Never run code from downloaded archives under `ttmp/**/sources/`.
- Commit at sensible points on your current branch with messages starting `<ID>:`. Do not push.
- Final message: what you built (paths), how it was checked (commands and results), what deviates from the design, and the commit hashes.
