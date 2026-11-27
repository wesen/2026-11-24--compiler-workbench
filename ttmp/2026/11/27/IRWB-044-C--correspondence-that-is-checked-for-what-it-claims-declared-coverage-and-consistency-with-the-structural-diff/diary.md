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
