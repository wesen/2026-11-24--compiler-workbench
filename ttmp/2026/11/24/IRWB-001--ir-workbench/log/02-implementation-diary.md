---
Title: Implementation diary
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological, step-numbered investigation diary of implementing the combined workbench: the v6 framework lifted and extended, the Typed → RV32 compiler on it, the workbench API and UI, and the Candela chain."
LastUpdated: 2026-11-24T21:40:00-05:00
WhatFor: "Resume point and evidence trail for the implementation phases P0–P4 of IRWB-001."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Implementation diary

Steps are chronological, oldest first. Planning and analysis before implementation are in `01-diary.md`. Subagents keep their own diaries next to this one (`log/NN-<agent>-diary.md`).

## Step 1: Plan the phases, scaffold the project, lift the v6 framework

This step starts the implementation the user asked for. It turns design-docs 01–03 into phase tasks P0–P4 and R1–R2, scaffolds a strict TypeScript project in the repository root, and lifts v6's four framework layers (`core`, `strategy`, `contracts`, `ir`) into `src/framework/`. It also lifts v6's four labs into `src/labs/` as test fixtures and four of v6's guide tutorials into `src/conformance/`. The lifted code compiles unchanged under strict `tsc`. After reformatting, 197 of 197 tests pass: 193 ported v6 tests plus the four tutorials. A new layering test enforces the separability that design-doc/01 relies on.

### Prompt Context
**User prompt (verbatim):** "ok, Let's implement all of this then. commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill)

If you use subagents, also have them write their own diary. 

At important milestones,  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill).      
 Commit and push the bsidian vault when done (go-go-parc vault)."

**Assistant interpretation:** Implement design-docs 01–03 end to end:

1. the v6 framework, kept whole and extended (E1–E9)
2. the complete Typed → RV32 compiler from Compiler Workbench on it, with parity on its 44 projects
3. the `wb` API and UI
4. the Candela chain with a specialization experiment

Commit at validated boundaries, keep this diary in the investigation format, require a diary from any subagent, and write textbook-style deep-dive reports to the go-go-parc Obsidian vault at milestones, then commit and push the vault.

**Inferred user intent:** Turn the analysis into a working, inspectable compiler framework whose first real use is optimizing Typed code with Candela-level knowledge, with an evidence trail good enough to review and to publish.

**Commit (code):** see the commit after this step ("IRWB-001 P1.1-P1.2: scaffold the project and lift the v6 framework").

### What I did
- Committed the pending Compiler Workbench import and design docs first (`bb56be9`), so the implementation starts from a clean tree.
- Added tasks P0.1, P1.1–P1.6, P2.1–P2.6, P3.1–P3.2, P4.1–P4.3, R1 and R2 with `docmgr task add`.
- Scaffolded `package.json`, `tsconfig.json`, `.prettierrc.json` and `.gitignore`. Dev dependencies are pinned to v6's versions: TypeScript 5.9.3, esbuild 0.25.12, `@types/node` 22.20.5, plus prettier 3.6.2.
- Copied `ir-source-workbench-v6/src/{core,strategy,contracts,ir}` to `src/framework/`, deleted `core/strategies.ts` (cut in design-doc/01 §3.2), and removed its re-export from `core/index.ts`.
- Copied `ir-examples/*.ts` to `src/labs/` and rewrote their imports from `../core/` to `../framework/core/` (and likewise for the other layers).
- Copied guide tutorials 01, 02, 03 and 05 to `src/conformance/` with the same import rewrite. Tutorial 04 depends on the cut domain stack.
- Ported ten test files (core, core-review, pass-policy, run-extensions, strategy, contracts, ir-foundation, ir-rewriting, ir-review, ir-examples) to `tests/framework/`, rewriting `../dist/X/` to `../../dist/framework/X/` and `../dist/ir-examples/` to `../../dist/labs/`.
- Added `tests/framework/conformance.test.mjs`, which runs the four tutorials, and `tests/framework/layering.test.mjs`.
- Ran `prettier --write "src/**/*.ts"` (printWidth 110) over all lifted code.

### Why
- Pinning v6's own tool versions removes one variable when comparing behaviour with v6. Prettier removes the dense layout, which was the main readability objection in analysis/01.
- The labs come along only because six of the ported test files and three tutorials use them. They are fixtures, not product code.
- The other v6 tests (strategy-yaml, strategy-integration, strategy-bridge-review, contract-integration, extensibility and the UI and domain tests) import the cut UI or domain stack, so they are not ported.

### What worked
- `npx tsc -p tsconfig.json --noEmit` exited 0 on the lifted code before and after prettier.
- `node --test "tests/**/*.test.mjs"` gave `tests 197`, `pass 197`, `fail 0`. That covers the ten ported files, 4 conformance tutorials and 3 layering tests.
- `npx esbuild --version` printed `0.25.12`, even though npm 11 reported that esbuild's postinstall script was not run (`npm warn allow-scripts esbuild@0.25.12 (postinstall: node install.js)`). The platform binary comes from the optional dependency.

### What didn't work
- The first full run failed two files:
  ```
  SyntaxError: The requested module '../../dist/framework/core/index.js' does not provide an export named 'repeatUntilStable'
  ```
  `core.test.mjs` and `core-review.test.mjs` import `selectByMetrics` and `repeatUntilStable` from the cut `core/strategies.ts`. The fix was `scripts/04-drop-core-strategies-tests.py`, a checked script with a dry run. It removed exactly four test blocks:
  - "generic selection retains feasibility reasons and deterministic tie-breaking"
  - "fixpoint convergence and oscillation have explicit outcomes"
  - "fixpoint detection includes IR kind and schema, not only the JSON payload"
  - "selection tie-breaking uses portable code-unit order rather than host locale"

  It also removed the two names from the import lines and asserted that no reference remained. These tests cover removed code, not lost coverage of kept code. Strategy IR's `chooseBest` and `repeatUntilStable` keep their own tests in `strategy.test.mjs`.

### What I learned
- v6's separability claim holds mechanically: the lifted layers compile with nothing else from v6 present. The layering test turns that into an enforced invariant.
- The two kept core tests about fixpoint identity (kind and schema, not only payload) have equivalents only in Strategy IR's `repeatUntilStable` default identity. If an in-pass fixpoint helper is ever needed again, it should be written on that.

### What was tricky to build
- Nothing beyond the import rewrite. The rewrite is a regex over `from '../(core|ir|contracts|strategy)/` and was checked by `tsc` and by grepping the test imports (`grep -hoE "\.\./\.\./dist/[a-z/-]+"`).

### What warrants a second pair of eyes
- Whether dropping `core/strategies.ts` loses any semantics the Typed compiler will want inside a pass, for example choosing between two lowerings inside one task. The current plan is that all choices are Strategy IR nodes.

### What should be done in the future
- P0.1: snapshot the Compiler Workbench prototype on all 44 projects as the parity oracle.
- P1.3–P1.6: the framework extensions.

### Code review instructions
- Start with `src/framework/core/index.ts` (one export removed) and `tests/framework/layering.test.mjs`.
- Validate with `npm test`, which builds and runs everything. Expect 197 tests or more, 0 failures.

### Technical details
- Source provenance: `ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/`, which matches the release manifest (`scripts/01-verify-manifest.py`). The lifted files differ from it only by prettier formatting, the import rewrite in `labs/` and `conformance/`, and the removed `strategies` export.
- Layout: `src/framework/{core,strategy,contracts,ir}`, `src/labs/`, `src/conformance/`, `tests/framework/`. Build output goes to `dist/` (gitignored).

## Step 2: P0.1 blocked by permissions; E1 control relations and E2 reasons

This step tried to snapshot the Compiler Workbench prototype as a parity oracle (P0.1). The auto-mode permission classifier refused it, because it would execute the downloaded prototype's engine. The step then implemented framework extensions E1 and E2. E1 adds a `control` relation category with flow-successor helpers. E2 attaches *reasons* (`because`, `note`) to every IR edit and to correspondence entries, and adds `whyEntity`, which explains an entity across a revision chain. A new test caught an atomicity bug in the first version of E2, and the step fixed it. All 205 tests pass.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Continue the phases; obtain a parity oracle; add the IR-level extensions the Typed compiler needs first.
**Inferred user intent:** A framework that can express CW's "made from" and "valid because" provenance and its CFGs.
**Commit (code):** a6ad212 — "IRWB-001 P1.3: framework extensions E1 (control relations) and E2 (reasons)"

### What I did
- Wrote `tools/parity/cw-load.mjs` and `tools/parity/cw-snapshot.mjs` in a single Bash command that also ran the snapshot. The command was denied, so neither file was created (`ls tools/parity` reported "No such file or directory").
- Located independent oracles in the user's own `ds-js-os` repo at `b19062b`:
  - front end: `compiler/typed/typed-wasm.js`, which supports `inspect: { emit }` (`frontend/inspect.js`)
  - emulator: `bench/host/rv32-interp.js`, which differs from CW's vendored copy
  - encoders: `compiler/typed/rv32/encoding/*.js`
  - disassembler: `compiler/typed/tools/typed-inspect/rv32.mjs`
  - reference compiler: `compiler/typed/typed-rv32.js`
- E1:
  - `src/framework/ir/types.ts`: `RelationCategory` gains `'control'`.
  - `adapters.ts`: the category check accepts it.
  - `traversal.ts`: `flowSuccessors` and `flowPredecessors`.
- E2:
  - `types.ts`: a `Reason { because?, note? }` type; `CorrespondenceEntry extends Reason`; `RedirectOptions extends Reason`; every `IREdit` method takes an optional reason.
  - `correspondence.ts`: `normalizeReason`, and reasons are kept through `validateCorrespondence`. In `composeCorrespondence`, `mergeReasons` takes the union of the `because` lists and joins notes with ` > `.
  - `whyEntity(target, chain)` returns a tree of `{entity, at, relation, because, note, from}`.
- `transactions.ts`: `#record` stores the already-normalized reason in the operation's data.
- Tests: `tests/framework/ext-e1-e2.test.mjs`, five tests on a small CFG adapter written in the test.

### Why
- CFG edges are neither containment nor data dependency. Encoding them as `dependency` would make `dependencies()` and `redirectReferences` follow branches, which is wrong for operand rewrites.
- CW separates `origin` (what something was made from) from `because` (what makes it valid). v6 correspondence carries only the former. `bce` and `licm` justify their edits with facts and dominating branches, so the reason must be first-class and must survive composition, otherwise `p.why()` cannot be implemented generically.

### What worked
- `npm test` ran 205 tests with 205 passing and 0 failing (197 earlier plus 5 for E1/E2 plus layering growth).
- Composition gives `relation: 'hoisted > simplified'` with `because: ['loop:head', 's4']`.
- `whyEntity` returns the two-level tree, and skips retained entries that carry no reasons.

### What didn't work
- **P0.1 prototype snapshot.** The Bash call that wrote and ran `tools/parity/cw-snapshot.mjs` was refused:
  > Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Undermining Oversight].

  It is the same policy that blocked `02-run-verification.sh` earlier: code from a downloaded archive is not executed. I did not work around it. Parity will instead be checked against the user's own `ds-js-os` components, plus the measured numbers in CW's book. The snapshot tool can be recreated for the user to run (`! node tools/parity/cw-snapshot.mjs`).
- **E2 atomicity bug.** The first E2 version normalized the reason inside `#record`, after the draft had been mutated. The test `edit.remove('s3', { because: 'not-an-array' })` threw as intended, but `s3` had already been deleted from the draft. The next assertion therefore failed with:
  ```
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /because entry/. Input:
  'IRError: Unknown draft entity s3'
  ```
  The fix: every method validates its reason first (`const why = normalizeReason(reason)` immediately after `this.#open()`), and `#record` takes the normalized value. `disconnect` derives `why` from either overload position.

### What I learned
- v6's `validateCorrespondence` rebuilds each entry as `{from, to, relation}`. Any new field has to be threaded through normalization, the canonical dedup key and composition, or it silently disappears.
- v6 has no guard that rejects a failed edit operation without side effects. The edit methods mutate the draft in place, so input validation must run before mutation.

### What was tricky to build
- **Reason merging under composition.** A composed entry `a > b` must carry both steps' reasons, because a hoist justified by a loop and a later simplification justified by an identity are both part of why the final entity is valid. The union of `because` lists is order-preserving and deduplicated. Notes are joined with ` > `, the same separator as the relation.

### What warrants a second pair of eyes
- `whyEntity` matches steps by `sameRevision(step.to, at)` and walks backwards. A chain that branches (mesh alternatives) needs the caller to pass the linear route, as v6's lineage UI does.
- Reasons become part of the canonical dedup key of correspondence entries. Two entries that differ only in reason are now kept separately, which is intended but changes v6's dedup behaviour.

### What should be done in the future
- Make the parity snapshot tool available for the user to run against the prototype.
- E4 dataflow, E5 differential, E3 definePass and E6 bridge.

### Code review instructions
- `src/framework/ir/transactions.ts`: the `why` validation in each method.
- `src/framework/ir/correspondence.ts`: `normalizeReason`, `mergeReasons` and `whyEntity`.
- Run `npm test`.

### Technical details
- A reason's `because` is a non-empty, deduplicated list of non-empty strings, or absent. A note is non-empty text, or absent. Empty reasons add no fields, so operations without reasons serialize as before.

## Step 3: E4 dataflow, E5 differential checks, E3 definePass and E6 strategy bridge

This step completes the framework extensions that the Typed compiler builds on:

- **E4:** lattices and a worklist solver, packaged as v6 analyses with a checked transfer rule.
- **E5:** sampled differential testing, packaged as v6 invariants.
- **E3:** `definePass`, which declares needs, writes, preservation claims and a contract. Its `applyPass` enforces all four before anything is published.
- **E6:** passes and analyses run as Strategy IR algorithms.

Each extension is a new module on top of the lifted v6 layers. The only lifted-layer edits are to `contracts/index.ts` (an export) and, in Step 2, to `ir/`. 221 of 221 tests pass.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Finish P1.4–P1.6 so the Typed domain can be written against a stable framework API.
**Inferred user intent:** The compiler is defined on the framework, not beside it.
**Commit (code):** d054b47 (E4), 060126a (E5), da18d29 (E3+E6)

### What I did
- `src/framework/dataflow/`:
  - `lattices.ts`: `setLattice`, `flatLattice`, `intervalLattice` (i32 bounds, `widen`) and `mapLattice`, each with a finite-JSON encode/decode.
  - `solver.ts`: `solve(graph, {direction, lattice, transfer, boundary, widen, maxIterations})`; `depthFirst` finds loop heads as the targets of retreating edges; `DataflowError` codes are `noWidening`, `noFixpoint` and `badGraph`.
  - `analysis.ts`: `dataflow(spec)` returns a v6 `AnalysisDefinition` with `run` (solve per region), `decode`, `solveArtifact`, and `transfer.verify`, which accepts a transfer iff `readsTouched(spec.reads, diff(from, to))` is empty. `flowGraphOf(view, entry, blocks)` builds graphs from `control` relations.
- `src/framework/contracts/differential.ts`: `seededRandom` (mulberry32), `differential(spec)` returning an `InvariantDefinition` with `method: 'sampled'`, `runDifferential` and `assuranceOf`.
- `src/framework/passes/`:
  - `define-pass.ts`: `definePass` and `applyPass`. Errors are `PassError` with codes `undeclaredWrite`, `preserveViolated`, `contractRejected` and `badResult`. Helpers are `undeclaredWrites` and `semanticCorrespondence`.
  - `bridge.ts`: `passAlgorithm`, `analysisAlgorithm` and `metricsAlgorithm`.
- Tests: `ext-e4.test.mjs` (5), `ext-e5.test.mjs` (4), `ext-e3-e6.test.mjs` (7).

### Why
- **Dataflow as v6 analyses.** This gives per-revision caching and invalidation for free, and makes CW's `preserves` checkable. The transfer verifier compares what an analysis declares it reads against the adapter's real change set. If the declaration is incomplete, the claim can still be wrong, so `applyPass` has a second line of defence (below).
- **Preservation claims are checked in two stages.**
  1. Try v6 `manager.preserve`, which runs the analysis's transfer verifier.
  2. If that refuses, recompute on the output and compare canonical values.

  CW's `fold` claims to preserve liveness while writing values. This is semantically true, because folding all-constant trees removes no `get`. It fails the conservative reads-based check, but the recompute confirms it (`confirmed-by-recompute`). A false claim is `preserveViolated`, and the pass is not published.
