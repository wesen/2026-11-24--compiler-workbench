---
Title: Diary
Ticket: IRWB-038-C
Status: active
Topics:
    - framework
    - design-review
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:54:51.298124701-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

IRWB-038-C, a design-level research review of the framework in `src/framework/`, under the R3 brief
(`ttmp/2026/11/26/IRWB-019-.../various/prompts/r3/claude/IRWB-038-C.md`), plus the coordinator's addition of a
standard library of compiler building blocks (`.../prompts/r3/common.md`).

## Step 1: orientation, ticket, and the survey plan

Created the ticket with docmgr (`IRWB-038-C`), a design doc and this diary. Read the three framework READMEs,
`PATTERNS-AND-REWRITES.md`, `passes/define-pass.ts`, `passes/bridge.ts`, the whole of `src/tensor/index.ts`,
`passes.ts`, `fusion.ts`, `contract.ts`, `cuda-contract.ts`, the head of `src/typed/{analyses,sccp,passes,tx,attribute}.ts`,
`BACKLOG.md` sections 1-3, and the report artifact's "Where the framework's promises have not held up".

The unmerged material is about forty worktrees (diff sizes from 91 to 2,096 lines in `src`+`tests` against
`t6-base`). I delegated the per-cell survey to five read-only Explore agents (T6 in two halves, D1, A0, B1), each
asked for per-cell `path:line` evidence of machinery built, framework parts bypassed or modified, and the
cross-cell recurrences. I read the merged code myself, so the core claims rest on my own reading; I spot-check the
agents' load-bearing citations before using them.

First observations from the merged code (to be checked by probe where they are behavioural):
- an import census of `src/tensor`, `src/typed`, `src/workbench` against each framework module: `core/runtime`
  (`Compiler`), `core/query`, `core/records` and `strategy/editing` have no domain importer; the rewrite engine
  (`ir/rewrites.ts`) is imported only by labs/conformance; Typed uses only the pattern builders
  (`src/typed/rules/form.ts:22-23`);
- Typed has its own transaction layer (`src/typed/tx.ts`, 531 lines) with its own write kinds, provenance
  (`origin`, `because`) and edit records, and derives framework correspondence after the fact from origins
  (`src/typed/passes.ts:119-162`); write declarations are enforced twice, by `Tx` and by `definePass`;
- Tix has three ways to define a checked transformation: `definePass`+`applyNativePassSync` (`src/tensor/index.ts:39`),
  `defineTransformation`+`manager.execute` for the lowering (`src/tensor/cuda-contract.ts:203-249`), and plain
  functions for fusion planning (`src/tensor/fusion.ts:142`), which is not a pass at all.

**What was tricky:** the import census by regex over `index.js` re-exports gives false positives; I switched to
grepping for used symbols (`saturate`, `beginEdit`, `new Compiler`).

## Step 2: three probes on the merged code

Built the worktree (`tsc`, with `node_modules` linked from the main checkout; `dist/` is ignored) and ran three
probes, each committed with its output beside it in `scripts/`:

- `01-tix-correspondence-and-runners.mjs`. (a) Tix `inline` on `a[i]=x[i]*2; b[i]=a[i]+1` records
  `f/a -> removed` and `f/b -> retained`: the framework-derived correspondence says the producer disappeared,
  while in fact it was merged into its consumer. That is not only coarse, it is wrong for any use that pushes a
  measure (cost, provenance) along it. (b) `applyNativePassSync` refuses a pass with `preserves`
  (`badResult: This pass requires the asynchronous analysis manager`, `src/framework/passes/define-pass.ts:231-232`).
  (c) **F27 as written is not the blocker.** `passAlgorithm(inlinePass, {manager})` in a two-step strategy plan
  `succeeded`; `applyPass` runs a Tix pass fine. What Tix cannot do in a plan is keep its meaning check, because
  that check is a synchronous closure (`meaningGate`, `src/tensor/contract.ts:121`) passed to the runner, not a
  `TransformationDefinition`. The gap is "the gate is not a contract", not "the bridge is async".
- `02-sampled-check-assurance.mjs`. A differential invariant whose case generator only yields odd inputs accepts
  a function that is wrong on every even input, and the manager records the result with `assurance: 'checked'`,
  the same word an exact checker gets (`src/framework/contracts/analysis-manager.ts:1177`). The distinction exists
  only in `assuranceOf` (`src/framework/contracts/differential.ts:377-380`), which nothing calls. The `Assurance`
  type has no sampled level (`src/framework/contracts/types.ts:164`).
- `03-framework-usage-census.mjs`. By imported symbol: `core/runtime`, `core/query`, `core/records` (1,240 lines),
  `ir/rewrites` (856), `ir/transactions`, `ir/diff`, `ir/store`, `ir/traversal`, `contracts/effects` and
  `strategy/editing` have no direct importer in `src/tensor`, `src/typed` or `src/workbench`. Transactions and diff
  are reached indirectly through `applyPass`; the rewrite engine and the core runtime are not reached at all.
  Tix imports nothing from `dataflow`, `strategy` or `ir/patterns`.

