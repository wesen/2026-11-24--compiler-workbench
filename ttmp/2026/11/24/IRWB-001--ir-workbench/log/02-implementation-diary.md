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