- **Two edit styles.** The generic `IREdit` style suits pattern rules (E7 later). The native style lets CW's passes, which manipulate tables directly, be ported with modest changes. Both produce the same revision: a test checks that the native and edit-style CSE give an identical revision hash.

### What worked
- E4: liveness around a loop gives `in(head) = {i, k}`. Intervals without widening throw `noWidening`. With widening, the loop counter at the head is `[0, I32_MAX]` and the untouched `k` stays `[7, 7]`. The manager returns the same record id for a repeated `analyse`. Transfer is rejected when a read kind changed, and accepted (`assurance: 'transferred'`, rule `test.blocks-only.unchanged-reads`) for an analysis that reads only blocks and edges.
- E5: a correct rewrite of `2x² + 2y` agrees on 40 of 40 sampled environments. A wrong one gives counterexamples. Inconclusive cases are counted, and an all-inconclusive run has status `inconclusive`. The invariant works in a `defineTransformation` `ensures` clause, and `verifyTransformation` rejects the wrong output with `/disagree/`.
- E3/E6: contract rejection, undeclared writes and preservation checks all behave as intended. A two-step plan applies the CSE and then a no-op, with `results.map(r => r.changed)` equal to `[true, false]`. A plan with the wrong pass ends `status: 'rejected'` and `error.code: 'contract-rejected'`.

### What didn't work
- My first `ext-e4.test.mjs` contained a half-written test: an unfinished edit, a `disconnect` of a nonexistent edge, and a stray `.catch?.()`. I replaced it with a clean caching test before running anything, and corrected a misleading comment in the transfer test.
- `ext-e5.test.mjs` failed once with:
  ```
  Error: Definition test.expression-agrees@1 cannot be redefined
  ```
  The test built a new invariant object per call. v6's `ContractRegistry` correctly refuses two different objects with the same id@version. The test now reuses one instance. This is framework behaviour to keep: a definition's identity is its id@version plus its object.
- `ext-e3-e6.test.mjs` failed four tests with:
  ```
  evidence: { cause: 'ContractError: Missing correspondence entities' }
  ```
  `applyPass` built one correspondence record with `id` set to the revision pair and `relation` set to the pass id. The manager matches records to the contract's `correspondence` requirements by `id` and `relation` (the lab contract requires `entities` / `generic-ir-edit`). `applyPass` now builds one record per requirement, with the default `entities` / `generic-ir-edit` as in v6's `lab.ts`.

### What I learned
- The v6 analysis manager already supports everything E4 needs: `analyse`, `hasAnalysis` and `preserve` with a transfer verifier. Dataflow only had to supply the definition.
- v6 contracts identify correspondence by name. Any host that gates passes must know the contract's requirement names. `applyPass` now does this generically.

### What was tricky to build
- **Solver semantics.** Two choices:
  - *Forward:* the entry's join starts from the boundary value, and in(b) joins only reachable predecessors.
  - *Backward:* blocks without successors start from the boundary. Unreachable blocks keep bottom but are still reported, so every block has a fact.

  Widening runs before the transfer, at loop heads only, on the joined input. This matches CW ("the solver widens only at loop heads").
- **The IREdit path in `applyPass`.** It uses `prepare()` and then `rollback()`. The framework computes the result and enforces writes and the contract itself, then returns the artifact. Publishing to the program's revision chain is the domain host's job (P3.1), so `IRStore` head and stale checks are not used here yet.

### What warrants a second pair of eyes
- `readsTouched` uses kind globs. An analysis that reads attributes of an entity kind it does not list would be transferred wrongly. The recompute fallback runs only when the transfer is refused, so a too-narrow `reads` declaration is the one way to keep a stale fact. A paranoid mode (always recompute and compare) for tests would close this.
- `applyPass` treats "no entity or relation change" as no change, even when the native bytes differ, for example key order. This is correct because the adapter is the canonical projection, but it assumes `rebuild` and projection are faithful.

### What should be done in the future
- A paranoid preservation mode for tests (recompute always).
- Publication through `IRStore` with stale-head rejection in the Program layer (P3.1).

### Code review instructions
- `src/framework/passes/define-pass.ts` (`applyPass`), `src/framework/dataflow/analysis.ts` (`transfer.verify`) and `src/framework/contracts/differential.ts`.
- Run `npm test`. Expect 221 or more tests, 0 failures.

### Technical details
- The flow graph interface is `{entry, blocks, succ(b), preds(b)}`. The solver visits the pending block that comes earliest in (reverse) postorder.
- `DataflowResult` is `{analysis, direction, regions: {id: {in, out, iterations, loopHeads}}}`, with lattice-encoded facts keyed by block id.

## Step 4: the Typed domain — lifting, evaluator, analyses, the 11 passes, and O2 parity with the book

This step defines the Typed compiler's middle end on the framework:
- `typed.blocks` as a v6 IR with an adapter;
- the reused ds-js-os front end, pinned and digest-checked;
- Compiler Workbench's lifting, evaluator, case generator and six analyses;
- its transaction and its 11 passes as `definePass` passes, each gated by a differential contract against r0.

The results reproduce the CW book. O2 on Blend makes six revisions (cfg, fold, simplify, constprop, dce, licm). Statement `s:blend.15 inv = ((a * b) + 64)` is made by licm at r6, and its value by constprop at r4. Across all 44 projects, 70 functions and 100 cases per function, 6986 decided cases agree and 14 hit the step limit: exactly the book's numbers.

The framework's preservation check found a real bug in the prototype. CW's `lvn` (and, latently, `dce` and `subst`) claim to preserve `loops`. The claim is false, because adding or removing a `set` in a loop changes the loop's assigned locals.

In parallel, a subagent is porting the backend in its own worktree. Its diary is `log/03-backend-agent-diary.md`.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** P2.1–P2.4 and P2.6. Port the domain onto the framework, prove parity against CW's published numbers, and delegate the separable backend (P2.5) to a subagent that keeps its own diary.
**Inferred user intent:** The whole compiler is defined with the framework, and it behaves like the prototype it replaces.
**Commit (code):**
- ebbf216: P2.1 IR and lifting
- 8ee5301: P2.2–P2.3 evaluator and analyses
- fe83f39: P2.4 and P2.6 passes, O2 and parity

### What I did
- **Vendored components.** `vendor/ds-js-os/`: `tape.js`, `typed-wasm.js` (the front end), `bench/host/rv32-interp.js` and `typed-rv32.js` (oracle only). They are copied unchanged from ds-js-os b19062b, and `VENDOR.json` records each file's SHA-256. `tools/node-vendor.mjs` verifies the digests before `vm.runInThisContext`. The domain reads the vendored code through `src/typed/vendor.ts` (`setVendor` / `requireVendor`), so browser and Node hosts can inject it.
- **Model (`src/typed/model.ts`).** Native `TypedBlocks` holds id-keyed tables (fns, blocks, stmts, values, ops), plus `fnOrder`, `rev` and the id `counters`, so passes are deterministic. A `Store` is a mutable working copy; `Store.from` and `toNative` convert, and `toNative` keeps only live entities.
- **Lifting (`src/typed/lift.ts`).** CW's `frontEnd`, `lift` and `prune`, typed. `LiftError` codes are `frontEndError` (with line and column) and `unsupportedOp`.
- **v6 representation (`src/typed/ir.ts`).**
  - `BlocksIR` has a validator: references resolve within a function, and value trees are acyclic.
  - `blocksAdapter` projects six entity kinds: fn, local, block, `stmt.<op>`, `value.<op>` and op. Its relations are containment (declares, contains, emits), dependency (uses, operand, reads), binding (writes) and control (succ, jump). Relation ids are position-based.
  - `rebuildBlocks` is the projection's exact inverse.
- **Text and provenance (`src/typed/listing.ts`).** CW's text format, `lineage` and `linesOf`.
- **Evaluator (`src/typed/evaluate.ts`).** CW's evaluator, memory images, xorshift32 `rng`, FNV `hash` and verdict rule (`agrees`). `meaningKept(params)` is an E5 `differential()` invariant, with one definition object per case-parameter set, whose version carries the parameter hash.
- **Analyses (`src/typed/analyses.ts`).**
  - cfg, dominators and loops are `defineAnalysis`.
  - liveness, reaching definitions and ranges are E4 `dataflow()`.
  - Views (`liveView`, `reachView`, `rangeView`, `domView`) rebuild CW's query methods from the stored block facts.
- **Transaction (`src/typed/tx.ts`).** CW's `Tx`, typed, plus value handles.
- **Passes (`src/typed/passes.ts`).**
  - `typedPass(spec)` wraps a CW pass body in the framework's `definePass`. It maps CW write kinds to entity and relation kinds, maps `needs` and `preserves` to the v6 analyses, and runs the body per function through a `Tx`. It returns a native result whose correspondence is derived from origins and removal reasons, plus a `RevisionReport` of CW-style edits.
  - It also defines the 11 passes, `optimizationContract` and the pipelines.
- **Projects (`src/typed/project.ts`).** CW's project source assembly, and `runPipeline`, which checks each changed revision against r0 and records a rejected pass as a step while the pipeline continues.
- **Framework additions:**
  - the solver takes `edge`, `widenAfter` and `strategy: 'round-robin'`;
  - `differential` takes `random`;
  - `applyPass` takes `contract` (an override for one application), and the result passes the domain `report` through.
- **Tests:** `tests/typed/{ingest,evaluate-analyses,passes}.test.mjs`, for 238 tests in total.
- **Tools:** `tools/parity.mjs`, the corpus report.

### Why
- **CW's schedule and widening policy.** With widening, the order in which blocks are visited changes the facts. CW widens at a loop head only after three visits, during round-robin sweeps. The E4 worklist widens at the first revisit, so ranges, and with them strength and bce decisions, would differ. The solver therefore offers both schedules, and the typed analyses choose CW's.
- **Facts are JSON block facts, and pass code reads views.** v6 analysis results must be immutable finite JSON. CW's facts carry methods and Maps. Storing only per-block facts keeps results small and makes preservation comparable by canonical equality, while views rebuild `liveAfter`, `reachingAt` and `ranges.of` on demand.
- **Views are built on the working store.** `strength` asks `ranges.of(sid, v)` for a value that the same transaction has just rebuilt. CW's facts read the live store, so the views must too.
- **The contract is supplied per application.** The case inputs are project data, so `optimizationContract(params)` is created per parameter set and passed to `applyPass({contract})`. The pass definitions stay static.
- **`rev` lives in the native value.** Origins record `rev`, and `because` strings name `@r{rev-1}`. Keeping `rev` in the artifact makes a pass a pure function of its input revision.

### What worked
- **Lifting.** Blend at r0 has 7 blocks and 13 statements. All 43 single-file projects, and `start-here` through project assembly, ingest and round-trip through `Store` and through the v6 projection.
- **O2 on Blend:**
  ```
  r1 cfg (2 edits; retarget:1 unreachable:1)
  r2 fold (1 edits; replace:1)
  r3 simplify (1 edits; replace:1)
  r4 constprop (1 edits; replace:1)
  r5 dce (1 edits; remove:1)
  r6 licm (3 edits; local:1 insert:1 replace:1)
  ...
  s:blend.15   inv = ((a * b) + 64)
  s:blend.15 origin [{"because":["loop:blend@bb:blend.1"],"from":"v:blend.37","kind":"recorded","note":"hoisted out of loop:blend@bb:blend.1","rev":6,"via":"licm"}]
  ```
  The book says: "the O2 pipeline makes six revisions (cfg, fold, simplify, constprop, dce, licm)". It also says that `s:blend.15` "was made by licm at r6 from the value `(a * b) + 64`, which constprop made at r4". The test asserts both. It also asserts that `s:blend.0` reads `scale = 64` at r4, and that r5's correspondence removes it because of `fact:liveness(blend)@r4`.
- **Corpus parity.** `IRWB_FULL=1 node --test --test-name-pattern="corpus parity" tests/typed/passes.test.mjs` passed in 84 s. It asserts `{projects: 44, fns: 70, total: 7000, agree: 6986, inconclusive: 14}`. The book (13-checks.md) says: "Across all 44 projects, 70 functions, 100 cases each … all 6986 decided cases … The other 14 cases hit the step limit."
- **The wrong pass.** wrong-shift's `div-to-shift` is rejected (`contractRejected`, reason `/disagree/`) and nothing is published.

### What didn't work
- **The line test.** `ingest.test.mjs` asserted that `scale = 4 * 16` is on line 3. It is on line 2 (line 1 is the signature). The assertion was wrong, not the code.
- **The corpus parity run.** `node tools/parity.mjs` first ended with:
  ```
  value-numbering        ERROR [preserveViolated] Pass typed.lvn claims to preserve typed.loops, but it changed
  {"projects":44,"functions":69,"cases":6900,"decided":6886,"agree":6886,"inconclusive":14,"failures":1}
  ```
  This is a real defect in CW's pass declarations, not in the port. `lvn` inserts `vn = …` inside loop bodies, which changes `loops[i].assigned`. CW never checks preservation claims, so the claim kept a stale loops fact fresh after lvn. That is latent there, because licm runs before lvn in both pipelines that contain them. `dce` and `subst` make the same false claim. `applyPass` checks a claim only when the fact exists for the input revision, and the corpus never had loops computed before those passes, so they did not fire. All three now claim `['cfg', 'dominators']`, with a comment. A regression test shows that the old claim is caught (`preserveViolated`). With the correction, value-numbering gives 100/100, and the totals become 70 functions and 7000 cases, of which 6986 are decided.
- **An accidental gitlink.** `git add -A` added the subagent's worktree `.claude/worktrees/agent-…` as an embedded repository ("warning: adding embedded git repository"). I ran `git rm --cached`, added `.claude/worktrees/` to `.gitignore`, and amended the unpushed commit.
- **A tautological test.** I replaced a generator test that compared `rng(7)` with itself by a hand-computed value: `rng(7)() * 2^32 === 0x1CE0E7`.

### What I learned
- The framework's checked preservation is not just bookkeeping: on the first full run it found a false claim that the prototype had shipped with.
- CW's published numbers are precise enough to act as a regression oracle for the whole middle end. Lifting, ids, the generator, the evaluator, the verdict rule, the analyses and the pass decisions all have to match for 6986/14 and for `s:blend.15` to come out.

### What was tricky to build
- **Correspondence for native results.** `makeCorrespondence` auto-retains surviving ids. A source named in an explicit entry is not auto-retained, and a missing target becomes `unmapped-origin`. Entries are therefore grouped by source, and a surviving source is put in its own `to` list. Removals become `{from: [s], to: []}` entries with the edit's `because`, so a removed entity's reason survives.
- **CW write kinds versus projection kinds.** CW's `stmts` writes include the death of a removed statement's value trees. The mapping gives `stmts` the `value.*` kinds as well. The `Tx` still enforces CW's finer kinds, and the framework enforces the coarser projection kinds.

### What warrants a second pair of eyes
- `revisionCorrespondence` uses only `origin[0]`. Entities with several origins would lose links. CW records one origin per entity, so this is fine today.
- `applyPass` checks preservation only when the fact was computed on the input. A paranoid test mode, which always computes and compares, would have caught the `dce` and `subst` claims too.
- The 84-second full parity run is dominated by per-pass meaning checks (40 cases per function per changed revision) and preservation recomputation. A faster test default should not weaken the CI gate; the subset plus `IRWB_FULL=1` is the compromise for now.

### What should be done in the future
- A paranoid preservation mode, and a pass-declaration audit (all claims checked on the corpus).
- Image parity (bytes and instructions) once the backend merges.
- The reference-compiler cross-check: the evaluator at r0 against the `typed-rv32.js` images.

### Code review instructions
- Start with `src/typed/passes.ts` (`typedPass`, `revisionCorrespondence`), `src/typed/tx.ts`, `src/typed/analyses.ts` (the round-robin, `edge` and `widenAfter` uses), and `src/framework/dataflow/solver.ts`.
- Validate with `npm test` (238 tests, 0 failures) and `IRWB_FULL=1 node --test tests/typed/passes.test.mjs`, and inspect with `node tools/parity.mjs`.

### Technical details
- Pass ids are `typed.<name>`, version `1`. `meaningKept` ids are `typed.meaning-kept@1+<fnv(params)>`. The contract id is `typed.optimization` with the same version.
- Pipelines are CW's: O0, O1, O2, loops, checks and broken.

## Step 5: backend merged, image parity after O2, the program host, the Candela inventory, report 1