## Step 3: survey reports for T6, D1 and A0, with spot checks

Four of the five survey agents returned (T6 in two halves, D1, A0). I spot-checked one or more load-bearing
citations per report by reading the file at the cited line; all matched:
- T6: `PassSpec.legal` (`t6-op-irwb-033-d/src/framework/passes/define-pass.ts:101`); sync `preserves` by recompute
  (`t6-g-h-irwb-033-f/.../define-pass.ts:259-265`); gate gets the correspondence
  (`t6-sm-irwb-033-a/.../define-pass.ts:228`); `PassSpec.postcondition` (`t6-am-irwb-033-b/.../define-pass.ts:89-90`);
  `PassSpec.source` (`t6-ds-h-irwb-033-g/.../define-pass.ts:90`); **two** synchronous strategy interpreters, not one
  (`t6-ds-x-irwb-033-h/src/framework/strategy/sync.ts:94` `runPlanSync`, `t6-fa-irwb-033-e/src/framework/strategy/sync.ts:37`
  `executeSync`); the bridge gate mode (`t6-g-max-irwb-033-j/src/framework/passes/bridge.ts:56-57`); `planFusion`
  re-run inside passes (`t6-op-irwb-033-d/src/tensor/schedule.ts:441`, `t6-sm-irwb-033-a/src/tensor/schedule.ts:268`,
  `t6-fa-irwb-033-e/src/tensor/schedule-passes.ts:121`); the only `composeCorrespondence` use
  (`t6-gf-h-irwb-033-i/src/tensor/cuda-contract.ts:215`).
- D1: base `heat()` (`src/typed/backend/run.ts:175`) unused by every cell; only `d1-am` calls `whyEntity`
  (`d1-am-irwb-034-b/src/typed/attribution.ts:40`); `d1-op` copies `whyEntity`'s skip rule
  (`d1-op-irwb-034-f/src/typed/attribution.ts:127`); the merged loop fix (`src/typed/analyses.ts:216-226`).
- A0: `a0-g-h` builds an independent matcher on purpose (`a0-g-h-irwb-035-e/src/typed/edit-class.ts:5-7`, `:107`);
  pass-name class tables (`a0-sm-irwb-035-a/src/typed/edit-classification.ts:32`); the framework edit `Reason`
  field that Typed's `Tx` does not use (`src/framework/ir/types.ts:210`).

Counting framework edits across the ten T6 cells: seven of ten changed `src/framework/passes` or
`src/framework/strategy`, and every change is one of four shapes: a precondition (`legal`), a synchronous
postcondition or preservation check (`postcondition`, sync `preserves`, `claims`, gate with correspondence), a
cross-IR input (`source`), or a synchronous strategy executor (two of them, `syncPassAlgorithm` twice, a bridge gate
mode once). That is the clearest evidence in the material: independent agents converged on the same four holes.

What I now think the root is (to be argued in the design doc): the framework's unit of transformation is an
endomorphism `S -> S` with an asynchronous acceptance protocol wrapped around it, while both domains' important
steps are translations `S -> T` whose checks are mostly synchronous and structural. Every workaround above is a
local patch over that mismatch.

## Step 4: the B1 survey, and probe 04 (a binding-time analysis on the existing solver)

The B1 agent returned. Spot checks matched: the two near-identical flow-insensitive BTAs
(`b1-op-irwb-036-f/src/typed/pe.ts:76`, `b1-fa-irwb-036-g/src/typed/bta.ts:65`), the near-identical memo keys of the
online specializers (`b1-sm-irwb-036-a/src/typed/specialize-memory.ts:57`, `b1-am-irwb-036-b/src/typed/residualize.ts:61`),
the hand-written edge-constant analysis in the uncommitted D cell (`b1-ds-x-irwb-036-d/src/typed/dispatch.ts:76`),
and the identical `WriteKind 'frame'` added twice (`b1-op-irwb-036-f/src/typed/tx.ts:28`,
`b1-sm-irwb-036-a/src/typed/tx.ts:27-28`). No B1 cell touched `src/framework`; none used `framework/dataflow` for
its BTA.

The cells' reason for hand-writing the BTA is not stated anywhere; my hypothesis was that the solver's name and
signature (`FlowGraph` of blocks) hide that it is a generic monotone-framework solver. Probe
`04-bta-on-the-existing-solver.mjs` encodes a flow-insensitive BTA as a forward problem over the def-use
dependence graph (a virtual entry with an edge to every local, a two-point lattice S below D) and solves it with the
unmodified `solve` (`src/framework/dataflow/solver.ts:90`): `{pc:S, op:S, acc:D, x:D, tmp:D}` in 7 iterations, the
expected division. So the gap is not the solver but the missing graph builders (def-use, SSA, constraint graphs)
and the CFG-centred naming of `dataflow()` (`src/framework/dataflow/analysis.ts:110`), which ties a spec to blocks.
