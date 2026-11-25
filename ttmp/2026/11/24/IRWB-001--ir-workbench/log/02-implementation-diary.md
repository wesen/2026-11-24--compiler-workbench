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
