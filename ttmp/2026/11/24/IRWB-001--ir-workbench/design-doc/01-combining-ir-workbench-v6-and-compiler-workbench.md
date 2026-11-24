---
Title: Combining IR Workbench v6 and Compiler Workbench
Ticket: IRWB-001
Status: draft
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/analysis/01-ir-workbench-v6-import-analysis.md
      Note: v6 analysis this design builds on
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/analysis/02-compiler-workbench-projects-import-and-overlap-analysis.md
      Note: CW analysis and overlap matrix this design builds on
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/compiler-workbench-projects/site/app/engine/api.js
      Note: The wb API surface the combined workbench keeps compatible
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir/types.ts
      Note: v6 adapter/relation model adopted for the kernel
ExternalSources: []
Summary: 'Proposal: one workbench with Compiler Workbench''s product shape and its Typed → RV32 compiler as the flagship, defined entirely on IR Workbench v6''s framework (core, strategy, contracts, ir taken as code, about 5.9k lines) extended where CW needs it. v6''s UI, demo domains, earlier labs and release machinery (about 6.4k lines) are cut.'
LastUpdated: 2026-11-24T18:50:52.07833802-05:00
WhatFor: Deciding the architecture and phasing for the IR workbench built in this repository.
WhenToUse: Before writing the first kernel code; revisit at each phase boundary.
---

# Combining IR Workbench v6 and Compiler Workbench

## 1. Recommendation in one paragraph

Build **one new workbench**. Take its **product shape** from Compiler Workbench (CW): the dock, linked selection, projects as files, scripts, UI DSL, agent and live book. Take its **first domain** from CW too: the Typed → RV32 compiler and its 44 projects, which are the regression corpus. Build it on a **kernel shaped by IR Workbench v6**:

- representation adapters with typed relation categories
- many-to-many correspondence
- the contract vocabulary for declared, checked and transferred guarantees
- Strategy IR as data
- declarative patterns

Do not merge the two code bases wholesale: they share no code, language or IR model, and both have density and test-coverage problems. v6's framework layers are separable, however, and the goal is to define the entire compiler on them. So **v6's whole framework (≈5.9k lines: core, strategy, contracts, ir) is taken as code**, reformatted and reviewed, with its tests, and extended where CW needs it (design-doc/02, E1–E9). Its UI, demo domains, earlier labs and release machinery (≈6.4k lines) are cut; see §3.2. Add a second domain **only after the flagship works**. This keeps CW's narrow promise intact: whatever you write, you see what it changed, why it says that was valid, and whether the program still means what it meant.

## 2. Why this direction

- **CW has a real, non-toy compiler** with a backend, an emulator and an independent oracle. Without that, v6's abstractions are hard to evaluate; with it, every kernel decision can be judged against real passes (licm, bce, regalloc).
- **v6 has the abstractions CW will need** as soon as it grows past one IR. Examples: the machine code is already a second representation (images and instructions), CFG and SSA views would be more, and pass orders and register options are already "alternatives" decisions. CW handles these ad hoc today. v6 shows how to make them uniform.
- **CW's interaction model is the better product**, and v6's UI has never been rendered in a real browser. CW's agent plus the `wb` API is also the most distinctive capability of either project.
- **Neither code base can simply be extended.** v6 is about 1 MB of dense generated TypeScript. CW is untyped classic scripts with hard-coded paths and no unit tests.

## 3. Target architecture

```
┌──────────────────────────── workbench shell (from CW) ─────────────────────────────┐
│ dock · linked selection · views · console · projects-as-files · scripts · UI DSL   │
│ fragments · parameters · agent (one eval tool, modes, revert) · book + reference    │
│ new views from v6: strategy trace (candidates, selection evidence), pattern & match │
│ evidence, correspondence lineage across artifacts, cache explanation (later)       │
└──────────────────────────────────────────┬─────────────────────────────────────────┘
                                           │ wb API (handles, selections, guarded errors)
┌──────────────────────────────────────────┴─────────────────────────────────────────┐
│ orchestration: Strategy IR as data (v6 operators), CW pipelines O0/O1/O2 expressed │
│ as strategies; fork/chooseBest for pass orders and backend options                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ acceptance: contract clauses (v6 vocabulary) whose checkers include CW's           │
│ differential checks (vs r0, vs image, vs reference) and exact domain checkers;     │
│ assurance labels: declared · checked-sampled · checked-exact · transferred          │
├────────────────────────────────────────────────────────────────────────────────────┤
│ facts: CW lattice/worklist solver + v6 AnalysisManager semantics (per exact        │
│ revision, `preserves` keeps them fresh, optional checked transfer)                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ change: transactions with declared writes and required `because` (CW) + stale-head │
│ rejection and many-to-many correspondence (v6); one revision per changing pass     │
│ matching: declarative patterns + schedules (v6) as a library over transactions     │
├────────────────────────────────────────────────────────────────────────────────────┤
│ representation: store + adapters (v6). CW's function/block/stmt/value store is the  │
│ first adapter; machine image/instructions the second; readable ids (CW) qualified  │
│ by artifact + revision (v6)                                                        │
└────────────────────────────────────────────────────────────────────────────────────┘
 domains: typed→RV32 (flagship, CW) · later one v6 lab (expressions or constraints)
 reused tools: Typed front end, RV32 encoders/emulator/disassembler from ds-js-os (pinned)
```

