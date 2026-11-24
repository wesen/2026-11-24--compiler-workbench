---
Title: IR Workbench v6 import analysis
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/README.md
      Note: v6 overview, module map and build/verify commands
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/docs/v6-user-guide.md
      Note: The v6 user guide (identical to the imported ~/Downloads/ir-workbench-v6-user-guide.md)
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/output/v6-verification.json
      Note: Recorded (unreproduced) release verification ledger
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/core/types.ts
      Note: 'Shared runtime protocol: Task, Artifact, Pass, PassContext, PassPolicy'
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir-examples/lab.ts
      Note: Composition root wiring strategy, contracts and IR edits for the four v6 labs
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir/types.ts
      Note: 'Generic IR manipulation types: IRAdapter, IREntity/IRRelation, capabilities'
    - Path: ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/01-verify-manifest.py
      Note: Checks every archived file against WORKSPACE-MANIFEST.json (bytes + SHA-256)
    - Path: ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/02-run-verification.sh
      Note: Re-runs typecheck, tests, rebuild in a fresh extract (not yet run; see Verification)
ExternalSources:
    - local:ir-source-workbench-v6-complete.zip
    - local:ir-workbench-v6-user-guide.md
Summary: 'What the imported IR Workbench v6 archive and user guide contain: a ~1 MB TypeScript compiler framework with four layers (incremental runtime, Strategy IR, semantic contracts, generic IR manipulation), four v6 domain labs and an offline browser workbench; plus integrity checks, maturity observations and open questions for this ticket.'
LastUpdated: 2026-11-24T18:40:00-05:00
WhatFor: Orientation before designing or building the IR workbench in this repository.
WhenToUse: Read first when deciding what to reuse, port or redesign from the v6 prototype.
---

# IR Workbench v6 import analysis

## TL;DR

The two source files are one release of the same project:

- **`ir-source-workbench-v6-complete.zip`** (34 MB zipped, 210 MB / 972 files unpacked) is a complete TypeScript workspace for **IR Workbench 0.6.0**. It contains source, compiled `dist/`, Linux `node_modules`, 31 test files, build and report scripts, generated evidence, PDFs and a standalone 11.7 MB offline HTML workbench.
- **`ir-workbench-v6-user-guide.md`** (1,896 lines, about 19.4k words, 11 chapters) is the user and developer manual for that release. It is byte-for-byte identical to `docs/v6-user-guide.md` inside the archive.

**What is in this ticket.** `sources/ir-source-workbench-v6/` holds the relevant subset of the archive, 200 files and 2.8 MB: `src/`, `docs/` (including the guide), `tests/`, `scripts/`, config, and the small v6 verification records. Every file matches the release manifest. `node_modules/`, `dist/` and about 143 MB of generated `output/` were left out because they can be regenerated. See `sources/README.md` for the full list. Paths below are relative to that directory unless stated otherwise.

IR Workbench is a **research framework for building reusable, inspectable compilers whose IRs are not source code**: CAD sketches → residual equations → meshes, game scenes, mechanisms, expressions and constraint systems. It splits a compiler into four independent layers and records evidence for every decision. A browser "compiler debugger" lets you follow a transformation from source, through strategy, pass invocation, cache decision and semantic check, down to individual entities in exact IR revisions.

The domain examples are deliberately small: bounded integer polynomials, translated boxes, convex planar triangle fans and uniquely solvable linear systems. The value of the project is the **architecture, vocabulary and evidence discipline**, not the domain algorithms.

## 1. Provenance and version history

The archive carries its own version history. Older READMEs are kept under `docs/`, and every release left evidence under `output/`:

