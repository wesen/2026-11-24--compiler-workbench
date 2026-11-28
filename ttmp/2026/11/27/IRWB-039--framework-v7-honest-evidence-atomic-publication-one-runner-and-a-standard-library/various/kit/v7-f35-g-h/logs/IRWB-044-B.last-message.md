## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-044-B--f35-correspondence-that-is-checked-for-what-it-claims/`
- Design: `design-doc/01-coverage-vocabulary-the-default-and-the-consistency-rule.md` (committed first, `e68ee71`)
- Report: `reference/02-final-report.md` · Diary: `reference/01-implementation-diary.md` · Probe: `scripts/01-coverage-and-consistency.mjs`

## What changed

- `src/framework/contracts/types.ts` — `CorrespondenceCoverage` (`partial | sourceTotal | targetTotal | bothTotal`) and optional `coverage` on `CorrespondenceRequirement`; default `bothTotal` (every framework-built record goes through `makeCorrespondence`, which already accounts for every entity on both sides).
- `src/framework/contracts/definitions.ts` — `defineTransformation` rejects an unknown coverage word.
- `src/framework/contracts/analysis-manager.ts` — **coverage**: the transaction `verify` rejects a record whose groups leave uncovered what the requirement's `coverage` claims. **consistency**: `validateCorrespondence` rejects a group mapping an entity that survives in the target (diff shows unchanged or updated) to nothing — computed as the structural diff's id-level classification over the entity universes the membership check already pins to the artifacts; it covers `manager.preserve` justifications too.
- `src/tensor/cuda-contract.ts` — the `kernels` requirement declares `coverage: 'targetTotal'` (the baseline is the whole module; a lowering maps only the lowered function's statements to kernels).
- `tests/framework/r3-defects.test.mjs` — F35 `todo` removed.

**What each existing requirement now declares:** labs' four `entities` requirements (`generic-ir-edit`) → `bothTotal` (default); CUDA `kernels` → `targetTotal`; tests' ad-hoc requirements → `bothTotal` (default). Typed's contracts declare no correspondence requirement.

## Acceptance results

- **The test:** `F35: zero mapping groups and a false group are rejected; the honest mapping is accepted` passes, `todo` removed.
- **Baselines:** `02-baselines.mjs check` prints `no differences`.
- **Suites** (typed, framework, workbench, tensor non-GPU; 70 files): 500 tests, 490 pass, 0 fail, 3 skipped, 7 todo (F27, F33 ×2, F34, F36, F37, F38 — other steps' todos).
- `npm run check` clean; `node tools/build-site.mjs` builds. `format:check` warns on 9 pre-existing files, none touched by this step.

## Left out / notes

- The consistency rule is one direction only (mapped-to-nothing must not name a survivor): `makeCorrespondence` itself emits `unmapped-origin` entries (`from: []` for an id that also exists in the source) when a consumed id is reused by a new entity, and the id-level classification cannot distinguish name reuse from survival. No brief or test assertion was found wrong.
- The check implements the diff's id-level classification (removed / inserted / unchanged-or-updated) as set operations over the entity universes; a full `diffGraphs` call in the manager would need adapters in the contracts layer, a dependency it does not have, and the stated rule treats unchanged and updated identically.
- No escalation was needed (no EPERM on any test run).

**Last commit:** `a3d04a9`