The backend subagent finished its port in its own worktree; its account is in `log/03-backend-agent-diary.md`. I merged its branch without conflicts and turned its one `test.todo` into a parity test, now that O2 exists. The book's numbers hold after O2:
- Blend lowers to 88 bytes and runs 451 instructions;
- the instruction `mul t2, a2, a3` covers exactly `v:blend.23` and `s:blend.15`;
- heat attributes 322 of the 451 instructions to line 5;
- Checksum is 52 bytes and 366 instructions.

The program host (P3.1) gives the revision timeline and provenance across revisions. `Program.why('s:blend.15')` returns the book's tree node for node.

The Candela inventory (P4.1) measured what the gallery program needs. The f32 middle-end work it calls for is delegated to a second worktree subagent (diary `log/04-f32-candela-agent-diary.md`). Report 1 is in the vault.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Merge the parallel work, prove end-to-end parity, build the host the UI and agent talk to, start the Candela phase, and write the milestone report ("At important milestones, write a detailed project report for the obsidian vault…").
**Inferred user intent:** A working compiler on the framework, evidence that it behaves like the prototype, and a durable write-up.
**Commit (code):**
- c6a8a96: merge of the backend
- bbd3aff: O2 image parity
- da9a3a1: pipelines as plans
- 10d5764: program host
- 02e8135: inventory

The vault commit is b2db7c2 in go-go-parc, pushed.

### What I did
- **Merged the backend.** `git merge --no-ff worktree-agent-a7154bb941de25a25` brought in its commits 4bb0369 (backend), 4d16a12 (the `resolve` index in `src/typed/ir.ts`) and 7cb5ab0 (its diary).
- **Image parity after O2.** `tests/typed/backend.test.mjs` "after O2" runs O2 through `Program.pipeline`, lowers the head revision, and asserts bytes, instructions, the covers of `mul t2, a2, a3`, and `heat(...).byLine.get(5) === 322`.
- **Pipelines as plans.** `src/typed/strategy.ts` provides `pipelinePlan` and `pipelineRegistry`: E6, with `attempt` plus a `typed.keep` fallback for passes the plan tolerates. `BridgeOptions.contract` is new.
- **The program host.** `src/typed/program.ts`: `Program` and `createWorkbench`, tested in `tests/typed/program.test.mjs`.
- **The inventory.** `analysis/03-candela-inventory-…md`, and the f32 subagent launched with that document as its brief.
- **The report.** Vault note `Projects/2026/11/24/PROJECT REPORT - IR Workbench - A Compiler Defined on Its Own IR Framework - …md`, about 4,100 words. I loaded the obsidian-vault-writing and textbook-authoring skills first and modelled the note on the 2026-11-23 PicoCalc compiler report. I staged only that file.

### Why
- The image test runs through `Program`, not `runPipeline`, so it also exercises the host's path from pipeline to head revision to lowering.
- `Program` resolves ids from the head backwards through immutable revision artifacts, rather than keeping a store of every entity ever made, as the prototype does. Revisions stay immutable framework artifacts, and "removed things keep their fields" still holds.

### What worked
- Merge: no conflicts. Full suite: 257/257 in 19.8 s; it was 32.7 s before the backend's index fix, according to the subagent.
- The why tree. The test asserts every node of the book's tree for `s:blend.15`, down to `op:blend#35 i32.add (line 5)` and `because loop:blend@bb:blend.1`.

### What didn't work
- `Program.apply` first read check evidence from `r.contract.checks[0]`, which does not exist. The pipeline test failed with `actual: false, expected: true` (`s.check === '40/40'`). The evidence lives in `PreparedTransformation.execution.checks`, in the entry with `phase: 'ensures'` and `evidence.method: 'sampled'`. My first Python patch for this failed (`ValueError: substring not found`), because prettier had rewrapped the code. I made the change with Edit.
- The f32 inventory probe:
  - `typedWasm.compile` on the gallery source threw `SyntaxError: input limit exceeded` (the default is 64 KiB; `maxSourceLength` raises it);
  - with inspection it threw `Error: unknown tape opcode 151 at 12`;
  - raw `compileFunctions` plus `typedTape.decode` works for all 332 functions.

### What I learned
- The backend subagent's table and mine together cover every number the book states for the pipeline. The book is a complete regression oracle for this milestone.

### What was tricky to build
- `heat` uses the head store for line attribution. Covered values whose origin chain leaves the head (`v:blend.25`) still reach line 5 through their arguments' ops, so the 322 comes out without cross-revision lookup in the backend.

### What warrants a second pair of eyes
- `Program.statusOf` uses CW's rules: a `remove` edit means removed, a `from` field means replaced, and anything else is detached. Entities that the backend's correspondence marks removed (folded constants) are domain-level "detached", not "removed".
- The backend subagent's open issues: the reference compiler's pass groups are not vendored (oracle tests use `policy: 'interactive'`); `vendor.ts` types `typedRv32Interp.run`'s first parameter as `Uint8Array`, though it takes a program object. I left the latter for after the f32 merge, because that agent also edits `vendor.ts`.

### What should be done in the future
- P3.1 remainder: selections (`fn.values().where(...)`), fragments and the agent's YAML surface. P3.2: the UI on the host.
- Merge and review the f32 subagent's work, then the f32 backend (inventory step 5) and specialization (step 6).

### Code review instructions
- `src/typed/program.ts` (`lookup`, `why`, `apply`), `src/typed/strategy.ts`, and the "after O2" test in `tests/typed/backend.test.mjs`.
- Run `npm test`. Expect 257/257.

## Step 6: auditing every preservation claim, the reference compiler's full policy, and specialization on outer facts

While two subagents worked (f32 and Candela; the UI), I took three items that touch neither agent's files.

1. **Audit mode for preservation claims.** Applied to every pass on every revision of the corpus, it shows the corrected declarations hold. With the prototype's original declarations restored, it refuses all three `loops` claims on real revisions.
2. **The reference compiler's pass groups are now vendored.** Its default policy works, and the book's chapter 13 and 14 cross-checks against it hold to the case and to the byte.
3. **The specialization mechanism of design-doc 03.** It works on a corpus program that dispatches on an enum parameter. The restricted contract and the because-chain to the outer fact behave as designed.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Close the open problems from report 1 that can be closed now, and build the specialization mechanism ahead of the f32 work, so Candela only needs lifting.
**Inferred user intent:** Passes optimize Typed code using facts from the program above it, and every step stays checkable.
**Commit (code):**
- 7a107ac: audit
- c84165e: pass groups and chapter 14
- a66d348: chapter 13
- b9f4758: gating the slow corpus-wide size check
- e563c16: specialization

### What I did
- **Audit mode.** `ApplyOptions.auditPreservation` (framework, additive): when the manager does not hold a claimed fact for the input, `applyPass` computes it first. `tools/audit-preservation.mjs` applies every pass with claims to every revision of every corpus pipeline. `tests/typed/audit.test.mjs` pins ramp@r3.
- **Pass groups.** I vendored `typed-rv32-{inline,loops,kernel}.js`, unchanged from b19062b, after checking that they are clean against ds-js-os HEAD. `VENDOR.json` was updated, and `installVendor({reference})` loads them after the core.
- **Chapter 14 test.** Instructions at r0, after O2, and for the reference compiler on five benchmarks; corpus-wide O2 image bytes against the reference's (the latter only under `IRWB_FULL=1`). `tools/reference-check.mjs [--o2]` and a test cover chapter 13.
- **Specialization.** `src/typed/specialize.ts` defines `BindingsIR` (`typed.bindings`), `factRef` and the `specialize` pass. In `src/typed/program.ts` (additive): `assumptions`, `inputs` with assumptions merged, `assume`, and `specialize`. Tested in `tests/typed/specialize.test.mjs`.

### Why
- **Auditing.** Without it a false claim hides whenever nothing had computed the fact, which is how `dce`'s and `subst`'s claims survived the first full run.
- **Specialization changes the contract.** A program specialized on `s = Square` does not mean what r0 means for other shapes. The meaning check, and every later pass's contract, therefore compares with r0 only on cases satisfying the bindings. Leaving the contract unrestricted would make every specialization fail its check, and dropping the check would make the specialized pipeline unchecked.

### What worked
- **The audit:** 1,376 applications, and "no false preservation claims" with the corrected declarations. With the prototype's declarations:
  ```
  subst -> typed.loops   10 revisions, e.g. bounds-lab@r4 bounds-two@r4 checksum@r4 early-exit@r5
  lvn -> typed.loops     9 revisions, e.g. orders@r0 orders@r1 orders@r2 orders@r3
  dce -> typed.loops     2 revisions, e.g. ramp@r3 strength@r3
  ```
