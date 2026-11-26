You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles Typed, a small statically typed language, to 32-bit RISC-V (RV32IMF). It is built on an IR framework (`src/framework/`) in which every optimization pass is checked against the original program, and in which every IR entity records its provenance: which pass, rule and revision produced it, and from what.

Your ticket is <ID>. The question is a performance regression.

## The regression
`corpus/projects/bytecode-vm` is a small stack-machine interpreter written in Typed. Its notes give the measurements, which `scripts/explore.js` reproduces. At `n = 12, seed = 8`, the checked `speed` pipeline (`PIPELINES.speed` in `src/typed/passes.ts`) makes it slower:
- seeded Fibonacci: 7,678 RV32 instructions at r0, 9,286 after `speed`;
- rolling checksum: 6,874 at r0, 8,218 after `speed`.

The evaluator shows the same at the IR level. Fibonacci executes 4,131 statements at r0 and 5,350 at `speed`; checksum 3,699 and 4,690. It is the only corpus program that `speed` makes worse.

## What to do
- **This turn: investigate and design.**
  - Find which pass applications cause the extra work, and why. Use the provenance the framework records (see `src/typed/program.ts`: `why`, `whyChain`, `lineage`, `history`, `edits`, `diff`, and the revision list).
  - Attribute the extra executed statements or instructions to specific pass decisions, with numbers.
  - Write a design document (docmgr `design-doc`) with the diagnosis, the evidence, and a proposed fix with the simplest alternative named.
  - Start your diary, and commit.
  - A reviewer will reply in this session; you implement after the review.
- **The fix,** next turn, must:
  - leave the VM at or below its r0 instruction counts after `speed`;
  - not raise the `speed` instruction count of any other corpus project on its benchmark;
  - keep every pass checked (`node tools/parity.mjs <project>` agreeing).

  A cost check, a guard on a pass, a change to the pipeline, or a correction to a pass are all candidates. Choose by evidence.

## Repository facts
- Build with `npm run build`. Tests are `node --test tests/<dir>/<name>.test.mjs`. `tests/typed/bytecode-vm.test.mjs` and `corpus/projects/bytecode-vm/scripts/explore.js` show how to compile and measure an image (`p.compile({ coalesce: true })`, `image.run(...)`).
- The corpus-wide tests (`tests/typed/backend.test.mjs` P2.4 and P2.6, `tools/parity.mjs`) already check every project's images and pipelines. A fix needs its own test only for the behaviour it adds.
- In the sandbox, a test that spawns `node` can fail with EPERM. Request escalation for that command.
- Scope: you may change `src/typed/` (passes, pipelines, the backend) and `src/framework/`, and add a tool under `tools/` if the attribution needs one. Do not modify other corpus projects or unrelated tests. Run only the tests that cover what you change. Do not run the full suite (`npm test`): many agents share this machine.
- Use your docmgr and diary skills. Commit on your current branch with messages starting `<ID>:`. Do not push.
- Final message: the diagnosis in three sentences, the attribution numbers, the proposed fix, the commit hash.