| Version | What it added (per its README) |
| --- | --- |
| 0.1 "legacy" (`docs/README-legacy.md`) | Parameter-driven observable pipelines for CAD geometry, game assets, planar mechanisms and an animated door. Workbench at `output/index.html`. "jig supplied conceptual motivation only." |
| 0.2 / v3 (`docs/README-v3.md`) | **Source-first.** Authored programs became real executable TypeScript modules (`src/programs/`), and the offline HTML embeds the TypeScript transpiler so you can edit and recompile in the browser. |
| v4 (`docs/README-v4.md`) | **Strategy IR.** Compilation plans became serializable, editable data built from 13 control operators. Added a mesh-cleanup lab. |
| v5 (`README-v5.md`) | **Semantic pass contracts.** Typed ports, properties, invariants, effects and transactional acceptance were added, along with a contracts panel in the workbench. |
| v6 (`README.md`, 0.6.0) | **Generic IR manipulation.** Adds adapters, exact-revision queries, declarative patterns, 7 rewrite schedules, edit transactions, diffs and many-to-many correspondence. Four new native-IR labs. |

Signs that the project was **AI-generated, by a multi-agent build**:

- `IMPLEMENTATION.md` assigns ownership to a "root" agent and to Geometry/CAD, Physics and Game/workbench agents ("do not overwrite colleagues' files").
- The guide speaks of "the earlier implementation report attached to the conversation."
- It mentions an "authoring environment" in which browser automation was blocked.

All file timestamps fall on 2026-11-24, between 14:33 and 16:49. Expect the strengths and weaknesses of that origin: unusually careful wording about scope, and code that has never been run in a browser (see §7).

## 2. Architecture: four cooperating layers

| Layer | Directory | Main question | Main interface |
| --- | --- | --- | --- |
| Incremental runtime | `src/core/` | What was requested, computed, reused or rejected, and why? | `Compiler`, `Pass`, `Task`, `Artifact`, `PassContext`, `PassPolicy`, `Queries` |
| Strategy IR | `src/strategy/` | Which work runs, in what order, with which alternatives? | Serializable `StrategyPlan` + versioned `AlgorithmRegistry` |
| Semantic contracts | `src/contracts/` | What must be true before a result is accepted? | 8 `define*` APIs, `AnalysisManager`, `ContractRegistry` |
| IR manipulation | `src/ir/` | How does an algorithm inspect and edit *this* representation? | `IRAdapter<T>`, `IRView`, patterns, rewrite schedules, `Edit` transactions, `diff`, correspondence |

The layers depend on each other in one direction only. The runtime imports none of the other three. `src/ir/` imports only the core data protocol. `src/contracts/` needs typed artifacts and a resource port. Strategy needs only registered algorithms. **Composition roots** wire the layers together explicitly:

- `src/pipelines/project.ts` does this for the original CAD, scene and mechanism examples.
- `src/ir-examples/lab.ts` does it for the v6 labs.

There is no plugin system, global state or third-party runtime dependency.

### 2.1 Core ideas worth keeping regardless of implementation

1. **Artifact identity has several parts.** Each artifact carries a logical `id`, a `kind` with a `schemaVersion`, a `contentHash` and a `revision`. An entity reference is `{artifact, revision, entity}`. Saying "`column-a`" is ambiguous until you say which artifact and which revision it belongs to.
2. **The graphs are kept separate.** The task execution graph records who requested what, including failed requests. The value dependency graph records which exact inputs justify an output. Each IR has its own entity and relation structure. Provenance and correspondence link entities across revisions. The strategy plan and its execution trace are a fifth graph. "A containment edge does not prove a computational dependency; a provenance link does not prove equivalence."
3. **Three kinds of program are kept separate.** The *object program* is the domain model. The *compilation strategy* is the plan. The *algorithm implementation* is a versioned callback. Changing one of them produces different identities and different evidence.
4. **Cache reuse and acceptance are separate decisions.** A cached computation can be reused, but semantic policies (`PassPolicy.after` / `committed`) still run on every invocation. "Cached computation is not current authorization."
5. **Assurance has explicit levels.** *Declared*, *checked*, *transferred* and *externally proved* are distinct labels. Listing a property in `preserves` proves nothing until a checker has run.
6. **Failures are evidence.** Failed requests, rejections caught by guards, exhausted budgets and detected cycles are all recorded and shown. None of them counts as success.