### 3.1 What comes from where

| Element | Source | Adaptation |
| --- | --- | --- |
| Entity ids | CW (readable: `s:blend.7@r6`) | Qualify them with artifact and revision as in v6, so cross-artifact references are exact; keep readable ids for display and typing |
| Revisions | CW (linear r0…rN with undo and checkout) | Add v6's content hash and stale-head check so concurrent agent edits cannot publish over a newer head |
| Store and IR | CW's lifted statements and value trees | Express it through a v6-style adapter (entities, typed relations, roots) so generic views, queries and patterns work on it and on later IRs |
| Provenance | Both | Keep `origin` (made from), `because` (why valid) and `correspondence` (merge, split, delete) as separate fields; `why` and `lineage` work across artifacts |
| Pass declarations | CW (`needs`, `writes`, `preserves`, enforced) | Map them onto the contract vocabulary: `needs` ≈ requires-facts, `writes` ≈ effects, `preserves` ≈ preserves; add `ensures` for postconditions |
| Checks | CW (differential: r0, image, reference) | Make each a checker kind inside a contract clause, with v6's assurance labels; exact checkers (v6) plug into the same slot |
| Analyses | CW solver and lattices | Use v6 AnalysisManager semantics for caching and invalidation; keep the widening rule (`noWidening` refusal) |
| Pipelines | CW builder | Compile them to Strategy IR plans; add fork, chooseBest, attempt and verify; `explain()` shows the plan |
| Patterns | v6 | Optional library alongside imperative `tx.rewrite`; its value is match evidence in the UI |
| Incremental runtime | v6 | **Taken.** The lowering stages (frontend, lift, select, regalloc, encode) are compiler tasks, so edits re-run only what depends on them, with explanations |
| Shell, UI DSL, agent | CW | Keep the API surface; port to typed modules |
| Book and reference | CW structure and live links | Add parts for contracts, strategies and adapters, adapted from v6 guide chapters 4–6 and 10 |
| Engineering | v6 (strict TS, `node:test`) + CW (corpus runner) | Enforce formatting (line-length limit) for readability, keep both kinds of tests, no hard-coded paths, pin the vendored ds-js-os tools to a commit |

### 3.2 How much of v6 is taken

v6's `src/` is about 14.7k lines. Its reusable framework is 5,940 lines in four layers (`core`, `strategy`, `contracts`, `ir`). `strategy`, `contracts` and `ir` each import only `core/data.ts` (95 lines) and `core/types.ts` (131 lines), so they can be taken or left one layer at a time.

"Lift as code" means: vendor the module, run a formatter to undo the dense layout, read it, and port its existing tests as acceptance tests. It does not mean copying blindly.

> **Revised 2026-11-24.** The goal is now to define the *entire* compiler on the v6 framework, extending v6 where CW needs it (see [design-doc/02](./02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md)). The earlier, smaller plan lifted about 2.9k lines and deferred the task runtime and `AnalysisManager`. That plan is superseded: the worked examples run the compiler on both. **The whole framework layer is kept**, and the cuts are everything around it.

**Kept: the framework (≈5.9k lines), as code**

| v6 part | Lines | Role in the compiler | Tests to port |
| --- | ---: | --- | --- |
| `core/` (`types`, `data`, `runtime`, `query`, `records`) | 876 | Lowering stages (frontend, lift, select, regalloc, encode) are compiler tasks: cached, dependency-tracked, explained | `core`, `core-review`, `pass-policy`, `run-extensions` |
| `strategy/` | 590 | O2 and the other pipelines as plans; pass orders and backend options as fork/chooseBest | `strategy`, `strategy-yaml`, `strategy-integration`, `strategy-bridge-review` |
| `contracts/` (incl. `analysis-manager`, `effects`, `registry`) | 1,720 | `optimizationContract`, differential invariants, per-revision facts and checked transfer, acceptance gating | `contracts`, `contract-integration` |
| `ir/` (model, view, transactions, patterns, rewrites, diff, correspondence) | 2,681 | The `typed.blocks` and `rv32.*` adapters, edits, rewrite rules, lineage across stages | `ir-foundation`, `ir-rewriting`, `ir-review` |

Kept does not mean unchanged. These layers receive the extensions E1–E9 from design-doc/02:

- **Small widenings:** a `control` relation category, `because` on edits, and a tiling schedule.
- **New layers on top:** `definePass`, `dataflow()`, `differential()`, the strategy bridge, handles, and r0…rN UX.

**Kept as reference, not shipped:**

