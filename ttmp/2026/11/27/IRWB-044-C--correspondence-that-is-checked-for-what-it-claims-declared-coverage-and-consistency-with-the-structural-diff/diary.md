# Diary — IRWB-044-C (F35)

## Step 1: where the checks go, measured

Read the requirement path: `AnalysisManager.validateCorrespondence` is called from the requirement loop
(`analysis-manager.ts:1441`) and from `preserveInternal` (transfer). Wrote probe 01: for the R3 probe-04
program, `TixIR.entities` gives `['f/p','f/y']` before and `['f/y']` after, while the structural diff
(`diff` over the adapter projections) says `f/p removed`, `f/y updated`. The honest group
`{f/p,f/y} -> {f/y}` therefore names *every* entity of both contract-level universes, and the false group
`{f/y} -> []` names a kept entity as deleted.

Consequence: `bothTotal` is a default that the honest mapping already satisfies, and it rejects zero
groups without any new vocabulary. Wrote probe 02 (tensor corpus, fused and unfused, all six programs):
`kernelCorrespondence` leaves no source statement and no kernel unmapped, so the one cross-kind
requirement can declare `bothTotal` too. The four lab requirements build their record with
`makeCorrespondence`, which is total by construction; their IR types do not enumerate.

Facts established by running, not assumed:
- `dist/` is needed before any probe (`npm run build`, 45 s).
- the entity lists that the contract layer checks are the *statement* entities (`TixIR.entities`), not the
  adapter's projection, which also has the function and the parameters.
- the framework's `diffGraphs` needs `IRGraph`s; the contracts layer is given `IRType`s only, so the audit
  can use the presence projection (inserted / removed / kept) and nothing finer.

## Step 2: the design

Wrote `design-doc/01-...md` before touching `src/`: coverage vocabulary and default, the table of the five
existing requirements, the deletion rule and why the empty-source form is *not* read as a creation claim
(`makeCorrespondence` emits `unmapped-origin` for a kept, unmapped target), the same-kind condition, and
the decision to share `entityPresence` with `diffGraphs` (one import from contracts into ir, no cycle).

## Step 3: implementation, and the first thing the tests caught

Wrote `entityPresence` into `ir/diff.ts` and made `diffGraphs` use it (same output: the sorted union of
IDs, so no diff record changes, and the baselines confirm it later). Added the coverage vocabulary and the
`bothTotal` default in `definitions.ts`, and `auditCorrespondenceContent` in the manager. First run of
`tests/framework/*.test.mjs`: 18 failures, all "Correspondence source coverage cannot be checked: no source
entity list" — my first version *refused* a total claim it could not check. That rejected the transfer
fixture in `contracts.test.mjs` (a listless permutation over an IR type without `entities`) and four lab
transformations whose bridge correspondences declare no lists. The framework's documented position for a
type that does not enumerate is "self-declared correspondence", so I backed the refusal out: no universe,
nothing to cover. The design doc now says so, and the new test pins both halves.

## Step 4: the tensor lowering

`tests/tensor/cuda.test.mjs` failed on "concurrent lowering checks…": it verifies a candidate CUDA unit with
an empty kernel inventory and expects the differential verdict as the reason. With `bothTotal` the audit
rejected that candidate first. I did not touch the assertion (the rule says not to); the `kernels`
requirement declares `partial` instead, with the reason written next to it, and the report records the
disagreement. After that: framework 245/248 pass (3 todo of F33/F34), typed 183/188 (2 skipped, 3 todo),
workbench 24/25 (1 skipped), tensor minus gpu 44/45 (1 todo).

## Step 5: the checks separated

Probe 03 runs the probe-04 program four ways. `bothTotal`: zero groups rejected (coverage: f/p, f/y),
honest accepted, false group rejected (coverage: f/p — the audit never gets to speak). `partial`: zero and
honest accepted, false group rejected by the audit — "Correspondence maps f/y to nothing; the structural
diff keeps it". That is the evidence that the second check is not a consequence of the first.

## Step 6: verification

`npm run check` clean; `node tools/build-site.mjs` builds; `npm run format:check` still lists nine files
that were unformatted before this step (untouched); my five changed sources are prettier-clean.
`scripts/02-baselines.mjs check` on the final code: "no differences".