### 2.2 Incremental runtime (`src/core/`, ~950 lines)

Passes are `{id, version, kind, run(ctx, params)}` and must return JSON-serializable IR values. All inputs arrive through `ctx.read(key)` (the run's input snapshot) and `ctx.require(task)` (another task, with its exact artifact revision recorded). Passes report what they did through `ctx.decision`, `ctx.diagnostic`, `ctx.metric`, `ctx.checkpoint` and `ctx.derive` (entity correspondence). A pass version string explicitly invalidates its cache. `Queries` (`src/core/query.ts`) answers *why*, *dependencies*, *alternatives* and *cache* questions over a compiler snapshot.

### 2.3 Strategy IR (`src/strategy/`, ~590 lines)

A plan is frozen, finite data (`formatVersion: 1`) that refers to algorithms by `{id, version}`. Algorithms come in six kinds: `transform`, `analysis`, `predicate`, `selector`, `invariant` and `metrics`. There are 13 operators:

`apply`, `sequence`, `parallel`, `fork`, `chooseBest`, `conditional`, `attempt`, `repeatUntilStable`, `forEach`, `require`, `verify`, `checkpoint`, `scope`.

The layer also provides value references (`ref`, `binding`, `literal`), validation, structural plan editing, YAML/JSON serialization and an interpreter with budgets and failure classification. Example: the mesh lab's plan is `sequence(read, chooseBest(fork(original, reduced), min triangles, error <= tolerance), checkpoint)`.

### 2.4 Semantic contracts (`src/contracts/`, ~1,700 lines; `analysis-manager.ts` alone is 60 KB)

The layer has eight definition APIs: `defineIR`, `defineType`, `defineAnalysis`, `defineProperty`, `defineInvariant`, `defineObjective`, `defineEffect` and `defineTransformation`. A transformation declares typed named ports and these clauses:

| Clause | Meaning |
| --- | --- |
| `requires` | Input eligibility, checked when the transaction begins |
| `ensures` | Output or input/output relations, checked before acceptance |
| `establishes` | A new guarantee, checked and recorded with its own evidence |
| `preserves` | A property that must survive, either rechecked (`mode: 'check'`) or carried over by a versioned transfer verifier (`mode: 'transfer'`) |
| `correspondence` | Required entity mappings between exact revisions |
| `effects` | Resource access the transformation is allowed to make |
| `cache` | Body reuse policy: `pure`, `tracked` or `never` |

`AnalysisManager` caches analysis results and facts for a session, tracks invalidation epochs and stages writes atomically.

### 2.5 Generic IR manipulation (`src/ir/`, ~2,700 lines)

- **Adapter (`IRAdapter<T>`).** Native storage stays native. The adapter projects it into a logical graph (`IREntity`, `IRRelation`, roots) and, if the representation is rewritable, translates an edited projection back with `rebuild`. Projection or rebuild errors fail loudly. Capabilities are `Traversable`, `Queryable` and `Diffable` for every adapter, plus optional `Verifiable`, `Rewritable`, `Serializable`, `Visualizable` and `Operations`.
- **Relation categories.** Every relation is one of `containment`, `dependency`, `binding`, `adjacency` or `provenance`, so queries can choose which kind of edge to follow.
- **`IRView` (read side).** `ref`, `resolve`, `relations`, `walk` (pre-order, post-order or breadth-first; safe on cycles), `children`, `parents`, `successors`, `predecessors`, `ancestors`, `dependencies`, `subgraph` and `find`. Every query has a budget. Running out of budget is an error, never a silently truncated answer.
- **Patterns.** `pattern`, `op`, `capture`, `sameAs`, `entity`, `distinct`, `equalContent`, `relation` and `where(predicate@version)`. Domain-specific conditions come from a versioned `PatternPredicateRegistry`. `explainMatch` produces match evidence.
- **Rewrite schedules.** `applyOnce`, `applyAll`, `topDown`, `bottomUp`, `innermost`, `outermost` and `saturate`. Each takes budgets and cycle detection, and each result is reported as `converged`, `budget` or `cycle`.
- **Transactions.** `view.beginEdit()` returns an `Edit` you can `update`, `insert`, `remove`, `connect`, `disconnect`, `redirect` and finally `commit({verify})`. Stale heads and ABA cases (the head changed and then returned to the same content) are rejected. An async callback cannot publish over a newer head.
- **Diff and correspondence.** `diff` produces entity and relation change sets. `makeCorrespondence` / `composeCorrespondence` record many-to-many lineage across revisions: merge, split, create and delete.

## 3. Domain examples

### 3.1 The four v6 IR labs (`src/ir-examples/`)

Each lab keeps its own native format. The generic layer supplies matching, editing and lineage; the domain module supplies meaning.

| Lab | Native format | Transformation | Semantic check | Default result |
| --- | --- | --- | --- | --- |
| Symbolic expressions | Keyed operation arena `{root, nodes}` | CSE (merge equal `x*x`), then `a+a → 2*a` via `sameAs` | Canonical polynomial with exact `BigInt` coefficients, bounded degree, terms and work | 3 accepted edits; `2x² + 2y`, which is 26 at `x=3, y=4` |
| Scene sharing | `assets` + `objects` tables | Merge duplicate definitions, redirect `uses` bindings | Instances keep their placements and resolved shapes | Fewer definitions, instance bindings unchanged |
| Mesh alternatives | Packed `[id,x,y,z]` points, triangle table, ordered boundary | `fork` original fan vs. halved fan; `chooseBest` minimizes triangles subject to contour error ≤ the user's bound | Strictly convex planar fan (global half-plane test), retained coordinates, contour error bound | Bound 0.35 gives 4 triangles (error 0.2929); bound 0.10 gives 8 triangles (error 0) |
| Constraint systems | Variables, sparse coefficient rows, rhs, solver selector | Remove a scaled duplicate equation (registered predicate), switch the solver from `dense` to `components` | Row-space comparison, dense vs. component solutions, residuals against the original equations | 5 → 4 equations; components `{u,v}`, `{x,y}`; solution `u=4, v=2, x=3, y=1` |

### 3.2 The original authored-model examples (`src/programs/`, `src/pipelines/`)

- **CAD bracket** (`bracket.ts`): profile constraints → residual DAG → numeric tape → solved profile → feature history → analytic bracket → tessellation → mesh checks. The default is 334 vertices and 672 triangles in one watertight component.
- **Game building** (`building.ts`): authored loops create named occurrences of reusable definitions. With `floors = 2 → 3`, occurrences go from 70 to 103. Includes a cylinder-ring LOD reduction.
- **Four-bar linkage** (`linkage.ts`): bodies, ports, joints and drive → residuals → numeric tape. Numerical and closed-form motion candidates are compared.
- **Mechanical door** (`door.ts`): imports the bracket and the linkage, and attaches scene occurrences to mechanism body poses. It is a cross-domain composition example.
- **Pavilion** (`pavilion.ts`): a further scene program used in the contract experiments.
- Earlier labs: `src/contract-examples/` (semantic contracts) and `src/strategy-examples/cleanup.ts` (mesh cleanup, 11 → 8 vertices).

## 4. The workbench UI

`output/source-workbench.html` (11.7 MB) is one self-contained offline page. It embeds:

- the compiled compiler and labs
- the full TypeScript compiler (`typescript.js`), so browser-side edits of the authored programs can be transpiled in a Web Worker
- a source catalog of every source file
- the UI

Its CSP blocks all network connections (`connect-src 'none'`). Main views:

- **IR manipulation lab** (default): domain picker, a compact transformation sidebar, and tabs for **Entities**, **Query**, **Pattern & match** (editable YAML patterns), **Changes & origin**, **Native IR** and **Implementation**.
- **Entity lineage**: forward and inverse tracing across exact revisions. Mesh alternatives stay separate branches.
- **Compiler passes**: invocations, cache reasons, observations, provenance, pass source and a contracts panel.
- **Strategy trace**: planned nodes, dynamic executions, candidate metrics and selection evidence.
- **Edit native input** (YAML) for the v6 labs, and an editable TypeScript source evaluator for the five authored models. Runs are kept in immutable in-memory history and can be exported as YAML.
- **Run twice for cache**: shows warm reuse while semantic checks still run fresh.

UI code lives in `src/workbench/` (v1–v5 shell, views and contracts panel) and `src/source-workbench/` (v6 lab panel, IR inspector, lineage, strategy panel, YAML editor and worker). The UI is plain DOM, with no framework.

## 5. Repository map and size

| Module | Lines | Bytes | Notes |
| --- | ---: | ---: | --- |
| `core` | 949 | 53 KB | runtime, query, records, data utils |
| `strategy` | 590 | 56 KB | builders, interpreter, validation, editing, serialization |
| `contracts` | 1,720 | 89 KB | `analysis-manager.ts` is 60 KB |
| `ir` | 2,681 | 135 KB | patterns and rewrites are about 30 KB each |
| `ir-examples` | 1,759 | 90 KB | four labs, rules, contracts, `lab.ts` composition |
| `workbench` + `source-workbench` | 1,929 | 267 KB | UI; several files are written as very long lines |
| `pipelines`, `programs`, `languages`, `math`, `geometry`, `domains`, `scene`, etc. | ~3,400 | ~250 KB | original domain stack |
| `guide` | 703 | 28 KB | five executable tutorials |
| **Total `src/`** | **14,730** | **~1.0 MB** | |

Line counts understate the code. Average line length is about 70 characters, but several files are close to minified: `workbench/ui.ts` is 175 lines and 33 KB, `workbench/styles.ts` has lines of 8,000+ characters, and `strategy/builders.ts` averages 142 characters per line. Tests (`tests/*.test.mjs`, 31 files, 371 tests per the release log) import **compiled `dist/`**, not `src/`. The build is strict `tsc` (`strict: true`, `verbatimModuleSyntax`) plus esbuild for the browser bundles.

Large generated evidence ships in the archive: `output/source-experiments/trace.json` is 50 MB, `output/strategy-experiments/compiler-trace.json` is 46 MB, and contract experiment traces are about 2 MB each.

## 6. The user guide

The guide is the main way into the project. It is unusually precise and covers:

1. Purpose and architecture
2. A ten-minute quick start
3. Four lab walkthroughs with concrete numbers, plus how they relate to the CAD, game and linkage examples
4. The IR manipulation API (adapter callbacks, view and navigation tables, patterns, transactions, schedules, diff and correspondence)
5. Strategy programming (the 13 operators, references and scopes, validation and editing, budgets)
6. Semantic contracts (the 8 APIs, clauses, evidence and invalidation, effects, coordination with IR publication)
7. Runtime execution, caches and explanations (runtime and query API reference)
8. A workbench manual
9. How to add a representation and build your own compiler
10. A reference map, a troubleshooting table organized by the boundary that failed, and terminology
11. Verification and reproducibility

It is assembled from `docs/guide-parts/*.md` by `scripts/assemble-guide.py` and rendered to a 53-page PDF (`output/ir-workbench-v6-user-guide.pdf`, in the original archive only) with reportlab. Chapters 4–6 work as an API reference, and chapter 10.2 is a good glossary to adopt for this ticket.

## 7. Verification status

| Check | Result | Who established it |
| --- | --- | --- |
| Zip CRC, and every file matches `WORKSPACE-MANIFEST.json` (bytes + SHA-256) | **Pass**: 971 entries, 0 missing, 0 mismatches, 0 unlisted extras | Verified here (`scripts/01-verify-manifest.py <zip>`) |
| Imported subset `sources/ir-source-workbench-v6/` matches the manifest | **Pass**: 200 files, 0 mismatches, 0 unlisted | Verified here (`scripts/01-verify-manifest.py <dir>`) |
| Separately delivered guide is identical to `docs/v6-user-guide.md` | **Identical** (`cmp`), so it is stored only once | Verified here |
| Static scan for network or exfiltration APIs in `src/`, `scripts/`, `tests/` | No `fetch`, sockets or HTTP. `child_process` is used only to run `tsc`, the tutorials and test subprocesses. `process.env` appears only in the optional Playwright check | Verified here |
| Strict `tsc` build and 371/371 tests passing | Recorded in `output/v6-release-validation.log` and `output/v6-verification.json` | **Claimed by the archive, not reproduced.** An earlier `v6-tests.log` (archive only) shows 370; the initial v6 run had 1 failure out of 298 |
| Experiments: 16 authored-source, 20 strategy, 33 contract (24 succeed, 9 expected failures), 5 IR, 5 tutorials | Recorded in `output/*.json` | Claimed, not reproduced |
| Rendering in a real browser | **Never verified.** `v6-browser-verification.json` reports `"status": "not-run-environment-restriction"`. UI tests use DOM, Canvas and Worker test doubles | The archive says so itself |

Re-running the shipped typecheck and tests in a scratch copy (`scripts/02-run-verification.sh`) was blocked by this session's permission policy, because it executes code from a downloaded archive. To reproduce, run it yourself with an empty work directory:

```sh
bash ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/02-run-verification.sh \
  ~/Downloads/ir-source-workbench-v6-complete.zip /tmp/irwb-verify
```

Opening `output/source-workbench.html` (in the original archive; not imported) in a browser is the other open check. No browser rendering has ever been confirmed.

## 8. Observations and assessment

**Strengths worth inheriting**

- The four-layer split and one-way dependencies are clean and well argued, so each layer can be used on its own.
- Rigorous identity and evidence model: exact revisions, origin invocations for cache hits, staged acceptance, and failures shown as first-class results.
- The adapter-over-native-storage idea lets each domain keep its own data layout while sharing traversal, matching, editing and lineage.
- Scope is honest: the guide says what is not implemented (no CAD kernel, no e-graphs, no SSA, no theorem prover, no persistence) and what was not verified.
- The executable tutorials (`src/guide/01..05`) are good learning material and could serve as acceptance tests for a reimplementation.

**Concerns for building on it directly**

- **Readability and maintainability.** About 1 MB of TypeScript, much of it in dense very long lines, especially the UI. It reads like generated code and would be costly to review or extend by hand.
- **The UI has never been seen in a real browser.** All UI evidence comes from test doubles.
- **Everything is in memory.** The store, caches and history are lost when the page reloads. There is no persistence protocol; this is stated as out of scope.
- **The logical graph projection is simple and finite.** The guide itself says large meshes or millions of entities would need indexed or streaming backends.
- **The effect system is not a sandbox.** Untrusted plugins would need a separate isolation boundary.
- **Archive weight.** Shipped Linux `node_modules`, about 100 MB of JSON traces and an 11.7 MB HTML file. This is why only a 2.8 MB source subset is imported here; everything else can be regenerated with `npm ci && npm run verify:release`.
- **History clutter.** README-legacy, v3, v4, v5 and v6, plus per-version evidence, live side by side, and older labs (`contract-examples`, `strategy-examples`, `domains/`, `examples/`) are kept as regression references.

## 9. Open questions for this ticket

1. **Reuse vs. reimplement.** Should the IR workbench in this repository build on the v6 TypeScript code, port its concepts (for example to Go with a web front end), or treat v6 as a reference design only?
2. **Which layers are in scope first?** Incremental runtime and query, Strategy IR, semantic contracts, generic IR manipulation, or the workbench UI?
3. **What are the target IRs?** The v6 labs are toy domains. Which real representations should the new workbench host?
4. **Persistence and scale.** Is in-memory acceptable, or are a durable trace store and large-IR support required from the start?
