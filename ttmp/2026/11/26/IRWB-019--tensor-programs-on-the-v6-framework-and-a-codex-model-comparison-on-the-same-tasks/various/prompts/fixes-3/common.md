You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It holds a reusable IR framework (`src/framework/`) in which every pass is checked, with two domains on it. One is Typed, a small statically typed language compiled to 32-bit RISC-V (`src/typed/`). The other is Tix, a tensor language compiled to CUDA (`src/tensor/`).

Your ticket is <ID>. Make one small framework fix with regression tests. Create the ticket with docmgr ("F23: check correspondence entity lists against the artifacts"), keep a short diary, and commit with messages starting `<ID>:`. Do not push.

## The fix

**F23: a correspondence's entity lists are self-declared.** `makeCorrespondence` (`src/framework/ir/correspondence.ts`) checks that each entry's `from` and `to` IDs appear in `sourceEntities` and `targetEntities`, and that every listed entity is accounted for. But the caller supplies those two lists, and nothing compares them with the entities the two artifacts actually contain.
- Two implementers found it from opposite sides. One passed no target list, so a mapping `{from: [m, s], to: [k0]}` was rejected ("Unknown target entity k0"). The other passed lists with made-up IDs, or with no target entities at all, and they were accepted.
- For a transformation between IR kinds (for example Tix statements into CUDA kernels), nothing derives the target list. A tensor CUDA artifact is declared with `defineIR` (`src/framework/contracts/definitions.ts`) over a plain value, with no entities.
- **Needed:** an optional way for an IR type declared with `defineIR` to enumerate the entity IDs of a value. Where a correspondence between two artifacts is checked, compare the declared `sourceEntities` and `targetEntities` with the enumerations of the two revisions, when their types provide one, and reject a mismatch with an error that names the IDs.
  - Types that do not enumerate entities keep today's behaviour.
  - Find where correspondences between artifacts are checked: start from `makeCorrespondence`, `semanticCorrespondence` in `src/framework/passes/define-pass.ts`, and the contracts code in `src/framework/contracts/` (`definitions.ts`, `analysis-manager.ts`, `types.ts`).
  - Choose the smallest change that does this, and say in the diary why.
- **Tests:** a made-up source or target ID is rejected, and an omitted real entity is rejected, for types that enumerate. A type without an enumeration behaves as before. Every existing framework test still passes.
- **Not yours:** `src/tensor/` and `src/typed/`. Another agent is changing `src/tensor/` at the same time, so the tensor CUDA artifact adopts the enumeration in a later change. Describe in your report what it would need to declare.

## How

- **Read before changing:** the code in question and its tests (`tests/framework/`).
- **Tests first:** write the regression tests first, run them on the unfixed code, and record in the diary how they fail. Then make the smallest change that passes them.
- **Do not change** any behaviour the fix does not need.
- **Build:** `npm run build` (`tsc`, into `dist/`).
- **Tests:** `node --test tests/<dir>/<name>.test.mjs`; on Node 24, pass files, not a bare directory. Run `tests/framework/*.test.mjs`, `tests/typed/*.test.mjs` and `tests/tensor/*.test.mjs` except files whose names contain `gpu`, before your last commit. Do not run the full suite (`npm test`): other agents share this machine.
- **Formatting:** TypeScript sources keep the repository's Prettier settings. Run Prettier only on files that were formatted before you changed them.
- **Scripts:** put every probe, scratch test and temporary program you write in your ticket's `scripts/` directory, numbered in the order you write them (`01-name.mjs`), and commit them. Nothing you ran should exist only in a scratch directory or a one-off command.
- **Sandboxed sessions:** a test that spawns `node` can fail with EPERM. Request escalation for that command.
- **Outside your worktree,** use nothing.

## Your final message

- the commit hashes;
- the tests that failed before the fix, and how they failed;
- the files changed, and where the check now happens;
- what a tensor CUDA artifact would need to declare to be checked;
- the test counts from your last run.