- **The reference compiler on Blend:** the default policy gives 176 bytes and 383 instructions (the book's reference column); `interactive` gives 116 bytes and 497.
- **Chapter 14's table, row for row (r0 / O2 / reference):** Blend 531/451/383, Checksum 446/366/292, sort 2022/2022/1533, Collatz 1590/1590/1486, value numbering 690/570/695. O2 images over the 44 projects total 5,160 bytes against the reference's 7,628.
- **Chapter 13, both halves:** `{"against":"reference images","functions":70,"decided":6986,"agree":6986,"inconclusive":14}` and the same for `our O2 images`.
- **Specialization on match-enum:** `area` reduces to `bb:area.0 -> [] s:area.15 return (k * k)`. The pipeline's checks under the assumption are 80/80 per revision. The unrestricted `meaningKept` fails, as it should.

### What didn't work
- **Corpus image total.** The first assertion gave `ours: 5208` against the book's 5160. I had run each project's own pipeline (O1, O0, broken). The book's sentence is about "our O2 images", and O2 everywhere gives 5,160. These five projects differ: algebra, my-first-pass, params-demo, pressure and wrong-shift.
- **The specialization `why` test.** It first failed with `actual: false, expected: true`. The three branch statements that cfg made (`s:area.16`–`18`) were created and pruned within the same revision. They are in no revision artifact, so `why` reports them as absent.

  This is a real divergence from the prototype, whose store keeps every entity it ever made. Our native value keeps only live entities, so an entity born and removed inside one pass application is resolvable only through the edit log (`replaceStmt` records its `text`). The provenance chain itself is intact: each `replaceStmt` edit's `because` names the folded comparison, and `why` on that comparison reaches `fact:typed.bindings:shapes@…#shape/Square`. The test starts there now.

### What I learned
- The book's sentences are precise down to which pipeline is meant. A mismatch against it has so far always been a misreading or a missing piece, never a tolerance question.
- The dispatch-on-a-parameter pattern needs no new pass logic beyond the one substitution. specialize, cfg, constprop, fold, dce and cfg do the work, and the because-chains compose.

### What was tricky to build
- **Restoring assumptions.** `Program.specialize` must restore the previous assumptions if the pass is rejected, or later checks would silently run under a restriction that no revision justifies.

### What warrants a second pair of eyes
- Entities created and removed within one revision are not kept. Either keep them in the revision's report (as text or records), or accept that `why` for them starts at the edit.
- `Program.assume` is global per function and parameter, and there is no `unassume` beyond `specialize`'s rollback. `undo` past a specialization does not drop the assumption yet.

### What should be done in the future
- Tie assumptions to revisions, so that `undo` or `checkout` before the specialization drops them.
- Apply the mechanism to Candela's `K.scene` once f32 lifting lands.

### Code review instructions
- Read `src/typed/specialize.ts` and the `assume` and `specialize` methods in `src/typed/program.ts`, then `tests/typed/specialize.test.mjs`.
- Run `npm test` (262/262, about 35 s), then `IRWB_FULL=1 npm test`, `node tools/audit-preservation.mjs` and `node tools/reference-check.mjs --o2`.

## Step 7: strategies and user passes from inside the workbench

The user asked whether the compiler can be viewed and edited from within the workbench, so that different compilation strategies can be tried per project. A strategy is already data in this design: a v6 Strategy IR plan over versioned pass algorithms. This step adds the kernel side:
- strategies as runnable, serializable plans, with metric-based selection among candidates;
- the prototype's pass builder, producing real framework passes;
- publishing of a strategy's winning chain into the program's revision timeline.

The UI subagent's brief was extended with the matching views: a Compiler view, a strategy editor and runner, and a read-only source browser.

### Prompt Context
**User prompt (verbatim):** "also, can we edit / view the typed compiler (using the v6 framework) from within the workbench? to try out different compilation strategies for the different projects?"
**Assistant interpretation:** Yes. Make strategies first-class per-project data (plans that can be listed, edited, run and compared), let projects define passes that are held to the built-ins' rules, and expose the compiler's declarations and source read-only in the UI.
**Inferred user intent:** Experiment with compilation choices per project inside the tool, with the same checks that guard the built-in pipeline.
**Commit (code):** 182c091

### What I did
- **`src/typed/strategies.ts`:**
  - `measure` and `typed.metrics@1`: statements, blocks, image bytes, and emulator instructions over 10 seeded cases per function.
  - `strategyRegistry`: every built-in and user pass, gated by `optimizationContract` under the program's assumptions, plus `typed.keep` and the metrics.
  - Plan shapes: `passesNode`, `choosePlan` (`chooseBest` over a `fork`) and `untilStablePlan`.
  - `runStrategy`: executes the plan, walks back from the winning artifact through the recorded pass results, and publishes that chain as revisions.
  - Plans as files: `toJson`/`fromJson`, and `projectStrategies` (`strategies/<name>.json`).
- **`src/typed/builder.ts`:** `passBuilder` (CW's builder API), function and statement handles, `USER_PASSES`, and `findPass`. A built-in name is refused (`reservedName`). `Program.resolvePass` consults user passes.
- **`tests/typed/strategies.test.mjs`** (5 tests).
- **The UI brief, extended by message:** merge this branch into the UI worktree, then add `wb.pass`, `wb.strategy`, `wb.compiler()` and `wb.source`, a Compiler view, a Strategies view with editor, decision and trace, and browser verification on Blend.

### Why
- **Built-ins stay read-only.** Editing `src/typed/passes.ts` in the browser would need an in-browser TypeScript build and would let an experiment silently change the reference pipeline. Experiments live as project files instead: user passes in scripts, strategies in `strategies/*.json`. They are held to the same transaction rules, declared-kind checks, preservation checks and meaning contract.
- **Only the winner is published.** Losing branches of a `chooseBest` exist only inside the strategy execution. The timeline shows what was chosen, and the decision records the alternatives.

### What worked
`chooseBest` over O0, O1, O2 and loops gave these winners (alternatives in brackets):

| objective | project | winner |
|---|---|---|
| instructions | blend | O2 (2255 / 2235 / 1925 / 1945) |
| instructions | value-numbering | O2 (3721 / 3721 / 3082 / 3082) |
| instructions | licm-nested | O2 (2677 / 2677 / 1678 / 1678) |
| bytes | blend | O1 (96 / 88 / 88 / 96) |
| bytes | orders | O1 (156 / 136 / 136 / 152) |
| bytes | licm-nested | O0 (all four 68) |

In the bytes rows, the ties are broken by candidate name, as v6's decision record states (`tieBreak: 'lexicographic candidate name (code unit order)'`). After Blend's strategy run, `p.why('s:blend.15')` still answers through the published revisions. On wrong-shift, a candidate containing `div-to-shift` comes back as a rejected alternative (`contract-rejected`), and the plain candidate wins.

### What didn't work
- Nothing failed in this step's tests on the first run.

### What I learned
- v6's `chooseBest` already records everything a strategy view needs: the objective, constraints, tie-break, winner, and every alternative with metrics, violations or rejection.

### What warrants a second pair of eyes
- **Ties.** Name-order tie-breaking picks O0 when all candidates tie, which publishes nothing. That is defensible, because it is the cheapest compile. A secondary objective would need a v6 extension, or a constraint.
- **User passes are global.** `USER_PASSES` is a module-level registry shared by all programs in one page.

### Code review instructions
Read `src/typed/strategies.ts` (`runStrategy`) and `src/typed/builder.ts`, then run `npm test` (268/268).

## Step 8: everything the workbench shows fits a narrow tile

The user asked for files and presets formatted for a 60–80 column tile, and then clarified: "like the ones visible in the workbench, not necessarily the real source".

I chose 72 columns as the target, measured the corpus, and added a formatting module: a width-aware JSON printer, a Markdown-aware prose wrapper, and a way to write prose fields as lines. A tool reformatted the corpus's `project.json` and `notes.md`, and it verifies each file before writing it. Strategy presets now exist in a short form that fits a tile. The UI subagent has the matching rules for views and saved files.

### Prompt Context
**User prompts (verbatim):** "make sure all the files and presets and such are formatted for a narrower screen, like 60-80 chars wie, since it's a tile in the browser", then "like the ones visible in the workbench, not necessarily the real source".
**Assistant interpretation:** Corpus files, strategy presets and serialized plans, and anything the workbench saves or displays raw, should fit about 72 columns. Views should wrap rather than scroll. The compiler's own TypeScript keeps printWidth 110.
**Commit (code):** ca5be0d

### What I did
- **Measured.** Typed sources and the scripts and UI scripts were already within 80 columns. In `project.json`, 99 lines were wider (up to 196); in `notes.md`, 49 lines (up to 493). A two-candidate plan serialized by v6 was 57 columns wide but 233 lines long.
- **`src/typed/format.ts`:**
  - `formatJson`: inline when the value fits, broken one entry per line otherwise, built structurally.
  - `wrapProse`, with `splitWords` and `joinText`.
  - `TILE_WIDTH = 72`.
- **Strategies.**
  - `toJson` uses `formatJson`, and plan node ids are shorter (`choose`, `candidates`, `O2/3:constprop`).
  - The short form `StrategySpec` with `planFromSpec`.
  - `PRESETS` (O2, fastest, smallest, cleanup) and `presetFiles`.
  - `projectStrategies` accepts either form.
- **Corpus.** `src/typed/project.ts` joins prose fields that are written as arrays of lines. `tools/format-corpus.mjs` reformatted 88 files. `tests/typed/format.test.mjs` covers all of this.

### Why
- **72 columns** leaves room for a gutter and a scrollbar in an 80-column tile, and stays readable at 60.
- **Prose fields become arrays.** JSON strings cannot span lines, so a long `about` can fit a tile only as a list of lines. `projectSource` joins them, so nothing downstream changes.
- **Typed sources are left alone.** Their line numbers appear in provenance and in the book's figures (line 5 accounts for 322 of Blend's 451 instructions).

### What worked
- Every file changed by the formatter passed both pre-write checks: the meaning check (`projectSource` meta deep-equal) and the block check (the renderer's rules: fences, list continuations, paragraph joins).
- `--check` afterwards reports 0 changes. One line is 73 columns wide (`fixed-point/notes.md:1`), because its next word starts with `>`, which would open a blockquote at the start of a continuation line.
- 272/272 tests pass, and the full corpus parity is unchanged.

### What didn't work
- The first run of `tools/format-corpus.mjs` stopped before writing anything: `Error: across-calls: project.json meaning changed`. The normalization in `project.ts` had never been applied. My scripted replacement targeted `const meta = { … }` on one line, but prettier had broken that line, and the replacement silently matched nothing. I applied it with Edit.
- The same silent-mismatch failure hit the plan id shortening (`fastest/O0/keep` still appeared), for the same reason.
- Lesson: after a scripted replacement in a prettier-formatted file, confirm that the replacement happened (grep), or use Edit.

### What warrants a second pair of eyes
- `wrapProse` skips lines indented by four or more spaces, treating them as code, and lines starting with `#`, `|`, `---` or `> [!`. Markdown that relies on other block syntax would need adding to `STARTS_BLOCK`.

### Code review instructions
Read `src/typed/format.ts`, `tools/format-corpus.mjs` and `tests/typed/format.test.mjs`. Run `node tools/format-corpus.mjs --check` and `npm test`.

## Step 9: searching pass orderings, two merges, and reports 2 and 3

The user asked how the compiler compares with the original, and whether the framework allows more ambitious optimizations. I measured instead of asserting. Choosing among four orderings beats O2 on 12 of 44 projects. Following the winners up showed that 11 of the 12 gains are one extra `subst` after O2's final cleanup: the book's `t = i` loop copy, which turns out to be an ordering problem wherever `bce` has removed the check. Per-function search, built in this step, never beat per-program choice on the corpus, even with conflicting candidates.

In the same step I merged both subagents (the browser workbench, and f32 with Candela) and fixed one integration bug the merge created. I also wrote reports 2 and 3 for the vault.

### Prompt Context
**User prompts (verbatim):**
- "how good is the compiler compared to the original? or is it the same? are we able to do more ambitious optimizations that wouldn't have been easily opssible?"
- "ok we can also create new projects and such that try to create sick ass optimizations from candela to rv32, or anything else you think is worth exploring. Make a list of ideas. I'm really curious about what the new framework allows us to do"
- "ok, create a detailed report in the vault at important milestones, using a textbook authoring style. Make sure all the subagents diligently keep a detailed diary as they work."

**Assistant interpretation:**
- Answer with measurements: the code is identical by design; the framework enables checked search and specialization.
- Write the ideas list (design-doc 04, commit 6fc330f).
- Start on the first idea, ordering search.
- Write a report at each milestone and enforce the subagents' diaries.

**Commits (code):** 07c1b00 (metrics), ce92601 (per-function search), 6f241cd (UI merge), fcb155f (f32 and Candela merge).

### What I did
- **`measure`:** a run that hits the step limit costs the limit (2·10^5), and a new `limited` metric counts such runs. Previously one non-terminating case in `my-analysis` made the sum `NaN`, and the interpreter refused it with `IR data must contain only finite numbers`.
- **`strategies.ts`:**
  - every pass is also registered restricted to one function, as `typed.<pass>@<fn>`;
  - `searchPlan` is one `chooseBest` per function, with `typed.metrics` given `{ fn }`.
- **`tools/search-experiment.mjs`:** O2 against per-program choice against per-function search, over the corpus, by instructions.
  - Evidence in `various/experiments/01-*`.
  - The conflicting-candidate run is `scripts/05-per-function-conflicting-candidates.mjs`, with output in `various/experiments/02-*`.
- **Follow-up of the winners:** after O2, I applied `O2+more`'s extra passes one at a time on checksum and early-exit, then O2 plus one `subst` on all twelve winners.
- **Diaries:** messaged the UI agent, whose diary was missing (it backfilled steps 1–4 from commits and wrote step 5 live), and the f32 agent, which kept its diary current.
- **Merges:**
  - UI: conflict in `strategies.ts`; kept both sides, with per-function passes registered through the agent's `pause` wrapper.
  - f32: conflict in `ir.ts`; both sides had indexed `resolve`, and I kept the agent's helper.
  - Added `typedTape` to `site-src/main.js`'s `setVendor`.
- **Reports in the vault:** report 2 (strategies, search, audit, specialization, browser) and report 3 (Candela).

### Why
- **Experiment before answering.** "Is it better?" has a measurable answer here, and the ideas list ranks ordering search first because it needs no new pass.
- **Per-function search** needed per-function passes. Restricting an existing pass body by function name reuses every rule and check, rather than adding a second mechanism.

### What worked
- **Search (`01-search-o2-per-program-per-function.json`):**
  `{"projects":44,"fasterPerProgram":12,"fasterPerFunction":12,"fnBeatsProgram":0,"programBeatsFn":0,"allChecksAgree":true}`.
  - Instructions excluding `my-analysis`: 77,321 → 75,651 (−2.2%).
  - Bytes: 5,160 → 5,092. Every winner is also smaller.
  - Compile time: 1,265 s in all.
- **Winners:**
  - `constants`: O2 twice (70 → 40).
  - The other 11: `O2+more`. For each, O2 + one `subst` gives the same count (`checksum 1260 SAME`, … `wrong-shift 1500 SAME`). After O2, Checksum's loop has `s:total.4 t3 = i`. Of the nine extra passes only the first `subst` changes anything (`lvn false 1410`, `subst true 1260`, all others false).
- **Conflicting candidates** (O1, O2, loops, O2 without licm; 19 multi-function projects): `{"prog":33354,"fn":33354}`. Functions choose different winners (`div-magic: digitsum=O1 sevenths=loops`), but only where the alternatives tie.
- **Merged tree:** `npm test` 301 pass, 1 skipped (`IRWB_CANDELA`); the `IRWB_FULL=1` corpus parity holds. In the browser, Blend → Run reaches `r6 40/40` with only the favicon 404 in the console.

### What didn't work
- **`pkill -f "tools/serve-site.mjs"` killed my own shell** (exit 144), because the pattern matched the shell's command line. The same happened with `pgrep -f "node tools/serve-site"`. That aborted the commit command the first time. Use a pattern such as `[s]erve-site`.
- **Report 2's first draft predicted wrongly.** It said per-function search "becomes useful with candidates that disagree". The conflicting-candidate experiment refuted that for this corpus, and the report now states the measured result.
- **My first explanation of `O2+more`'s wins was a guess** (more value numbering, more copies). Applying the passes one at a time showed it was a single `subst`.

### What I learned
- The book's `t7 = i` gap is two problems. Where `bce` removes the check, the copy has one reader and an end-of-pipeline `subst` removes it. Where the check stays (Blend), it has two readers and needs real coalescing.
- On the corpus's programs, a single choice per program loses nothing to per-function choice.

### What was tricky to build
- **The f32 merge's browser dependency.** `lift()` now always calls `inferLocalTypes`, which reads the tape's row table even on the default path. `npm test` could not catch the missing vendor in the page; only a browser load did.

### What warrants a second pair of eyes
- **Per-function passes multiply the registry:** passes × functions, 3,652 algorithms for Candela. They are built on every `strategyRegistry` call.
- **The search's metric** is 10 cases per function. It decides winners, but the evidence that a winner is correct is the meaning contract (40 cases per pass, plus 40 at the end).

### What should be done in the future
- Add a pipeline `O2+` (O2, then `subst`), and keep O2 itself for parity with the book.
- Copy coalescing for copies with several readers, and loop rotation, measured against the reference compiler's 383/292/1,533/1,486.
- Run the Candela oracle with the `kernel` policy, now that the pass groups are vendored.

### Code review instructions
Read `src/typed/strategies.ts` (`searchPlan`, the scoped registration, `measure`), then run `node tools/search-experiment.mjs` (about 21 minutes).

## Step 10: bookkeeping caught up, design-doc 05 for the next phase

The user asked me to go ahead with the next phase and to keep its four practices. I caught up the docmgr ticket, which was behind: four finished tasks were unchecked, and the changelog had no entries after the first milestone. Then I measured the three things the next design depends on, and wrote design-doc 05 before writing any code. The doc covers six pieces of work: O2+, framework performance, the f32 backend (for a subagent), `caddr` bounds checks, the kernel-policy oracle, and per-scene kernels.

The user also set the diary cadence: a step at every significant action, more often than commits, about ten per milestone. Steps 1–9 were milestone-sized summaries. From this step on they are not.

### Prompt Context
**User prompts (verbatim):**
- "Ok, go go go go. diary docmgr deisgn doc vault report, do you know what that means?"
- Mid-turn: "diary should be more frequent than milestones, it should be like, at any significant step where something was done, more frequent than commits potentially. A milestone is probably something like 10 diary entris (of course this can vary wildly)"

**Assistant interpretation:**
- Proceed with the next steps I proposed.
- For each piece of work: a design doc first, docmgr bookkeeping, frequent diary steps, and a vault report at each milestone.

**Commit:** cbe69a0

### What I did
- **docmgr:**
  - checked pb99 (wb layer), es43 (UI), z21g (R2) and m7y3 (a duplicate of the finished inventory task);
  - added 4c1o (O2+), owi2 (f32 backend), 9rcu (framework performance), t4dq (caddr bce), gxe6 (kernel-policy oracle) and tjdl (R3);
  - added four changelog entries covering steps 5–9.
- **Measurements for the design:**
  - `src/framework/core/data.ts` and `createIRArtifact`: an artifact costs five canonical encodings, two SHA-256 hashes, and two encodings per entity during projection.
  - The backend is 2,000 lines, with a single register class in `regalloc.ts`.
  - Candela's scene dispatch reads `q_k.scene`, a field of record `K` (types.typed:156), in five dispatchers. 177 of 332 functions are scene sections (`grep -c "^function s[0-9]*_"` on scenes.typed). Nothing writes `.scene` (`grep "\.scene *=[^=]"` is empty).
- **Design-doc 05,** related to `data.ts`, `regalloc.ts` and `kernel.typed`.
- **Memory:** the diary cadence rule is saved, so it applies to me and to every subagent brief.

### Why
- **Framework performance first among the large items.** Each later Candela experiment runs O2 at least once, and at two minutes per pass every experiment costs half an hour.
- **Field bindings, not parameter bindings, for scenes.** The scene index is a memory field of a record passed everywhere, so the existing specialization, which substitutes parameter reads, would not reach it.

### What worked
- The measurements were enough to make every section concrete: the operator table for the backend, the register-class table, and the dispatcher's shape.

### What didn't work
- Nothing failed in this step.

### What I learned
- Candela's per-scene sections are more than half of all functions. Specialization plus dead-function elimination should therefore shrink the image far more than any pass ordering.

### What warrants a second pair of eyes
- **The `immutable` short circuit (design-doc 05, section 3.2)** assumes that a value in the `CANONICAL` set can never contain anything non-canonical. That holds only if every object in it was created by `JSON.parse` of canonical text and then frozen.

### Code review instructions
Read `design-doc/05-…md`, then `docmgr task list --ticket IRWB-001`.

## Step 11: O2+ (task 4c1o)

This step turns the ordering search's finding into a pipeline: `O2+` is O2 followed by one `subst`. Across the corpus it is faster than O2 on exactly the eleven projects the search predicted, and never slower or larger.

### Prompt Context
**User prompt (verbatim):** see Step 10.
**Assistant interpretation:** design-doc 05 §2.
**Commit (code):** the commit after this step (O2+, tests, scripts/06, experiments/03).

### What I did
- **`src/typed/passes.ts`:** added `PIPELINES['O2+']`, which is O2's 16 passes plus `subst`, with a comment naming the finding. O2 is unchanged.
- **`tests/typed/strategies.test.mjs`:** O2+ equals O2 plus `subst`. On Checksum, O2 leaves `t3 = i` and 1,410 instructions; O2+ removes it, giving 1,260, and its check agrees.
- **`tests/workbench/strategies.test.mjs`:** the compiler's pipeline list now includes `O2+`.
- **`scripts/06-o2-plus-corpus.mjs`:** O2 against O2+ on all 44 projects. Output in `various/experiments/03-o2-plus-corpus.{json,log}`.

### What worked
- The corpus comparison:
  `{"better":[11 projects],"worse":[],"biggerImage":[],"allAgree":true,"totals":{"o2":77321,"plus":75681,"o2b":5160,"plusb":5104}}`.
- The eleven projects are those of step 9: across-calls, bounds-lab, bounds-two, checksum, early-exit, histogram, ramp, start-here, strength, strings and wrong-shift.
- `npm test` passes; see the commit.

### What didn't work
- Nothing failed.

### What I learned
- O2+ reaches 75,681 instructions; the search's best reached 75,651. The 30-instruction difference is `constants`, which needs O2 twice. O2+ captures 98% of the search's gain at the cost of one pass.

### What warrants a second pair of eyes
- The strategy presets (`fastest`, `smallest`) still choose among O0, O1, O2 and loops. Adding O2+ to them changes the winners that the UI tests pin.

### Code review instructions
`src/typed/passes.ts` (`PIPELINES`), then `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/06-o2-plus-corpus.mjs`.

## Step 12: framework performance on large artifacts (task 9rcu)

A pass on Candela cost about two minutes even when it changed nothing. Nearly all of that time was the framework's generic encoding, hashing and freezing. This step removes the repeated work without changing a single hash. The no-change pass went from 86 s to 18 s and `cfg` from 101 s to 31 s. Every corpus project's r0, O2 and image revisions are identical before and after.

### Prompt Context
**User prompt (verbatim):** see Step 10.
**Assistant interpretation:** design-doc 05, section 3.
**Commit (code):** the commit after this step.

### What I did
- **Baseline.** `scripts/07-framework-cost.mjs` measures Candela r0:
  `{"createIRArtifact":7897,"project":4792,"cfgAnalysis":4933,"strength":{"ms":86423,"changed":false,"rev":"cd36346ea7c4f175"},"cfg":{"ms":101058,"changed":true,"rev":"4aea7e81dd046901"}}`.
- **Round 1, `src/framework/core/data.ts`.** `immutable` builds the sorted, frozen copy directly instead of `JSON.parse(canonical(v))`. It returns values it produced unchanged, and records them in a `CANONICAL` WeakSet. `canonical` caches the text of canonical values of 4,096 characters or more.
  - Result: strength 38 s, cfg 65 s, the same revisions.
- **Profile** (`--cpu-prof`, attributed to the first caller outside `data.js`):
  - `validateGraph`/`project`: 7.2 s;
  - `requireRecord`, called by `validateEntity`: 5.4 s;
  - `validateEntity`: 3.2 s;
  - `createIRArtifact`: 2.7 s;
  - correspondence validation: 2.3 s;
  - `project` from `openIR`: 2.3 s;
  - `sha256`: 9.2 s in total.
- **Round 2.**
  - `fingerprint` caches the hash of canonical values.
  - `isCanonical` added; `requireRecord` skips re-encoding values `immutable` already validated.
  - `sameCanonical(a, b)` compares canonical values structurally; `project` uses it for the per-entity resolve check instead of comparing two encodings.
  - In `adapters.ts`: a `VERIFIED` WeakSet of artifacts whose hashes were computed or checked, so `validateIRArtifact` does not re-hash them; and a `PROJECTED` cache per captured adapter and canonical value.
- **Equivalence.** `scripts/08-corpus-revisions.mjs` prints each project's r0 revision, every O2 revision and the image revision. I ran it with the three framework files stashed (old code) and popped (new code), then diffed: `IDENTICAL: 44 projects`.

### Why
- **Every cache is keyed on objects that cannot change.** A deep-frozen canonical value, a captured (frozen) adapter, or a frozen artifact. The cached text, hash or projection is a deterministic function of such objects, so caching cannot change a result, only skip recomputing it.
- **`immutable` without text.** `JSON.parse(canonical(v))` encodes the whole value and parses it back. Building the copy directly performs the same validation in one walk.

### What worked
- **After round 2** (`07-framework-cost.mjs`):
  `{"createIRArtifact":5027,"project":0,"cfgAnalysis":1184,"strength":{"ms":18195,"changed":false,"rev":"cd36346ea7c4f175"},"cfg":{"ms":30861,"changed":true,"rev":"4aea7e81dd046901"}}`.
  The revisions equal the baseline's. That is 4.7× on the no-change pass and 3.3× on cfg.
- **Tests:** framework 221/221; the whole suite 302 pass and 1 skipped. Its duration fell from 49 s to 37 s.

### What didn't work
- `node --test tests/framework/` failed as `✖ tests/framework`, because `node --test` does not take a bare directory. The glob form `"tests/framework/**/*.test.mjs"` is the right invocation.

### What I learned
- After round 1 the cost was not encoding as such. It was validation repeated on values already known to be valid: `requireRecord` encodes attributes only to check them, and `project` encodes two entities only to compare them. A set of canonical values makes all of that answerable by lookup.

### What was tricky to build
- **Matching `JSON.parse` exactly.** `immutable` must give what `JSON.parse(canonical(v))` gave: keys in sorted order, −0 as 0, and a `"__proto__"` key kept as an own property. A plain assignment `o['__proto__'] = x` would set the prototype instead, so the code uses `Object.defineProperty` with the attributes `JSON.parse` uses.

### What warrants a second pair of eyes
- **The caches assume adapter functions are deterministic.** The framework assumes this already, since revisions are content hashes. A non-deterministic `entities` or `resolve` would now be hidden by the projection cache rather than caught by the resolve check.
- **Memory:** the text cache keeps strings for large canonical values while those values are alive.

### Code review instructions
- `src/framework/core/data.ts` (`immutable`, `canonical`, `fingerprint`, `isCanonical`, `sameCanonical`), then `src/framework/ir/adapters.ts` (`VERIFIED`, `PROJECTED`, `project`).
- Run `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs` on the old and new code and diff the outputs.

## Step 13: what Candela's checked addresses look like, and a first bcm that removed 11 of 559

Design-doc 05 planned `caddr` bounds-check elimination from dominating tests, the existing `bce` argument. Before writing it, I looked at the actual checks. In `oRow` there is no test at all. One statement makes four checked reads from the same buffer at positions `2·q_t0 + 1`, `+3`, `+5`, `+7`. So I measured how the 559 checks relate, and changed the plan to merging checks within a block rather than eliminating them.

### Prompt Context
**User prompt (verbatim):** see Step 10.
**Assistant interpretation:** design-doc 05 §5, task t4dq; the doc's rule is revised by measurement.

### What I did
- **Listing.** Counted caddr per function on Candela r0: 559 in 41 functions (`cdlInit` 256, `finishHit` 32, `skyL_wgsl` 27, `tracePath` 21, …), and printed `oRow`.
- **`scripts/09-caddr-patterns.mjs`.** Groups checks by block, receiver and the linear base of the position.
  - First run: `{"total":559,"constPos":0,"groups":559,"inGroupsOf2plus":0}`. At r0 positions are locals (`get t5`), so every check landed in its own group.
  - After resolving locals with a single assignment: `{"total":559,"constPos":442,"groups":81,"inGroupsOf2plus":538,"removableByMinMax":421}`.
- **`bcm`, version 1.** Constant positions only, one local deep. It merges a block's checks on one receiver into a check of the largest position at the first site.
  - Group boundaries: calls, `zero`, and stores not provably inside a buffer's data.
  - Run with `scripts/10-bcm-candela.mjs` (contract at 40 cases per function):
    `{"from":"r0","caddrBefore":559,"caddrAfter":548,"changed":true,"edits":12,"ms":46587}`.

### Why
- **Merging needs no outside fact.** Dominating tests are rare in generated code that indexes rows by computed positions. Proving those reads in bounds would need Candela's row-count facts. Merging does not: if the largest position of a group is in range, every smaller non-negative one is too.

### What worked
- The contract accepted the pass on Candela, so no sampled case changed meaning.

### What didn't work
- **Only 11 checks went**, against 421 predicted. The analysis script resolved chains of locals (`t5 = (q_t0 << 1) + 1`, `q_t0 = …`) transitively, while the pass resolved one local and only literal constants. The script measured what a deeper resolution could do, not what the pass did.

### What I learned
- In generated code the positions are linear in a row index (`(row·6 + k)·4·2 + 1`). The useful form is "base + constant", not "constant".

### What should be done in the future
- Linear positions with a symbolic base: Step 14.

## Step 14: bcm over linear positions: 559 checks become 100 on Candela r0

The second version of `bcm` handles positions of the form base + constant, computed exactly modulo 2³², with a symbolic base. The rule, for a block's checks on one receiver:
- **Constant positions:** the largest is checked once, at the first site.
- **Symbolic base:** the smallest and the largest are checked, at the first two sites. Every other site becomes an unchecked `r + 2p`.

On Candela r0 the 559 checked addresses become 100, and the meaning contract accepts the result.

### Prompt Context
**User prompt (verbatim):** see Step 10.
**Commit (code):** the commit after this step.

### What I did
- **Linear forms** `{terms, k}` over `add`, `sub`, `shl` and `mul` by constants, all modulo 2³² (`Math.imul`, `| 0`).
- **Stable names for terms.** A local read is named by its single reaching definition when that definition is earlier in the same block (`index(d) < index(site)`). That definition runs once per block execution, so equal names are equal values. Otherwise a local is named as itself, provided the block never assigns it. A literal assigned by a single definition anywhere is a constant.
- **Explicit roles** per site: `keep` (the site's own check is one of the group's), `check` (rewrite to `caddr(r, p + Δ) − 2Δ`), and `unchecked` (`r + (p << 1)`). Unchecked sites carry `because: [first site's statement]`.
- **Tests,** `tests/typed/bcm.test.mjs`, on a tape-lifted fixture:
  - constant positions 0, 3, 1 merge to one check;
  - `i`, `i+1`, `i+2` keep two checks of three;
  - `i`, `i+5` stays at two;
  - a call between two reads keeps both checks;
  - `why` on an unchecked address reaches the group's check.

  Each test also checks the meaning at 200 cases with texts of length 0–6, so traps occur.
- **`tests/workbench/strategies.test.mjs`:** the compiler now lists 12 passes.

### Why
- **Why the base needs both checks.** For a symbolic base, B + kmin and B + kmax below the capacity imply every position between is too, as long as B + kmin + (kmax − kmin) does not wrap. It cannot, because a text's capacity is below 2³¹ units: its units take 2·capacity bytes of a 32-bit address space. For constant positions, all ≥ 0, the largest check alone suffices and needs no such argument.
- **Why moving the check is sound.** Every caddr of a block runs whenever the block runs, unless something traps first, and a trap aborts the program. The merged check can therefore trap earlier than the original, but never in a run that would not have trapped. Calls end a group because a call might not return. A store ends a group unless it provably writes a buffer's data: a checked caddr at a constant position c ≥ 0 with 2c + offset ≥ 4. Any other store could overwrite a capacity word.

### What worked
- Candela r0: `{"caddrBefore":559,"caddrAfter":100,"changed":true,"edits":482,"ms":56529}`. In `oRow`, the four checks became two:
  ```
  return (loadf32[(caddr(q_bO, (t5 + 6)) + -12)+2], loadf32[(caddr(q_bO, (t6 + -2)) + 4)+2],
          loadf32[(q_bO + (t7 << 1))+2], loadf32[(q_bO + (t8 << 1))+2])
  ```
- `npm test`: 306 pass and 1 skipped.

### What didn't work
- **A role bug, caught before running.** The first version marked a symbolic group's second site with "no rewrite" when its position already was the smallest, and the rewrite then treated "no rewrite" as "unchecked". That would have dropped a check that must stay. An explicit `mode` per site removed the ambiguity.
- **The provenance test failed twice.**
  - It looked for the reason in the edit records (`because: []`), but `make` options are recorded on the new value's origin.
  - `why` on the statement's load showed only "rebuilt around a changed argument". The reason is one level down, on the rewritten address, which the test now follows.

### What I learned
- The edit log's `because` is per rewrite call; a per-value reason lives in the value's origin. A UI that shows why a check disappeared has to show the address value's `why`, not the statement's.

### What warrants a second pair of eyes
- **The capacity bound.** The assumption that a capacity is below 2³¹ units is an argument about the address space, not something the IR states. A text buffer whose capacity word holds garbage would break the symbolic-base case; the meaning contract would see that only if its cases contained such a buffer.
- **`safeStore`** accepts only constant-position stores, so symbolic-position stores (row writes in loops) end groups. That is conservative, and may leave checks in `cdlInit`.

### Code review instructions
- `src/typed/passes.ts` (`bcm`) and `tests/typed/bcm.test.mjs`.
- `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/10-bcm-candela.mjs` (about 1 minute).

## Step 15: the Candela oracle against the reference compiler's kernel policy (task gxe6)

The f32 agent's oracle used the reference compiler's `stock` policy, because its base revision lacked the reference pass groups. They are vendored now, so I ran the oracle against `kernel`, the policy the device uses. It agrees on every decided case, exactly as `stock` did.

### Prompt Context
**User prompt (verbatim):** see Step 10. Mid-step, the user also asked for a separate research-agenda ticket. A Fable subagent was launched for it (IRWB-002, with its own diary), and it is not part of this step.

### What I did
- `tools/candela-oracle.mjs`: a `--policy P` option (default `stock`), passed to `referenceCompile`.
- `node tools/candela-oracle.mjs --count 100 --policy kernel --json > various/experiments/04-candela-oracle-kernel-policy.json`.

### What worked
- `{"functions":332,"cases":33200,"values":31617,"traps":1368,"agree":32985,"disagree":0,"inconclusive":215,"faults":0,"allValueFunctions":330,"ms":312567}`.
- These are the same counts as with `stock`. The `kernel` policy inlines, rotates loops and unrolls. Its images compute the same results as the evaluator on every decided case, including traps.

### What didn't work
- Nothing failed. The run took 313 s, against about 40 s for `stock`. Compiling with the kernel passes and running larger images costs more.

### What I learned
- The evaluator now agrees with two different compilations of Candela. Our own f32 backend's images, when they exist, therefore have a target that is itself cross-checked.

### Code review instructions
`node tools/candela-oracle.mjs --count 100 --policy kernel` (about 5 minutes).

## Step 16: the full Candela O2 run after the framework speedup

This step re-ran O2 on all of Candela on the build from Step 12, as design-doc 05 §3.3 asked. It took 19 minutes instead of 36. The final check is now at the intended step limit and has fewer inconclusive cases.

### What I did
- `/usr/bin/time -v node --max-old-space-size=12288 tools/candela-o2.mjs --json --save head.json`. It ran while other measurements shared the CPU (the bcm runs, the oracle and the tests).
- Evidence: `various/experiments/05-candela-o2-after-framework-speedup.{json,log}`.

### What worked
- `{"rev":13,"final":{"total":33200,"agree":33184,"disagree":0,"inconclusive":16},"ms":{"pipeline":1128733,"final":256951,"total":1395118}}`, with a maximum RSS of 5.8 GB.
- **Pipeline:** 1,129 s against 2,178 s before (1.9×, on a busy machine).
- **Revisions:** the same 13.
- **Statements:** 12,358 → 9,479, as before.
- **Final check:** 16 inconclusive cases against 58. This run used `--final-limit` 2·10^5; the earlier run did not.

### What didn't work
- The per-pass times grew towards the end (`subst` 127 s and 137 s), when the parallel runs started. The 1.9× is a lower bound.

### What I learned
- Memory, not time, is now the limit for keeping many Candela revisions: 5.8 GB for 13 revisions with their analyses.

## Step 17: rendering Candela scenes, on the emulator and on our evaluator, bit-identical

The user asked to see a Candela program's rendered image when run on the emulator, in the workbench. This step builds the host side.
- **The scene data:** the gallery's scene table, vendored as data.
- **The frame loop:** a port of ds-js-os's host protocol.
- **Two engines:** the reference compiler's RV32 image on the RV32 interpreter, and our evaluator at any revision.
- **Output:** PNG views of the frame.

"Hello, sphere" renders. Our evaluator, at r0 and at the O2 head, produces the same 19,200 output floats as the emulator, bit for bit.

### Prompt Context
**User prompt (verbatim):** "can i test one of the candela programs and see te rendered image when run on the emulator in the workbench?"
**Assistant interpretation:**
- Not yet; three things are missing: real scene data (the checks so far used synthetic rows), a driver for Candela's frame loop, and a view.
- Build the host side, verify it, then have the workbench show it.

### What I did
- **Finding the data.**
  - In ds-js-os, `apps/typed/candela-gallery/link.js` names the four slot entries (`cdlLayout`, `cdlInit`, `cdlSky`, `cdlRenderSpan`).
  - `tools/gen/candela/typed/host.mjs` drives them over a memory image; I read it and did not run it.
  - The packed scenes come from Candela's own front end (`lib/candela.mjs exportScene`), but the generator writes them into `firmware/third_party/candela/gallery/candela_gallery_scenes.c`: per scene the U, O, LI, BV and SD rows as float bit patterns, plus a `cg_scenes[]` table.
  - I chose that file, so no Candela code runs. It is byte-identical at b19062b and HEAD (`cmp`; SHA-256 `a0039225…`).
- **Vendored** into `corpus/candela-gallery/candela_gallery_scenes.c`, recorded in its `VENDOR.json` with a note: data only, never compiled.
- **`src/typed/candela-render.ts`:**
  - `parseSceneTable`: 18 scenes, with word counts checked against the row counts.
  - `CandelaHost`: layout, bind and span, ported from `host.mjs`.
  - `renderScene` (with an optional `stride` for previews) and `viewImage` (colour with automatic exposure, albedo, normal, depth).
- **`tools/candela-render.mjs`:** `candelaScenes()` (digest-checked), `engineFor('reference' | 'evaluator', { policy, head })`, a minimal PNG writer, and the command-line tool.
- **`scripts/11-candela-render-compare.mjs`:** renders with two engines and compares every output float bit for bit.

### What worked
- **`--list`** prints the 18 scenes, in the order `scenes.typed` indexes them (0 B-01 "Hello, sphere" … 17 G-03).
- **B-01 at 160×160 on the emulator** (`kernel` policy): `{"steps":217105487,"stepsPerPixel":8481,"renderMs":18670,"nonFinite":0}`. The image shows a red sphere on a floor under a sky, at one sample per pixel. Renders are in `various/renders/`.
- **Comparisons at stride 4** (1,600 pixels, 19,200 floats):
  - emulator against evaluator at r0: `"differentBits":0`; the emulator ran 13.6 M instructions, the evaluator 4.98 M statements.
  - emulator against evaluator at the O2 head: `"differentBits":0`; the evaluator ran 3.75 M statements (−25%).

### What didn't work
- **The first PNG was almost white.** It used a fixed exposure of 1, and Candela's colours are physical radiance (median ≈ 7,000; the centre pixel ≈ 3,092, 557, 359). Automatic exposure fixed it: the log-average luminance maps to 0.18.
- **A tiny preview cannot show the scene.** At stride 4 the image is 40×40; full size is needed to judge it.

### What I learned
- Rendering is a far stronger whole-program check than sampled function cases. It runs every entry with real scene data, and bit-identical floats leave no room for tolerance arguments.

### What was tricky to build
- **`bind` writes capacities in UTF-16 units** (8 per row of 16 bytes), with data from byte 4. K's first five fields are the row buffers. `K.scene` is at word 7, `K.spectral` at 8, `K.skyOn` at 9, which is cleared for `cdlSky` and set afterwards. All of this follows `host.mjs` exactly.

### What should be done in the future
- The view in the workbench: delegated to the UI agent, resumed with its context.
- Accumulate several frames for less noise; the gallery's frame indices are 0, then p + 1.
- Our own RV32 image as a third engine, when the f32 backend lands.

### Code review instructions
- `src/typed/candela-render.ts`, then run `node tools/candela-render.mjs --scene R-01 --stride 2` and `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/11-candela-render-compare.mjs B-01 4`.

## Step 18: field bindings, entry-only contracts and dead-function elimination (for task ckco)

Per-scene Candela kernels need three things the compiler did not have:
- **Field bindings.** Bind a record field, `K.scene`, rather than a parameter.
- **Entry-only contracts.** A contract that compares only the program's entries, the four functions of the gallery slot, so functions only they call may change or disappear.
- **A program-level pass.** `dfe` removes functions no call from the entries reaches.

All three are built and tested on a fixture. A record-field binding turns a dispatch into one call, and `dfe` then removes the other callee and an unused function.

### Prompt Context
**User prompt (verbatim):** see Step 10 ("go go go go", design-doc 05 §7).
**Commit (code):** the commit after this step.

### What I did
- **`src/typed/evaluate.ts`:** `MeaningParams.roots`. When given, cases come only from those functions, and the roots are part of the check's key and description.
- **`src/typed/program.ts`:**
  - `options.entries`: the program's entries. Contracts (`apply`), `check` and `verify` compare only them.
  - `assume` accepts field bindings `{ record, field, value }`, assuming `<param>.<field>` for every parameter of that record type in every function.
  - `inputs` turns a dotted assumption into `{ record: { …, field: { oneOf: [v] } } }` inside the parameter's spec.
- **`src/typed/specialize.ts`:**
  - `Binding` has either a parameter form (`fn`, `param`) or a field form (`record`, `field`).
  - The pass reads the record layout from `st.frontEnd.records` (Candela: `K.scene` is the i32 at offset 28). It replaces `load32[p + offset]`, where `p` is a parameter of that record type with its own value, by the constant.
  - It refuses with `TxError('unsupported')` when the function stores to that field through such a parameter.
- **`src/typed/passes.ts`:** `dfe`, a `definePass` over the whole program.
  - Reachability by calls from `params.roots`. Dead functions are removed together with their `op:<fn>#` front-end ops (everything else goes with the function in `toNative`).
  - Correspondence: one `removed` entry per vanished entity, `because: ["entries: …"]`.
  - Report edits of kind `removeFn`.
  - Its spec is marked `program: true`, so `strategyRegistry` does not build per-function variants of it.
- **`tests/typed/dfe.test.mjs`:**
  - `dfe` removes `unused` and refuses to run without roots.
  - Binding `Q.mode = 1`, then constprop, fold, cfg, dce, cfg and dfe, leaves `entry`, `pick` and `two`, and the check compares only `entry`.
  - A program that writes `q.mode` is refused.
- **`tests/workbench/strategies.test.mjs`:** the compiler now lists 13 passes.

### Why
- **Roots are a parameter.** A program cannot know its entries from its own text: an uncalled function may be exactly what the host calls. Candela's entries come from `link.js` (`cdlLayout`, `cdlInit`, `cdlSky`, `cdlRenderSpan`).
- **The contract has to follow.** After `dfe`, a removed function has no cases to run. Comparing only the entries is what the program means to its host.

### What worked
- 309 tests pass, 1 skipped.

### What didn't work
- **The fixture did not parse** (`expected identifier`). The front end requires a final `return` after an if/else whose arms both return; bisecting the fixture's functions found it. The fixture now assigns `r` in both arms and returns it.
- **`one` was still called** after specialize, fold, cfg, dce and cfg. The specialized `m = 1` is an assignment, so `constprop` must run before `fold`. With it, `pick` reduces to `t5 = two(x); r = t5; return r`.
- **The first `dfe` declared writes on entity kind `function`.** The projection's kind is `fn`, while the store's record kind is `function`.

### What I learned
- A field binding is checkable in two ways. Statically, the pass refuses if the function writes the field. Dynamically, the restricted contract compares with r0 only on inputs where the field holds the value.

### What warrants a second pair of eyes
- **The field rewrite matches only loads through a parameter whose only reaching definition is itself.** A copy of `K` into another local is not followed. In Candela every K-typed value is a parameter (`q_k`).
- **The static write check covers direct stores through the parameter only.** A store through a computed address that aliases the field is left to the contract.

### Code review instructions
- `src/typed/specialize.ts` (the field branch), `src/typed/passes.ts` (`dfe`), `src/typed/program.ts` (`entries`, `assume`, `inputs`).
- `node --test tests/typed/dfe.test.mjs`.

## Step 19: the first per-scene kernel: the Cornell box keeps 137 of 332 functions and renders bit-identically

This step ran the per-scene pipeline on R-01, the Cornell box:
1. specialize on `K.scene = 1`;
2. constprop, fold, cfg, dce, cfg;
3. dfe from the gallery slot's four entries.

The program falls from 332 to 137 functions and from 12,358 to 5,400 statements (−56%). The frame, rendered by our evaluator on the specialized program, equals the emulator's frame from the reference compiler's general image, bit for bit. The run over all 18 scenes is in progress.

### Prompt Context
**User prompt (verbatim):** see Step 10. Mid-step the user asked whether the Fable research agent was back. It was not: in its worktree it had created IRWB-002, a 729-line guide draft, 5 diary steps and 5 scripts, with no upload yet.

### What I did
- **`scripts/12-candela-per-scene.mjs`:**
  - opens a `Program` with `entries` = `cdlLayout`, `cdlInit`, `cdlSky`, `cdlRenderSpan` and `candelaInputs`;
  - applies `specialize` with the field binding `{ record: 'K', field: 'scene', value: s.index, entity: 'scene/<id>' }`;
  - runs the five cleanup passes, then `dfe` with those roots;
  - renders the scene at stride 8, with the evaluator on the head and with the emulator on the `kernel` image, and compares output floats bit for bit.
- Ran it on R-01. Evidence in `various/experiments/06a-candela-per-scene-R-01.json`. The 18-scene run writes `06-candela-per-scene.{json,log}`.

### What worked
- **Pass log:** `specialize r1 26 s`, `constprop r2 35 s`, `fold r3 50 s`, `cfg r4 25 s`, `dce r5 31 s`, `cfg - 26 s`, `dfe r6 26 s`. Every pass was gated by the entry-only contract.
- **Result:** `{"scene":"R-01","fns":"332->137","stmts":"12358->5400","differentBits":0,"ms":332399}`.

### What I learned
- dfe removed 195 functions. The other 17 scenes' sections account for about 165 of them (177 scene functions in all). The rest is shared code that only other scenes use, such as spectral and volume paths. Specialization reaches beyond the dispatchers.

### What warrants a second pair of eyes
- **The sampled contract here compares only the four entries**, with synthetic K rows. Many `cdlRenderSpan` cases may hit the step limit. The decisive evidence for a scene kernel is therefore the frame comparison, which uses the scene's real rows.

## Step 20: the research agenda (IRWB-002) merged; its upload verified

The Fable subagent finished the intern guide and research agenda the user asked for, in its own ticket, IRWB-002. I checked that its branch touches only that ticket, merged it, and confirmed the reMarkable upload by listing the folder.

### Prompt Context
**User prompts (verbatim):**
- "So, launch a fable subagent and have them look at @/tmp/irs.md and @/tmp/irs2.md and the current code and approach, and write a new docmgr ticket … Have the subagent stop after the upload. Have them keep a detailed diary as they work, and commit scripts they write…"
- Later: "does the fable agent specifically look for optimizing candela programs, or are they looking for wide areas of compielr research? (it should be the latter)". I relayed this as a scope steer. The agent applied it: it added workstream J (languages and IR design), D7, H5, I4 and I5, SSA-based and PBQP register allocation, and autotuning. Its section 18 states that Candela is a workload, not the focus.

### What I did
- `git diff --name-only irwb-001/import-v6-prototype...worktree-agent-afc970df0c231de2f`: only `ttmp/2026/11/24/IRWB-002…` (12 files, 2,886 lines).
- Merged as `2ad1f33`.
- `remarquee cloud ls /ai/2026/11/25/IRWB-002` → `[f] IRWB-002 Intern Guide and Research Agenda`.

### What worked
- **The guide:** 170 KB. Part 1 explains the system from the code. Part 2 has 54 work items in ten workstreams, each with pseudocode, why here, needs, acceptance, size and dependencies. Part 3 has phases, seats, risks, a file index and a glossary.
- **Its diary:** 9 steps. Its scripts 01–06 are in IRWB-002 `scripts/`.
- **One new measurement:** 65 Candela functions are exact textual copies of another, 74 ignoring the scene prefix (`scripts/05-candela-duplicate-functions.py`). That supports identical-code folding (H4).

### What warrants a second pair of eyes
- **The PDF's rendering was not inspected.** It has wide tables and box-drawing diagrams. The uploaded copy also predates the agent's diary step 9.

## Step 21: the Candela view merged: scenes render on the emulator inside the workbench

The UI agent built the Candela view the user asked for in Step 17. I merged it with no conflicts. The merged tree passes its tests and builds, and the site is served locally on the merged build.

### Prompt Context
**User prompt (verbatim):** see Step 17 ("can i test one of the candela programs and see te rendered image when run on the emulator in the workbench?").
**Commit (code):** e4d5497 (merge). The agent's commits are 5b2752e, 4c30a6d and 4cd57be; its diary steps 6–11 are in `log/05-ui-agent-diary.md`.

### What I did
- Merged `worktree-agent-a0d04b6b5f2b020be`. The checks:
  - `npx tsc`: clean.
  - Full suite: 316 pass, 2 skipped.
  - `npm run build:site`: `Candela on demand 728 KiB`.
- Stopped the agent's site server by PID (`kill 2614445`). I did not use `pkill -f`, which matched my own shell in Step 9.
- Started `node tools/serve-site.mjs` from the main checkout, on http://127.0.0.1:8765/.
- Viewed `various/ui-screenshots/candela-03-B01-stride1-emulator.png`. B-01 is at 160×160; the sky table took 1.23 s and 5,520,419 instructions; the frame took 217,105,487 instructions (8,481 per pixel) in 38.0 s.

### What worked
These are the agent's measurements in Chromium:
- The emulator's instruction counts equal the Node runs exactly.
- Evaluator frames are bit-identical: 0 of 307,200 floats differ at stride 1.
- At r1, after `cfg` was applied in the page, 0 of 19,200 floats differ.
- R-01 under the `stock` policy takes 44,955 instructions per pixel, against 16,412 under `kernel`.

### What warrants a second pair of eyes
These are the agent's open issues:
- **Opening Candela as a project holds the page for about 10 s.** It is `createIRArtifact` hashing r0, which needs framework work: a Web Worker, or incremental hashing.
- **Stride 1 holds the page one row at a time, up to 0.9 s.** Splitting rows changes how spans are grouped and can change the output bits (V-03 differed in 36 of 180 compared floats). A Web Worker is the fix that keeps the bits.
- **Previews pay about 2 ms per engine call** for memory copies in `referenceRun` and `CandelaHost.call`.
- **`prettier --check`** flags `src/framework/passes/define-pass.ts` and `src/typed/candela-render.ts`.

## Step 22: the f32 RV32F backend merged: every Candela function compiles, at r0 and at the O2 head

The backend subagent finished task owi2. This compiler now lowers f32 code to RV32F: every one of Candela's 332 functions compiles at r0 and at the O2 head. The images agree with the evaluator on 100 cases per function with no disagreement, and they also agree with the reference compiler's `stock` image. I merged the branch without conflicts and repeated the integer parity checks on the merged tree; the i32 corpus is unchanged.

### Prompt Context
**User prompt (verbatim):** see Step 10 ("go go go go", design-doc 05 §4).
**Commit (code):** f4fe470 (merge). The agent's commits run from 9e96e22 to eeeaeeb; its diary is `log/06-f32-backend-agent-diary.md`, 10 steps.

### What I did
- Checked that the branch does not touch the framework or the middle end (`src/framework`, `src/typed/{passes,analyses,specialize,strategies,program,evaluate}`). It touches none of them.
- `git merge --no-ff --no-commit`: automatic, no conflicts.
- Checks on the merged tree:
  - `npx tsc`: clean.
  - Full suite: 325 tests, 322 pass, 3 skipped (the opt-in Candela tests).
  - `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`: 21 of 21.
  - `scripts/08-corpus-revisions.mjs`, diffed with the run before the framework changes: `corpus revisions IDENTICAL (44 projects)`.
  - `npm run build:site`: ok.
- Checked tasks owi2, t4dq and 9rcu with `docmgr task check`.

### What worked
These are the agent's measurements (`various/experiments/f32-backend-01-candela-images.{md,tsv,json}`), over the 32,985 cases every image finished:

| image | bytes | instructions per case | disagree |
|---|---:|---:|---:|
| ours, r0 | 183,324 | 921.0 | 0 |
| ours, O2 head | 151,748 | 870.3 | 0 |
| reference, `stock` | 312,740 | 1,598.6 | 0 |
| reference, `kernel` | 434,996 | 747.7 | 0 |

- Our O2 image has 48.5% of `stock`'s bytes and executes 54.4% of its instructions.
- Against `kernel`, it has 34.9% of the bytes and executes 116.4% of the instructions.

### What I learned
- **The gap to `kernel` is mostly inlining.** `kernel` inlines `q_floor` and `q_fract` into `noise3`: 8 calls where we make 14. Two further causes are f32 constants rebuilt at every use, and the copies inserted by licm and lvn, which are not coalesced. These match items E3 and H2 of the IRWB-002 agenda.
- **Branch relaxation was needed** only by the O2 head: `[branchRange] branch of -4512 bytes is out of range`.

### What warrants a second pair of eyes
- **fa0–fa7 are pooled in calling functions** where a liveness analysis shows them free; the design pooled them in leaves only. This applies to f values only, so integer images are unchanged.
- **The fs0–fs11 check covers only the function the host calls.**
- **Frames over 2,032 bytes are refused.** No Candela function needs one.

## Step 23: our own RV32 image as a render engine: B-01 bit-identical to the reference emulator

With the backend in place, the render engine the UI agent had listed as "needs the f32 backend" can exist. The fourth engine lowers a Candela revision with this compiler's backend and runs it on the RV32 interpreter. B-01 at stride 4 rendered from our r0 image is bit-identical to the reference compiler's `kernel` image on the emulator: 0 of 19,200 floats differ.

### What I did
- **`src/workbench/candela.ts`:**
  - `candelaArtifact(st)`: a Store as a `typed.blocks` artifact, cached per store, since hashing r0 takes seconds.
  - `imageEngine(art, label)`: `lowerToImage(art).image`, cached per artifact, run with `runImage(img, name, args, mem, { limit: 4e9, counts: false })`. Its `counts` is set to `null`, because `ImageRun.counts` is a `Uint32Array` while the `RunResult` the host expects has a `Map`.
- **`site-src/candela.js`:** engine `own` is enabled. It is labelled "our RV32 image · r0", or the project's revision when one is open.
- **`tools/candela-render.mjs`:** `--engine image`, with `--head <file>` for a saved revision.
- Exported both functions through `src/workbench/index.ts` and `site-src/wb.js`.

### What worked
- `scripts/11-candela-render-compare.mjs B-01 4 reference image`:
  `{"differentBits":0,"reference":{"steps":13601596,"ms":8061},"image":{"steps":17920579,"ms":40214}}`.
  Our r0 image takes 11,200 instructions per pixel against `kernel`'s 8,501.
- `npx tsc` is clean. `tests/workbench/candela.test.mjs` passes 7 of 7. `build:site` is ok.
- In Chromium, after a reload, the engine list shows `our RV32 image · r0` enabled. The render through the page was still running when this step was written.

### What didn't work
- **The first browser check showed the old, disabled option.** The bundle had the new label: `grep` for the plain text failed only because esbuild writes `·` as `\xB7`. The server sends `no-store`, so the page had been loaded before the rebuild; a reload showed the new list.
- **The first typecheck failed** on the `counts` type (TS2322), fixed as above.

### What warrants a second pair of eyes
- **The 40 s wall time for our image is mostly not instructions.** That run lowered r0 inside the timing, and paid the per-call `placeCall` and memory copies of `runImage`. Compare instruction counts, not milliseconds.

## Step 24: our image renders in the browser, and the page itself reports the frame identical

This step finished Step 23's browser check. In Chromium, rendering B-01 at stride 4 with "our RV32 image · r0" gives exactly the Node figures. Rendering the same scene afterwards on the reference `kernel` image, the view's own comparison row reads `identical: all 19,200 floats from our RV32 image · r0`.

### What I did
- **Playwright on http://127.0.0.1:8765/**, with the page reloaded after the build:
  1. engine `own`, stride 4, Render;
  2. engine `kernel`, Render;
  3. read the stats and comparison rows from the page text.
- Saved `various/ui-screenshots/candela-11-B01-our-image-identical.png`.

### What worked
| engine (B-01, 40×40) | sky table | frame | per pixel | render time |
|---|---:|---:|---:|---:|
| our RV32 image · r0 | 8,459,164 instructions, 0.90 s | 17,920,579 instructions | 11,200 | 5.07 s |
| reference `kernel` | 5,520,419 instructions, 0.97 s | 13,601,596 instructions | 8,501 | 9.32 s |

- The page's comparison row: `identical: all 19,200 floats from our RV32 image · r0`.
- Our image renders faster in wall time despite executing more instructions. The likely reason: `runImage` with `counts: false` does not count executions per instruction word, while `referenceRun` does. I did not measure this.

### What didn't work
- **My Playwright wait loop ran to its 600 s timeout** after the first render. It waited for a comparison row, which appears only once a second engine has rendered the same scene and stride in the page. The render itself had finished in about 5 s.

### What warrants a second pair of eyes
- **The setup time of the `own` engine at r0 includes hashing r0 into an artifact** (`candelaArtifact`), several seconds, on the main thread. The UI agent flagged the same cost for opening Candela as a project.

## Step 25: per-scene programs compiled by our backend: images 58% smaller, 5–6% fewer instructions per pixel, frames identical

This step compiled the per-scene programs of Step 19 to RV32 with our own backend and rendered from them. For B-01 and R-01:
- **Size:** the image falls from 183,324 bytes, the general r0 image, to about 77 KB.
- **Speed:** instructions per pixel fall by 6.3% and 4.9%.
- **Correctness:** both frames are bit-identical to the reference `kernel` image's.

The size gain is the large one. The speed gain is small, because this pipeline removes dispatch and runs only light cleanup. Design-doc 05 §7 planned O2+ after `dfe`, which runs next.

### Prompt Context
**User prompt (verbatim):** see Step 10. The broader goal is the user's earlier "create new projects and such that try to create sick ass optimizations from candela to rv32".

### What I did
- **`scripts/13-candela-per-scene-images.mjs`:**
  - lowers the general r0 once;
  - per scene: specialize on `K.scene`, then constprop, fold, cfg, dce, cfg and dfe, and lower the result;
  - renders at stride 4 with the reference `kernel` image, our general r0 image and our scene image;
  - compares every output float with the reference frame.
- Ran it on B-01 and R-01 → `various/experiments/07-candela-per-scene-images.{json,log}`.

### What worked
| scene | general image | scene image | instructions per pixel: ours general → ours scene | `kernel` |
|---|---:|---:|---:|---:|
| B-01 | 183,324 B | 76,244 B (−58.4%) | 11,200.4 → 10,494.4 (−6.3%) | 8,501 |
| R-01 | 183,324 B | 77,688 B (−57.6%) | 24,070.2 → 22,881.6 (−4.9%) | 15,655.9 |

`differentBits` is 0 in all four comparisons (general and scene image, each against the reference).

### What I learned
- **Specialization alone mostly saves size.** The dispatchers cost a few instructions per call, and with them gone the hot paths are unchanged.
- **The speed gap to `kernel` stays wide.** It needs the O2 passes, and beyond them inlining (agenda item E3). R-01, with more bounces and lights, shows the larger gap: 46% more instructions than `kernel` here, against 32% for B-01.

### What warrants a second pair of eyes
- **The scene images are compared at stride 4 only**, 1,600 pixels, one sample each. Step 19's evaluator runs cover all 18 scenes at stride 8.

### Next
- `scripts/13 … --o2`, running in the background:
  - after `dfe`, apply O2+;
  - check every surviving function against the post-`dfe` revision on 20 cases each;
  - lower, render and compare again.
  The entry-only contract alone is weak for internal functions, since many `cdlRenderSpan` cases hit the step limit; the per-function check closes that gap, and is valid because the assumption `K.scene = v` is part of every function's inputs.

## Step 26: all 18 scenes specialized: 185–197 of 332 functions removed per scene, every frame bit-identical

The run of Step 19's pipeline over every gallery scene finished. Each scene keeps 135–147 functions and 5,317–5,965 statements, against 332 and 12,358: a cut of 51.7–57.0%. Each scene's frame is rendered by our evaluator on its specialized program and compared with the reference `kernel` image on the emulator, every output float at stride 8. No float differs in any scene.

### What I did
- `scripts/12-candela-per-scene.mjs` over all 18 scenes (75 min) → `various/experiments/06-candela-per-scene.{json,log}`.

### What worked
| scene | K.scene | functions | statements | cut | floats compared (stride 8) | differ |
|---|---:|---:|---:|---:|---:|---:|
| B-01 | 0 | 135 | 5,317 | 57.0% | 4,800 | 0 |
| R-01 | 1 | 137 | 5,400 | 56.3% | 4,800 | 0 |
| L-03 | 2 | 136 | 5,369 | 56.6% | 4,800 | 0 |
| G-01 | 3 | 140 | 5,577 | 54.9% | 4,800 | 0 |
| E-02 | 4 | 138 | 5,533 | 55.2% | 4,800 | 0 |
| W-02 | 5 | 147 | 5,965 | 51.7% | 4,800 | 0 |
| F-01 | 6 | 137 | 5,411 | 56.2% | 4,800 | 0 |
| V-02 | 7 | 141 | 5,395 | 56.3% | 4,800 | 0 |
| G-02 | 8 | 141 | 5,539 | 55.2% | 4,800 | 0 |
| X-04 | 9 | 137 | 5,445 | 55.9% | 1,200 | 0 |
| S-02 | 10 | 140 | 5,432 | 56.0% | 1,200 | 0 |
| R-05 | 11 | 143 | 5,548 | 55.1% | 1,200 | 0 |
| V-03 | 12 | 140 | 5,410 | 56.2% | 1,200 | 0 |
| V-04 | 13 | 140 | 5,420 | 56.1% | 1,200 | 0 |
| R-08 | 14 | 143 | 5,494 | 55.5% | 1,200 | 0 |
| X-03 | 15 | 142 | 5,484 | 55.6% | 1,200 | 0 |
| R-04 | 16 | 141 | 5,427 | 56.1% | 1,200 | 0 |
| G-03 | 17 | 139 | 5,378 | 56.5% | 1,200 | 0 |

- Scenes 9–17 are 80×80 in the scene table, hence 100 pixels at stride 8.
- Every pass in every scene was accepted by the entry-only contract. The runs took 2.4–5.9 minutes each.

### What I learned
- **More is removed than the other scenes' code.** 185–197 removed functions exceed what the other 17 sections hold (163–170 functions). The rest is shared code that only other scenes reach.
- **Evaluator cost per frame varies 34-fold:** from 654,182 statements (X-04) to 22,032,217 (G-03), both for 100 pixels. The scenes differ far more in their own work than in their code size.

### What warrants a second pair of eyes
- **Stride 8 compares 1–2% of the pixels**, one sample each. B-01 has also been compared at stride 1 for the general program (Step 17), but not for the specialized one.

## Step 27: O2+ on the per-scene programs: correct, and less than 1% faster

Design-doc 05 expected the optimizing passes to find more once each dispatch had become a direct call. On B-01 and R-01, O2+ after `dfe`:
- removes about 10% of the statements;
- removes 3% of the image bytes;
- changes instructions per pixel by 0.6% and 0.1%.

All sixteen passes were accepted. The new per-function check found no disagreement, and both frames remain bit-identical. The remaining gap to `kernel` is therefore not in this compiler's existing pass list. I recorded this, with the other outcomes and the departures from the design, in design-doc 05 §9.

### What I did
- `scripts/13-candela-per-scene-images.mjs B-01 R-01 --o2` (about 25 min) → `various/experiments/08-candela-per-scene-o2.{json,log}`. After `dfe`, the script:
  - runs `p.pipeline('O2+')`;
  - compares every surviving function between the post-`dfe` revision and the O2+ head, on 20 `casesFrom` cases each with the scene assumption in the inputs, limit 2e5, verdicts by `agrees`;
  - lowers, renders at stride 4 and compares with `kernel`.
- **Design-doc 05 §9 "Outcomes":** a table per section, the four departures in §7 (binding form, assumption keys, entry-only contract, pipeline), and what the measurements imply.
- Checked task ckco; added a changelog entry with file notes.

### What worked
| scene | statements | bytes | instructions per pixel | per-function check | frame |
|---|---:|---:|---:|---|---|
| B-01 | 5,317 → 4,786 | 76,244 → 74,044 | 10,494.4 → 10,435.0 | 2,699 agree / 0 / 1 inconclusive | 0 of 19,200 differ |
| R-01 | 5,400 → 4,859 | 77,688 → 75,288 | 22,881.6 → 22,850.9 | 2,739 agree / 0 / 1 inconclusive | 0 of 19,200 differ |

O2+ took 212 s and 179 s: about a fifth of the full-program O2, matching the program's size.

### What I learned
- **The speed gap is code generation and inlining.** Against `kernel`, our per-scene O2+ image executes 23% more instructions per pixel on B-01 and 46% more on R-01. The backend agent's per-function comparison already named the causes: `noise3` makes 14 calls where `kernel` makes 8, float constants are rebuilt at every use, and copies are not coalesced.
- **The guarded clone-per-scene variant of design-doc 04 is not worth building.** The dispatch it would remove is too cheap to matter.

### What warrants a second pair of eyes
- **The per-function check compares two specialized revisions with each other**, not with r0. It is the frame comparison that ties the specialized program to the general one.
- `scripts/14-candela-call-sites.mjs` is counting single-call-site functions in the B-01 program, to support the report's claim that inlining after `dfe` is a pure gain for many functions.

## Step 28: report 4 written and checked against the evidence; a claim corrected by measuring call sites

This step wrote the milestone report R3: the fourth IR Workbench report in the vault. It covers framework performance, bcm, the f32 backend, rendering and per-scene kernels. Reading it back against the evidence found eleven sentences that said more than was measured. Ten were corrected from the diaries. For one, I made a new measurement: call sites per function in the B-01 program. It showed that `dfe` does not create single-call-site functions, as I had written, but keeps 55 of them.

### Prompt Context
**User prompt (verbatim):** see Step 10 ("diary docmgr deisgn doc vault report") and the original request ("At important milestones, write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies…)").

### What I did
- **The report.** Wrote `Projects/2026/11/24/PROJECT REPORT - IR Workbench - Per-Scene Kernels for Candela - … - A Technical Deep Dive.md`. Copied three renders to `_assets/irwb-{b01-colour,b01-normal,r01-colour}.png`.
- **`scripts/14-candela-call-sites.mjs`:** static call sites per function, in general r0 and in a scene's program after `dfe` → `various/experiments/09-candela-call-sites-B-01.json`.
- **The second reading.** Corrections:
  - "kernel" is used in four senses. A definition list now separates the per-scene kernel, the `kernel` policy and the record `K`; the framework is named as such.
  - "many megabytes" → the measured 16 MB of the saved O2 head.
  - Result leaves: the protection comes from the allocator's liveness of physical fa registers (backend diary, Step 6), not from "argument registers hold nothing".
  - Branch relaxation: the exact rewrite, and its one-word cost (backend diary, Step 7).
  - "All three are middle-end matters" → only inlining is. Constants in registers and copy coalescing belong to the backend.
  - "hit the step limit on most cases" → the five functions account for the 215 inconclusive cases of 33,200.
  - "Four engines" listed three kinds.
  - The `why` output was asserted without being checked; the report now quotes the note text.
  - "fall only by the dispatches" → "fall by 5–6%", with the mechanism.
  - "shading functions … every sample" → the measured `q_floor` and `q_fract` inlining into `noise3`.
  - "many small functions have exactly one call site after `dfe`" → the measured 55 of 131 (29 with at most 20 statements).

### What worked
- Call sites:
  - **general r0:** 220 of 332 functions are called exactly once (96 with ≤ 20 statements), and 17 non-entries are never called;
  - **B-01 after `dfe`:** 55 of 135 are called once (29 small), 76 are called twice or more, and none is uncalled.

### What didn't work
- **The first call-site run lost the scene id.** The output object had two keys named `scene`, and the second overwrote the first. The script now names the counts `sceneProgram`. The JSON was rewritten from that run's numbers, with a note saying so.

### What I learned
- **The general program has more single-call functions than a scene's** (220 against 55), because every scene section is called once by a dispatcher. For inlining, what counts is which of them stay on a scene's hot path.

### What warrants a second pair of eyes
- **The report quotes the backend agent's and the UI agent's measurements** from their diaries and reports. I re-ran only the parts that the merged tree's tests and my own scripts cover.

## Step 29: four milestones launched as tickets IRWB-003 to IRWB-006

The user chose milestones 1–4 of the plan I proposed after report 4. For each: a ticket, an intern guide uploaded to reMarkable, an implementation with commits and a detailed diary, and a textbook-style vault report. I created the four tickets in the main checkout, so that four subagents can branch from one commit with fixed ids, and launched one subagent per milestone in its own worktree.

### Prompt Context
**User prompt (verbatim):** "Do 1-4, ask subagents to always commit at appropriate intervals and keep a detailed diary as you work (using the diary format from the skill). When a milestone is finished,  write a detailed project report for the obsidian vault as a deep dive technical analysis blog post using a textbook writing style (no analogies, see skill).      
 Commit and push the bsidian vault when done (go-go-parc vault).   For each, create a ticket and design doc (if you don't have already)  Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable.


Then implement, use subagents as you like"

### What I did
- **Topics:** added `performance` and `verification` to the vocabulary.
- **Tickets:**
  - **IRWB-003:** the speed gap. Inlining, copy coalescing, float constants in registers, loop rotation.
  - **IRWB-004:** cheap experiments. Cached origin outcomes, functions as the unit of change, workers, and a worker for the workbench.
  - **IRWB-005:** gate strength. A mutation score for the meaning contract, and stronger case generation.
  - **IRWB-006:** rewrite rules as verified data, and a single-assignment view of `typed.blocks`.
- **One subagent per ticket**, with `isolation: worktree`. Every brief carries:
  - the standing constraints: no downloaded code, no flashing, no code push, Co-Authored-By;
  - the freeze: O2, default backend options and the book's numbers keep every corpus revision identical, and new behaviour goes into new pipelines or options;
  - resource limits for four parallel agents on 8 cores and 62 GB;
  - the diary cadence;
  - the guide, the reMarkable upload, and a vault report written but not committed (I review and push).

### Why
- **The vault push stays with me.** Four agents committing to one vault at once would race on its index, and report 4 needed eleven corrections after a reading against the evidence.
- **New code in new files where possible.** IRWB-003 and IRWB-006 both add passes, and IRWB-004 and IRWB-005 both touch `evaluate.ts`. Keeping edits to shared files at the level of registration lines keeps the merges small.

### What warrants a second pair of eyes
- **Parallel Candela runs.** IRWB-003 and IRWB-004 both need them. The briefs limit each agent to one Candela-scale process at a time, with a 12 GB heap.

## Step 30: IRWB-006 merged (rules as verified data, SSA view); report 5 corrected and pushed

The first of the four milestone agents finished. IRWB-006 turned `simplify` (27 rules) and `fold` (40 rules) into rule tables, with identical revisions on the corpus and on Candela. It recorded verification evidence per rule, added an SSA view that agrees with reaching definitions everywhere, and added a first sparse consumer, `sccp`. I merged the branch, re-ran every gate on the merged tree, corrected four claims in its vault report, and committed and pushed the vault.

### Prompt Context
**User prompt (verbatim):** see Step 29.

### What I did
- Checked the branch's scope. Outside its ticket it touches `src/typed/passes.ts` (imports and two bodies), `src/workbench/workbench.ts` (`wb.rules()`), and new files under `src/typed/rules/`, `src/typed/ssa.ts`, `src/typed/sccp.ts` and the tests.
- `git merge --no-ff --no-commit`: automatic. Gates on the merged tree:
  - `npx tsc`: clean;
  - tests: 340, 337 pass, 3 skipped;
  - `IRWB_FULL`: 21/21;
  - parity: 6,986/6,986;
  - `scripts/08`: `corpus revisions IDENTICAL (44 projects)`;
  - `build:site`: ok.

  Merge commit `4fb1bba`.
- Relayed to the IRWB-005 agent the finding that `F32_EDGES` holds only the canonical NaN, so `x + (−0) → x` survives the meaning check.
- **Reviewed report 5 against the code and the diaries:**
  - **Wrong claim, in three places.** It said the parity tool's 6,986 cases "agree with the reference compiler". `tools/parity.mjs` checks each project's O2 head against its own r0 through `meaningKept`. Fixed, and the evaluator's oracle evidence is restated as Candela's 32,985 of 33,200 decided cases against the reference images.
  - **"Typed, a typed subset of JavaScript"** is inaccurate (`distinct`, `match`, records). It now reads "a small statically typed language with TypeScript-like syntax".
  - **Confirmed:** sixteen rewriting returns in the hand-written `simplify` (`grep -c "return "` on `simplifyBody`). Confirmed the float-rewrite history against IRWB-001's `log/04` step 5: two of the four were caught only at 400 cases before the edge sweep. The report-1 link names an existing note.
- Vault commit `3f39568`, pushed. Staged only the report and `irwb006-{evidence-strength,ssa-candela,sccp-constants}.png`.
- `remarquee cloud ls /ai/2026/11/25/IRWB-006` lists the guide.

### What I learned
- **`sccp` makes 31 reads constant against `constprop`'s 28.** `O2-sccp` brings the `constants` project from 70 to 40 instructions in one run. Over the corpus the gain is small (278,296 → 278,266 instructions), because `constprop` already finds nearly everything there.
- **Candela found a bug the corpus could not.** Two locals named `z` in `asinPositive` collided in the SSA names.

### Open (from the agent)
- **Registering `sccp` and `O2-sccp`** in the shared lists after the IRWB-003 merge; then re-run `IRWB_FULL=1 node --test tests/typed/rules.test.mjs`.
- **A pruned SSA variant.** 2,840 of Candela's 4,245 phis are dead.

## Step 31: IRWB-004 merged (cheap experiments); report 6 pushed; the two running agents briefed on the API changes

The cheap-experiments agent finished with every revision hash unchanged:
- **Speed:** full O2 on Candela 12:06 → 3:27 (base measured by the agent); `cfg` 51/41 s → 13.6 s; a per-scene run 312 s → 119 s.
- **The contract:** verdicts replayed from a memo, and 1.95× on four warm worker threads.
- **The browser:** renders on a Web Worker, with frames bit-identical.

Two targets were missed, and the agent reported both with profiles:
- **The first no-change pass** takes 4.3 s, against the 1 s target. It is 0.66 s once `ranges` has been solved.
- **Opening Candela and running a pass in the browser** are still single main-thread tasks: 8.6 s and 21.3 s, down from about 10 s and about 45 s.

### Prompt Context
**User prompt (verbatim):** see Step 29.

### What I did
- **Scope check.** Changes span `src/framework/**` (owned by this milestone), `src/typed/{evaluate,ir,model,passes}.ts`, new `src/typed/{parts,meaning-exec}.ts` and `src/typed/parallel/*`, the site (`engine-worker.js`, `index.html`, `candela.js`, `wb.js`) and `tools/{build-site,serve-site}.mjs`.
- **Merge.** `git merge --no-ff --no-commit` → `CONFLICT (content): Merge conflict in src/typed/passes.ts`, the import lines only. IRWB-006 had dropped `F32_FOLDABLE` and `f32Op`, and IRWB-004 had added `entityIdSet`; I kept both changes.
- **Gates on the combined tree:**
  - `tsc`: clean;
  - tests: 350, 347 pass, 3 skipped;
  - `IRWB_FULL` passes and backend: 21/21;
  - `IRWB_FULL` rules and SSA tests: 15/15 (IRWB-006's code on IRWB-004's frozen-record `storeOf`);
  - parity: 6,986/6,986;
  - `scripts/08`: identical on 44 projects;
  - `build:site`: ok ("Candela on demand 1448 KiB", up from 728 KiB with the worker bundle).
- Merge commit `1f45c94`.
- Restarted the site server on port 8765 by PID. It now sends the CSP header with `worker-src 'self'`.
- **Messaged the IRWB-003 and IRWB-005 agents** with the API changes and asked them to merge the integration branch before their final gates. The changes: `storeOf` returns frozen records; the meaning check is async (`decide`); the evaluator reuses its buffers; the memo exports.
- **Report 6.** Read in full. Changed the alias to "report 6", and added a sentence reconciling its base O2 time (12:06) with report 4's 19 minutes (a different machine load). Vault commit `8223464`, pushed, with the report and `irwb004-{browser-worker-render,contract-threads,o2-per-pass}.png` only.
- `remarquee cloud ls /ai/2026/11/25/IRWB-004` lists the guide.

### What didn't work
- **My first merge commit failed** ("Committing is not possible because you have unmerged files"): I had resolved the conflict but not staged it. Staged and committed.
- **I gave the agents a made-up integration hash.** My first message to them said "head 3c3f2a4 or later", written before the merge commit existed. I sent both a correction naming `1f45c94`.
- **The site server's first health check returned 000.** The server had not finished starting; the second check returned 200.

### What I learned
- **The garbage-collector finding is the largest single effect in this milestone.** Every evaluation allocated a 64 KiB stack area, which triggered full marks of the main thread's 464 MB heap. The calling thread's contract went from 46.7 s to 9.1 s with one reused buffer.

### What warrants a second pair of eyes
- **Report 6 links to IRWB-005's report by title.** That report is still a draft in the vault; check the link when it is pushed.
- **The worker script's SHA-384 is recorded but not enforced.** Browsers do not check SRI on worker scripts. It is a same-origin build output, like `app.js`.

## Step 32: the machine stopped at 01:39; no OOM kill was logged; Candela jobs now run under a memory cap

The session ended while two agents were still running: IRWB-003 (speed gap) and IRWB-005 (gate strength). The machine was rebooted. The user's question: "i think we might have crashed, probably due to memory (I don't know if we were doing lots of calls or so)?" The logs do not establish the cause. They do show what was running, so I added a guard that turns a runaway job into a killed process instead of a frozen machine, and resumed both agents.

### Prompt Context
**User prompt (verbatim):** "i think we might have crashed, probably due to memory (I don't know if we were doing lots of calls or so)?"

### What I did
- `uptime`: up 20 min. `journalctl --list-boots`:
  - the previous boot ran from 2026-11-19 11:00:45 to 2026-11-26 01:39:07;
  - this boot started 09:14:46.
- **The previous boot's log** (`journalctl -b -1`):
  - no OOM-killer, memory-pressure, hung-task or soft-lockup entries between 00:30 and 01:40;
  - its last lines are routine cron and php session cleanup at 01:39;
  - no shutdown sequence follows them.
- **Swap:** `/swap.img`, 8 GB, swappiness 60; 0 B used now.
- **What was running**, from file times in the worktrees:
  - IRWB-003: last commit 01:18; `various/11-candela-scenes-speed.log` last written 01:29, during the per-scene speed pipeline (B-01: inlining to 44 functions and 8,390 statements).
  - IRWB-005: last commit 01:36; `various/13-candela.jsonl` (683,603 bytes) last written 01:36, during Candela mutants of `skyL_wgsl`, a function whose measurement took 2,649 s.
- **The guard, tested:**
  - `systemd-run --user --scope --quiet -p MemoryMax=200M -p MemorySwapMax=0 node -e "<allocate 800 MB>"` → exit 137, killed, nothing else affected;
  - a small job under the same cap → exit 0.
- **Resumed both agents** with the facts, their worktree state and a mandatory rule: every Candela-scale node process runs under `MemoryMax=14G`, `MemorySwapMax=0`, `--max-old-space-size=10240`, with at most 2 worker threads. On exit 137 they reduce what the process holds rather than raise the cap.
- Restarted the site server on port 8765.

### What I learned
- **The evidence fits a freeze, but not a specific cause.** An abrupt end of the log without any kernel message is consistent with a machine that stopped responding, for example while thrashing swap. Memory pressure that keeps the kernel reclaiming need not reach the OOM killer, so the absence of an OOM entry does not rule memory out. Nor does anything confirm it.
- **The cap's value is the same whichever way it was.** A capped process is killed at 14 GB, and two capped jobs cannot together exceed 28 GB of the 62 GB.

### What warrants a second pair of eyes
- **The caps cover only the agents' Candela jobs.** Chromium under Playwright and the Claude processes themselves are not capped.
- **A system-wide guard would cover everything.** An OOM daemon such as earlyoom or systemd-oomd would also catch uncapped processes. That is a change to the user's system configuration and needs the user's decision.

## Step 33: five research tickets (IRWB-007 to IRWB-011), their intern guides delegated

The user asked for a ticket per research direction from my recommendation, each with an intern guide stored in the ticket and uploaded to reMarkable. Numbers 4 and 5 are "sketch tickets", recorded so that the ideas are not lost. Nothing is implemented in this round.

### Prompt Context
**User prompt (verbatim):** "ok, create ticket for each of: [the pasted list of five directions and two smaller items] You can make "sketch tickets" for 4 and 5, i just don't want to lose the idea. For each, Create  a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."

### What I did
- **Topic:** added `research` to the vocabulary.
- **Tickets** (created under `ttmp/2026/11/26/`):
  - **IRWB-007:** specializing Candela on its scene data (partial evaluation over constant memory).
  - **IRWB-008:** exact checking for edits that cite verified rules, and version 2 of the check as the standard for new pipelines.
  - **IRWB-009:** a function-incremental framework (analyses per function part, a lazy projection, a persistent store, demand-driven queries).
  - **IRWB-010 (sketch):** rewrite search on SSA and verified rules.
  - **IRWB-011 (sketch):** image-level contracts for float freedom.
- **The two smaller items** became IRWB-001 tasks:
  - backend: register allocation and loop unrolling;
  - hardware: a user-run device check of instructions per pixel against real time.
- **Four writing subagents**, each in its own worktree:
  - IRWB-007;
  - IRWB-008;
  - IRWB-009;
  - IRWB-010 and IRWB-011 together, because they share rules, the verifier, float semantics and contracts.

  Each writes a diary, commits its scripts, uploads to `/ai/2026/11/26/<ticket>`, and stops after the upload.

### Why
- **The guides also carry the research framing** I gave the user: hypotheses, related work, what would falsify each idea. Examples are the first Futamura projection for IRWB-007, Alive2 and proof-producing e-graphs for IRWB-008 and IRWB-010, salsa-style early cutoff for IRWB-009, and calibrated miss probabilities as future work in IRWB-008.
- **No Candela-scale runs beyond small grounding measurements**, under the memory cap from Step 32. IRWB-003 and IRWB-005 are still running theirs.

## Step 34: IRWB-005 merged (gate strength); report 7 pushed; a generator defect that weakens earlier Candela checks

The gate-strength agent finished, and the default contract is unchanged.
- **Corpus:** of 1,144 mutants, 192 are equivalent or presumed equivalent. The default gate kills 909 of the other 952: 83.1%..95.5%. Of the 43 it accepts, 33 diverge where the original terminates.
- **Version 2** (boundary cases, records by offset, a divergence rule; opt-in) accepts 5, at about twice the cost.
- **Candela subset:** 3,931 mutants, killed 87.4%..96.8%. The survivors are float code that matters only in small regions of the input space; there, more random cases help more than boundary cases.

I merged the branch, ran every gate, corrected the report's summary and pushed it.

### Prompt Context
**User prompts (verbatim):** see Step 29. Later, on reports: "when a milestone is done, write a detailed project report …"; "(ask the agent to do so i guess, because they have the full context or so)"; "oh , yeah for 007-011 report only after implementing"; "you should write a combined one as well, when done".

### What I did
- **Scope.** Outside its ticket the branch touches new files (`src/typed/{mutate,cases-strong,facts-check}.ts`, `tools/mutation-*.mjs`, two tests) and adds the `observe` hook to `src/typed/evaluate.ts`.
- **Merge.** `git merge --no-ff --no-commit`: automatic, no conflicts. Gates:
  - `tsc`: clean;
  - tests: 362, 359 pass, 3 skipped;
  - `IRWB_FULL`: 21/21;
  - rules and SSA: 15/15;
  - parity: 6,986/6,986;
  - `build:site`: ok.

  Merge commit `d25f9f9`.
- **The revision baseline was gone.** `scratchpad/revs-new.txt` had been deleted with the reboot (the scratchpad is cleared). I compared instead with the committed baselines: IRWB-006's `various/01-baseline-corpus-revisions.txt` and IRWB-004's `various/01-corpus-revisions-baseline.txt` are IDENTICAL, as are IRWB-005's `various/baseline/corpus-revisions.txt` project lines (that file has 4 extra lines). I recreated the scratchpad baseline from the merged output.
- Sent the IRWB-008 guide agent the final numbers (95.5%, not the 95.8% of the earlier commit messages) and the five undecided recommendations.
- **Report 7:**
  - the alias becomes "report 7";
  - the summary now gives both ends of the interval for the corpus (83.1%..95.5%) and for Candela (87.4%..96.8%, with the lower end the safer figure, as the agent's own report says); it had given only the upper ends;
  - added a Related notes section linking reports 4, 5 and 6.

  Vault commit `22b8602`, pushed, with the report and four `irwb005-*` figures only. `remarquee cloud ls /ai/2026/11/25/IRWB-005` lists the guide.

### What I learned
- **A defect in the frozen default generator weakens my own earlier Candela checks.** `makeValue` writes a record's words in the key order of the record's field table, not by offset. Cases are generated from the origin artifact, whose keys are sorted, so Candela's `K` is laid out in alphabetical field order: the word at offset 28, `K.scene`, receives the random bits of `gBary__y`. This affects 168 of 332 functions; the corpus is unaffected.
- **What that means for Steps 18–28:** every check through `meaningKept` on Candela, including the entry-only contract of the per-scene kernels, ran on `K` values no real call produces. Even the scene assumption `oneOf: [v]` was written to the wrong offset.
  - Agreement on those cases is still agreement, so nothing accepted becomes wrong.
  - The evidence that ties a per-scene program to real scenes is the frame comparison, which runs the real host protocol and is unaffected (Steps 19, 25, 26, 27).
- **The fix is one line** (sort the field table by offset). It changes no corpus decision, but it changes the default contract's key, so it is the user's decision. The agent lists it first among five recommendations.

### What warrants a second pair of eyes
- **Earlier reports state per-scene checks as "accepted by the entry-only contract".** That is literally true but weaker than it reads. Report 7 §12.3 now records the defect, and report 4 is linked from it.

## Step 35: IRWB-009 guide merged (function-incremental framework)

The first of the four research-guide agents finished. Its guide is about 1,000 lines. It is uploaded to `/ai/2026/11/26/IRWB-009`, which the agent verified with `remarquee cloud ls`. No vault report was written, as the user asked; that comes after implementation.

### What I did
- Checked the branch's scope: ticket files only (0 paths outside `ttmp/2026/11/26/IRWB-009…`; 23 files).
- Merged it as `06fc699`, a ticket-only merge, so no gates were needed.

### What I learned (the agent's measurements, `various/01`–`06`)
- **The analyses split exactly by function.** After `cfg`, 222 of 222 unchanged parts give equal results for all three dataflow analyses, and none of the six analyses crosses a call. `tracePath` takes 701 of 1,056 ms of the range solve; the median function takes 0.16 ms.
- **Building and checking the projection is the cold cost, not sorting it.** `createIRArtifact` takes 6.4 s with every record new and 1.0 s with every record shared. Sorting the 132,054 relations takes 24–30 ms.
- **Correspondence dominates small passes.** The last `cfg` of O2 changes 2 functions and 4 records but takes 6.3–8.4 s, mostly in `makeCorrespondence` (93,138 entries).
- **Source positions defeat per-function reuse.** A comment edit changes 154 parts, because front-end ops store absolute source positions. A code hash without ops and positions changes 0.
- **The memo is keyed on the whole origin.** Any source edit recomputes all 13,280 baseline outcomes.
- **Facts on demand:** `strength` needs the range facts of 1 function out of 332: 76 ms against 3,292 ms to solve all of them.