- `ir-examples/` (1,759 lines): the four labs, as the Phase 4 second domain. `lab.ts` is the hand-wiring that `definePass` replaces.
- `guide/` (703 lines): the five tutorials, as conformance tests for the semantics we keep.
- Selected docs: guide chapters 4–7 and 10, `src/ir/README.md`, `PATTERNS-AND-REWRITES.md`, `src/strategy/README.md` and `src/contracts/README.md`, as material for the new book.

**Cut (≈6.4k lines of `src/`, plus tooling and history)**

| What | Lines | Why |
| --- | ---: | --- |
| `core/strategies.ts` | 73 | The older in-pass `selectByMetrics`, used only by the domain code below; Strategy IR's `chooseBest` replaces it |
| Workbench UI: `workbench/`, `source-workbench/` | 1,929 (265 KB) | CW's shell replaces it; never rendered in a browser |
| Original domain stack: `pipelines/`, `programs/`, `languages/`, `math/`, `geometry/`, `domains/`, `scene/`, `assembly/`, `adapters/`, `examples/` | 3,310 | CAD bracket, game building, pavilion, four-bar linkage, mechanical door, LOD; outside the Typed → RV32 flagship |
| Earlier labs: `contract-examples/`, `strategy-examples/` | 1,089 | v5 contract lab and v4 mesh-cleanup lab, superseded by the flagship's own contracts and strategies |
| Tests for the cut parts | ~19 files | cad, door, game, physics, game-contracts, cli, workbench, presentation, source-programs, the `*-ui` tests, v5-review, extensibility |
| Scripts | 15 of 19 | Browser checks, v4/v5/v6 report renderers, `package-release.py`, the source/strategy/contracts/IR demos (domain-bound); keep `build.mjs` as a starting point |
| Docs and history | — | README-legacy/v3/v4/v5, v4/v5 reports and acceptance, domain docs (cad, door, game, physics), workbench docs, `report-template.md`, all `output/` evidence |

**In total:** the 5.9k-line framework comes over whole, plus about 2.5k lines kept as reference and tests. About 6.4k lines of `src/` are cut, roughly 43% of v6, along with most of its scripts, docs and release machinery.

## 4. Phases

**Phase 0: get both prototypes running (days).**
- Run `scripts/02-run-verification.sh` on v6 and open its HTML in a browser.
- Serve CW's `site/` locally. Regenerate its content with `test/build.mjs` after fixing the root paths. Point `test/load.mjs` at `ds-js-os/compiler/typed/typed-rv32.js` and run `test/projects.mjs`.
- Record which numbers still reproduce, for example Blend 96 → 88 bytes and the 6,986 agreeing cases.

**Phase 1: kernel and flagship parity.**
- Write a strict-TS kernel: identity, store and adapter, transactions, provenance, facts.
- Port CW's engine (lifting, the 11 passes, analyses, evaluator, checks, backend) onto it.
- **Exit criterion:** all 44 projects produce the same revisions, bytes and check results as the prototype, and the corpus runner passes.

**Phase 2: shell.**
- Port the dock, views, UI DSL, projects and agent onto the kernel API.
- Keep the `wb` API compatible so the 44 projects' scripts and UI tiles run unchanged. They are the shell's acceptance test.

**Phase 3: v6 breadth that the flagship needs.**
- Strategy IR: O2 as a plan; pass-order and register-option alternatives with chooseBest.
- The contract vocabulary and assurance labels in the Checks view.
- Declarative patterns with match evidence.

**Phase 4: prove generality.**
- Add one v6 lab as a second domain through an adapter. Expressions is the cheapest; constraints exercises a numeric checker.
- Then decide whether the incremental task runtime is worth building.

## 5. Decisions needed

1. **Stack.** Both prototypes are offline browser JS/TS, and the reused ds-js-os tools are JS that runs in QuickJS. The recommendation is **TypeScript for the kernel and UI, buildable to an offline page**. A Go host (batch runner, persistence) can come later.
2. **Flagship confirmation.** Is Typed → RV32 the right first domain, or should the first target be a different representation (CAD or meshes from v6)?
3. **Agent hosting.** CW's agent depends on the claude.ai artifact runtime (`claude.use('sample')`). Keep that, add a local API-key or proxy mode, or both?
4. **Persistence.** Both prototypes are in-memory or browser-storage only. Is exportable traces/projects enough for now, or do we need a durable store?
5. **Relationship to ds-js-os.** Vendor its front end and RV32 tools, pinned to a commit (recommended), or depend on the repo directly?

## 6. Risks

- **Scope.** v6's breadth is seductive. The phases deliberately make each v6 element earn its place against the flagship.
- **Parity cost.** Reproducing CW's numbers exactly on a new kernel is real work, but it is also the only objective measure of whether the kernel is right.
- **Upstream drift.** The vendored Typed front end is already behind ds-js-os. Pinning, and a documented update procedure, are needed from day one.
