All checks are green and the worktree is clean at the last commit.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-046-C--a-standard-library-of-compiler-algorithms-liveness-and-its-two-backend-clients/`
- Report: `.../reference/02-report.md` (diary `.../reference/01-diary.md`, design `.../design-doc/01-stdlib-liveness-interface-scope-and-layout.md`, probes `.../scripts/01-unreachable-block-scopes.mjs`, `.../scripts/02-unreachable-blocks-in-corpus.mjs`)

## What changed, file by file

- `src/stdlib/index.ts` — new: the library index with the layer table (leaf/middle/upper/top from design doc D), the admission rule, one line per later module, and the re-export of liveness.
- `src/stdlib/flow/liveness.ts` — new: `liveness(shape, scope)` over `LivenessShape` (block count, successors, item ranges, `reads`/`writes` per item), required `LivenessScope` (`'all'` | `'entryReachable'` + entry), returning `liveIn`/`liveOut` per block plus `walkBackwards(block, visit)` for per-item live sets.
- `src/typed/backend/regalloc.ts` — added `machineLiveness(code, blocks?)` (the shape binding with scope `'all'` and the reason); `intervals()` lost its use/def loop and fixpoint (23 lines) and reads the primitive; `Intervals.liveOut` retyped `readonly ReadonlySet<number>[]` (unread in the repo). `machineBlocks`, `allocate`, `physicalOccupancy` untouched.
- `src/typed/backend/coalesce.ts` — same two sweeps deleted (23 lines); interference edges now built inside `live.walkBackwards(...)`; copy exceptions unchanged.
- `tests/stdlib/liveness.test.mjs` — new: 8 tests (loop+diamond hand-computed sets, per-item sets, use-vs-def order, a variable read three times, the unreachable block under both scopes, non-zero entry, 40 seeded random graphs against a search-based reference of the definition).
- `tests/stdlib/imports.test.mjs` — new: 3 tests (no import outside `src/stdlib/`, the layer direction, the index re-exports every module).
- Ticket `scripts/01-…`, `scripts/02-…`, diary, report, tasks, index, changelog, two vocabulary topics.

## Acceptance results

- **Tests added:** `node --test tests/stdlib/liveness.test.mjs tests/stdlib/imports.test.mjs` → 11 tests, 11 pass, 0 fail. The unreachable-block test asserts `'all'` → live-out `{64, 65}` and `'entryReachable'` → `{}`, plus that the reachable blocks agree under both. The import test was probed with two throwaway modules (one importing `../../framework/dataflow/solver.js`, one in `graph/` importing `../flow/liveness.js`); both failed with the offending path named.
- **Baselines:** `node …/IRWB-039/scripts/02-baselines.mjs check` → `no differences from …/various/baselines/main.json` (5m05s, on the committed code; the informational timing line moved, not compared).
- **Suites:** typed 188 tests / 183 pass / 0 fail / 3 todo (F36–F38) / 2 skipped; framework 242 / 238 / 0 fail / 4 todo (F33×2, F34, F35); workbench 25 / 24 / 0 fail / 1 skipped; tensor (no gpu) 45 / 44 / 0 fail / 1 todo (F27). The existing `tests/typed/backend*.test.mjs` pass unchanged.
- `npm run check` clean; `npm run format:check` lists 9 files, all unformatted before this step (none mine); `node tools/build-site.mjs` builds (`131 source files`).

## Where I disagree with the brief, and what I left out

1. **No `todo` test exists for this step.** The three defect files hold one `todo` per fix step (F27, F33–F38); nothing mentions the standard library. So my tests are new, in a new `tests/stdlib/` suite (not one of the four listed suites — it is picked up by `npm test`'s glob and I ran it explicitly), and no `todo` was removed because none existed.
2. **A third liveness sweep remains:** `physicalOccupancy()` in `regalloc.ts:155` runs the same backward equations over `Int32` bitmasks (different accessors, different queries). It is not one of the two clients the brief names, and converting it means building sets and bitmasks per instruction in a path the baselines cover only indirectly; it is under "Later". If the intent was "no sweep left in `src/typed/backend/`", that is another step.
3. **Probe 02 is the uncomfortable measurement:** across 100 project-pipelines at `r0` and `speed` (3,730 Typed blocks), **zero** blocks are unreachable — so the baselines cannot detect a wrong scope, and the test is the only guard. That is why it asserts both scopes.
4. **Layering D is not in this worktree** (only named in IRWB-039's design doc), so the layer assignment of the later modules is mine; two placements a later step may move are flagged in the report.
5. **Left out deliberately:** step 2c (`graph`/`lattice`/`ssa` moves) and a generic fixpoint solver — liveness carries its own 12-line loop, the one place this step duplicates a concept the framework already has (`dataflow/solver.ts`, which the library may not import).

Last commit: `67e8cf4` (code and tests: `a8f7afe`).
