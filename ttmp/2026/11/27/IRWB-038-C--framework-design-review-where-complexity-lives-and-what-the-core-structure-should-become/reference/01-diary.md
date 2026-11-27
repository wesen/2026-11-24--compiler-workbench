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
