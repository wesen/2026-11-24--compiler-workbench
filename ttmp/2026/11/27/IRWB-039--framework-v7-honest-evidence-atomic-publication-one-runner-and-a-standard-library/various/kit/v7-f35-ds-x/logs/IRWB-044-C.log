Done. Ticket and report are in place, code and suites are verified on the final tree.

## Ticket and report

- Ticket: `ttmp/2026/11/27/IRWB-044-C--correspondence-that-is-checked-for-what-it-claims-declared-coverage-and-consistency-with-the-structural-diff/`
- Design: `design-doc/01-f35-correspondence-coverage-and-consistency-with-the-structural-diff.md`
- Report: `reference/01-f35-report-correspondence-coverage-and-the-structural-diff-audit.md`
- Diary, probes: `diary.md`, `scripts/01-what-the-diff-shows.mjs`, `scripts/02-existing-correspondences-coverage.mjs`, `scripts/03-the-two-checks-separately.mjs`

## What changed

- `src/framework/ir/diff.ts` — added `EntityPresence` + `entityPresence(before, after)` (`inserted`/`removed`/`kept`); `diffGraphs` now classifies entity changes through it (same output and order).
- `src/framework/contracts/types.ts` — `CorrespondenceCoverage` (`partial`|`sourceTotal`|`targetTotal`|`bothTotal`) and `CorrespondenceRequirement.coverage`.
- `src/framework/contracts/definitions.ts` — `DEFAULT_CORRESPONDENCE_COVERAGE = 'bothTotal'`; every requirement validated and stored with an explicit coverage.
- `src/framework/contracts/analysis-manager.ts` — `entityUniverse` (type's `entities()` else the record's list), entry IDs now checked against a declared universe, `auditCorrespondenceContent` (coverage per policy + the deletion rule over `entityPresence`, same-kind only); requirement loop passes the requirement, `preserve`/transfer path untouched.
- `src/tensor/cuda-contract.ts` — the one cross-kind requirement (`kernels`) declares `coverage: 'partial'` with the reason inline.
- `src/framework/contracts/README.md` — requirement line + correspondence section state both checks.
- `tests/framework/r3-defects.test.mjs` — `todo` on the F35 test removed, assertions untouched.
- `tests/framework/correspondence-coverage.test.mjs` (new) — vocabulary/default, `sourceTotal`/`targetTotal`, audit alone under `partial`, cross-kind boundary, non-enumerating type, unknown policy.

## Acceptance (code of `02ac33a`, identical to the last commit)

- F35 test: `✔ F35: zero mapping groups and a false group are rejected; the honest mapping is accepted` — no todo.
- `02-baselines.mjs check`: `no differences from .../various/baselines/main.json` (twice; final tree too).
- `tests/framework` 245 pass / 0 fail / 3 todo (F33, F34, one other step's); `tests/typed` 183 pass / 0 fail / 2 skipped / 3 todo; `tests/workbench` 24 pass / 0 fail / 1 skipped; `tests/tensor` minus `*-gpu` 44 pass / 0 fail / 1 todo.
- `npm run check` clean; `node tools/build-site.mjs` builds; Prettier clean on my five changed sources (the nine files `format:check` still lists were unformatted before and are untouched).

## Disagreements and omissions

- `tests/tensor/cuda.test.mjs` "concurrent lowering checks…" verifies a candidate CUDA unit with an empty kernel inventory and asserts the *differential* reason. Under `bothTotal` the audit rejected it first ("does not cover source entities: f/y"). I left the assertion alone and declared `partial` on the lowering requirement; the report records this, and probe 02 shows the real lowering is total anyway.
- The consistency rule is one-directional (empty target naming a kept entity). The mirror form `{from:[], to:[kept]}` is not rejected because the framework's own `makeCorrespondence` emits it as `unmapped-origin`; forcing surviving entities to be mapped is the coverage policy's job. Probe 03 shows the audit rejecting the false group on its own under `partial`.
- `contracts` now imports `ir/diff.ts` (first such edge; layering test and cycle check still hold) so the audit shares `diffGraphs`' classification rather than copying it.
- Requirement `coverage` is now in a definition's schema (visible in descriptors/cache keys). No typed-side requirement exists, so nothing to declare there; `src/labs/` untouched (its four requirements keep the default `bothTotal`).

Last commit: `9d9e373` (ticket markdown only; `git diff --stat 02ac33a HEAD -- src tests` is empty).
