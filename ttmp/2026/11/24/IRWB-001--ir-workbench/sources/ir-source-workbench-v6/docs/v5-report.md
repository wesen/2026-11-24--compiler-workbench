# IR Workbench v5

## Semantic pass contracts: implementation report

V5 adds executable semantic interfaces to the TypeScript compiler framework. A transformation can now state the types of its named inputs and outputs, the facts it needs, the guarantees it promises, the properties it preserves, the resources it may access, and the correspondence it produces between artifact revisions. These declarations are checked around the actual algorithms. The workbench shows both the declaration and the evidence produced by a particular invocation.

The v4 workspace and standalone HTML were published before this work began. V5 continues that implementation: the authored TypeScript programs, all thirteen Strategy IR operators, editable and serializable compilation plans, incremental compiler, source browser, highlighted YAML, and compact pass inspector remain present. This report describes the complete semantic-contract component requested as item 2. The implementation and tests are included in the accompanying complete workspace archive.

## 1. Component boundaries

The framework now has three independently usable execution components: the incremental compiler, the Strategy IR interpreter, and the semantic analysis and verification manager. The integration layer connects them to the example domains. None requires all domain representations to become one universal AST.

| Component | Responsibility | Main implementation |
| --- | --- | --- |
| Compiler runtime | Resolve tasks, capture immutable inputs, validate artifact schemas, cache algorithm output, record invocations | `core/runtime.ts` |
| Pass policy boundary | Validate acceptance, govern extension-owned cache dependencies, and finalize staged state | `core/types.ts`, `core/runtime.ts` |
| Strategy IR | Describe, edit, validate, execute, and inspect compilation control flow | `strategy/` |
| Semantic definitions | Versioned types, properties, analyses, invariants, objectives, effects, and transformations | `contracts/types.ts`, `definitions.ts`, `registry.ts` |
| Analysis manager | Revision-specific facts, dependency-aware reuse, checked transfer, transactional verification | `contracts/analysis-manager.ts` |
| Resource adapter | Versioned finite-data resources and atomic revision comparison on writes | `contracts/effects.ts` |
| Domain integration | Bind actual compiler pass parameters and artifacts to semantic contracts | `contract-examples/domain-contracts.ts` |
| Domain checkers | Mesh, scene, and mechanism measurements and relations | `contract-examples/domain-semantics.ts` |
| Workbench | Inspect executed contracts, exact revisions, analysis reuse, effects, and implementation source | `workbench/contracts-panel.ts` |

The implementation paths in the table are relative to `src/`. The core runtime imports neither the contracts package nor the strategy package. Its policy hooks are a generic acceptance interface. The contracts package uses the shared artifact protocol and finite-data utilities, but knows nothing about compiler task scheduling, CAD, scenes, or mechanisms. Domain registration uses a narrow registry interface. The source compiler supplies the concrete policies and attaches their portable records to each run.

This separation matters for reuse. A different compiler can use `AnalysisManager` directly around its own transformations. A scheduler can use Strategy IR without adopting the example geometry schemas. An existing pass can acquire a semantic policy without changing its algorithm version or moving domain checks into the core runtime.

## 2. Definition and typing APIs

All eight requested definition families are implemented and exported from `src/contracts/index.ts`.

| API | Meaning and operational use |
| --- | --- |
| `defineIR` | A versioned artifact kind with a runtime validator; IR ports accept an artifact with matching kind, schema version, and content hashes |
| `defineType` | A versioned scalar or structured finite-data type with runtime validation |
| `defineProperty` | A proposition about one IR artifact, connected to a versioned checking analysis |
| `defineAnalysis` | A typed calculation over an artifact, with tracked dependencies and optional checked transfer rule |
| `defineTransformation` | A named input/output interface, semantic clauses, effect declarations, cache policy, and optional implementation |
| `defineInvariant` | A relational check over several named typed values, suitable for input/output relationships |
| `defineObjective` | A finite numerical analysis and an explicit minimization or maximization direction |
| `defineEffect` | Permission to read or write one named resource through a declared value type |

Definitions have an identity, version, and description. The registry recursively registers their dependencies and rejects redefinition of an existing identity and version. Its descriptors contain finite data for inspection and interchange; implementations remain executable TypeScript in the source catalog. A version is an explicit author-managed semantic identity, not an inferred hash of a JavaScript function.

An IR-valued port carries an `Artifact<T>`. An ordinary value port carries `T`. This distinction survives TypeScript inference through `PortValues<P>`, and the runtime validates both. Named input and output sets must match the contract exactly. An artifact is checked against its declared kind and schema, and its content and revision hashes are recomputed. Relabeling an arbitrary object with a plausible revision string does not make it a valid artifact.

Artifacts and captured inputs are immutable finite acyclic data. Functions, nonfinite numbers, cycles, accessors, and unsupported object prototypes cannot enter stored values. Definitions can contain implementation functions because they are registered code; their inspectable descriptors exclude those functions.

The concrete API uses explicit port selectors to resolve ambiguity in multi-input transformations. A property clause identifies its input or output port. A relational invariant binds each of its named inputs to a transformation port. For example:

```ts
const cleanup = defineTransformation({
  id: 'example.cleanup', version: '1',
  description: 'Clean vertex storage while preserving the surface',
  inputs: { mesh: MeshIR },
  outputs: { mesh: MeshIR },
  requires: [
    { property: NamedSurfaces,
      subject: { from: 'inputs', port: 'mesh' } }
  ],
  ensures: [{
    invariant: SameOrientedSurface,
    bindings: {
      before: { from: 'inputs', port: 'mesh' },
      after: { from: 'outputs', port: 'mesh' }
    }
  }],
  effects: [], cache: 'pure'
});
```

The identifiers in this small construction example stand for registered domain definitions. The working cleanup contract uses the same API in `domain-contracts.ts`, and its actual geometry kernel is visible in `src/strategy-examples/cleanup.ts`.

## 3. The acceptance lifecycle

Semantic verification is an acceptance boundary around execution. It also runs when the compiler proposes to reuse an old artifact.

1. Capture the named inputs and validate their types and artifact identities.
2. Evaluate `requires` before the algorithm can run or a cached output can be accepted.
3. Compute the result, or validate the dependencies that authorize reuse of a previous computation.
4. Validate the provisional named outputs and their IR schemas.
5. Check correspondence requirements, preservation claims, `ensures`, and `establishes`.
6. Revalidate the evidence dependencies and resource revisions, then atomically commit staged resource changes and facts.
7. Publish the compiler artifact and, when eligible, retain its computational cache entry.

The standalone API exposes `beginTransformation`, a transaction context, `verify`, and a prepared result with synchronous `commit`. `verifyTransformation` checks an existing before/after pair; `execute` also invokes an implementation and manages its output cache. Normal calls commit after successful verification. The deferred form gives a host compiler control over the final acceptance point.

The body context is sealed when verification starts. It cannot write a resource or launch a new analysis after postconditions have run. Concurrent verification attempts are rejected. Unawaited analysis and property requests are observed and drained, and make the transformation fail rather than escaping the transaction lifecycle. An accepted transaction cannot subsequently be relabeled as failed or rolled back through a retained handle.

Failed verification does not publish new reusable output facts or commit staged resource writes. It retains the invocation, completed checks, provisional output where available, error, and discarded analysis/fact history for inspection. Those discarded records are explicitly invalid for reuse. Upstream compiler tasks that already completed remain in history and may remain cached; this is a per-transformation acceptance boundary, not rollback of an entire compilation graph.

## 4. Properties, evidence, and analyses

An analysis cache key includes the analysis definition and version, the input/output type identities, the subject artifact identity and revision, and explicit analysis parameters. Its record also contains the values on which the computation actually depended. These can include other analysis records, property facts, and resource revisions.

`analyse` returns an analysis record; `ctx.analysis` returns the typed analysis value while recording the dependency. `hasAnalysis` answers whether valid reusable information is presently available. `invalidate` explicitly invalidates the selected information. Dependent facts and analyses become unusable through dependency validation, rather than trusting an old `valid` flag in isolation.

`check` obtains property evidence. `checkInvariant` evaluates a first-class relational invariant against its named typed inputs, independently or through the active context. `ctx.require` additionally rejects a false or merely declared proposition. `properties` lists facts for an exact artifact revision. `explainProperty` returns the checker identity, fact, dependency status, and reason for availability or invalidation. `evaluateObjective` obtains a finite measured value with its declared direction and the underlying analysis record.

Presence and absence of arbitrary facts are themselves observations. Calling `ctx.properties` or `ctx.explainProperty` from a calculation therefore disables caching for that observer and its dependants. This conservative rule prevents an analysis of the fact store from remaining cached after new facts appear. Direct dependencies requested through `analysis`, `check`, and `require` retain precise reuse.

| Assurance | What the record means |
| --- | --- |
| `declared` | An author supplied a claim. It cannot satisfy a required property by itself. |
| `checked` | A registered checker produced evidence for the exact subject revision. Later reuse retains that evidence and its dependencies. |
| `transferred` | A registered transfer checker validated a correspondence and authorized carrying an existing analysis to another revision. |
| `proof` | An explicitly configured external certificate verifier accepted supplied evidence. The record identifies that verifier and its trust boundary. |

The framework includes no theorem prover. A Boolean result from a geometry checker is dynamic evidence. The external verifier channel keeps a supplied proof certificate distinct from an ordinary declaration; its assurance depends on the verifier the compiler author installs. No example silently upgrades a runtime check to a mathematical proof.

Historical analysis and fact records remain inspectable after invalidation. A run captures its own immutable contract snapshot, so later compilation or resource edits do not rewrite the evidence that the workbench displays for that run.

## 5. Preservation and correspondence

`preserves` has two operational modes. Check mode establishes the source property and checks the target property. Transfer mode additionally requires an explicit correspondence and an authorized transfer checker. A declaration alone never copies a result to a new revision.

The correspondence identifies exact source and target artifact revisions. Entity groups support many-to-one, one-to-many, insertion, and removal. The generic layer validates the relationship's shape, exact endpoints, declared identity, and relation. Domain checkers validate what the entity names and relationships mean. A mesh relation is consequently checked against real vertices and semantic face labels rather than accepted because its JSON has the right fields.

The cleanup example compares the ordered triangle coordinates and face identities before and after a vertex-storage change. Removing an unused vertex or welding an exact duplicate changes storage while retaining that oriented surface. Transfer evidence records the checked entity relationship and the versioned transfer rule. The ring reduction example permits a different geometry, checks its supported analytic error bound, and separately preserves semantic surface families.

These guarantees are deliberately specific. A statement that all triangles retain supported surface labels does not establish arbitrary material or appearance equivalence. An exact oriented-triangle comparison does not prove arbitrary CAD solid equivalence. The contract names, evidence, and report describe the proposition actually checked.

## 6. Resource effects and cache correctness

Effects identify a resource, access mode, value type, identity, and version. A read or write through the contract context must be declared by the active calculation and all enclosing contracts. An analysis and invariant can read declared resources; they cannot declare write effects. Transformations that write resources require `cache: 'never'`, ensuring the requested write is not skipped by output caching.

The included `MemoryResources` adapter stores immutable finite data and revision fingerprints. Writes are staged. Reads observe writes already staged in the same transaction, so postconditions check the prospective state. The original physical revisions remain separate for atomic comparison at commit. A conflict or failed guarantee applies none of the staged writes. The adapter validates the whole write batch before changing its first resource.

Resources read only to approve an output differ from resources used to compute it. V5 tracks the algorithm body's dependency manifest separately from precondition and postcondition dependencies. A changed body resource makes the old computation ineligible for reuse. A changed approval limit can be checked against the same cached geometry. This distinction is observable in both the standalone manager and the compiler bridge.

Repeated warm runs retain the original body dependency manifest. Otherwise a cache hit could skip the body, record no reads, and accidentally erase the information needed to invalidate the next reuse. Cached analysis access also revalidates transitive resource permissions and resource revisions. A cache cannot become a route around an effect declaration.

The cache modes are `pure`, `tracked`, and `never`. Pure transformations declare no resource effects. Tracked transformations may reuse computations whose captured dependencies remain valid. Never mode executes the implementation every time. This is an explicit resource interface for trusted algorithms; JavaScript code outside that interface is not sandboxed or automatically instrumented. The supplied examples perform no network or filesystem write through these effects.

## 7. Integration with the existing compiler

`Compiler.setPassPolicy` installs a versioned policy outside an active run. A run captures the installed policy registrations. Policies have hooks for input preparation, computational cache reuse, provisional output verification, synchronous commitment, and failure cleanup. Reusing a previously used policy identity/version for different code is rejected.

Every invocation records its applied policy identity. Policy reads and observations are retained on the invocation, but are kept separate from replayable algorithm observations. A warm pass does not replay yesterday's property check as though it ran today. Its contract has a new execution record, with current lookup events and current evidence dependencies.

The `reuse` hook handles dependencies owned by an extension, including semantic resource reads in a pass body. A rejected reuse decision produces an explained cache miss and executes the algorithm again. A failed postcondition instead rejects the provisional output. These are different outcomes and remain distinguishable in the record.

The source compiler installs typed contracts over its registered passes, using the existing IR validators rather than inventing a parallel set of structural schemas. Strong semantic clauses are attached where the examples establish substantive guarantees. A pass with only a typed interface does not acquire a geometric theorem by association with the rest of the pipeline.

Strategy execution continues to select and schedule work. The contracts layer accepts or rejects the resulting transformations. The bridge respects the strategy's evaluated candidate set, so removing an optimization branch does not cause contract preparation to resurrect its work. Original v4 tests exercise this behavior, cache reuse, objective edits, implicit dependencies, fixed-point cleanup, and all thirteen Strategy IR operators.

A rejected compiler invocation marks its compilation run as failed. The current task runtime does not erase that failure so an enclosing callback can continue the same run successfully. Explicit strategy feasibility checks remain recoverable through Strategy IR's rejection mechanism; independent semantic transactions can also inspect candidate results separately. This integration preserves that distinction between candidate infeasibility and a failed registered pass.

## 8. Domain examples and the contract laboratory

The building, pavilion, bracket, four-bar linkage, and animated door retain their authored TypeScript programs and real compiler implementations. The fixed-point cleanup example continues to exercise bounded repeated transformation. Contracts run by default in all six.

| Example area | Additional semantic evidence |
| --- | --- |
| CAD and primitive meshes | Valid typed outputs, closed oriented mesh checks, and semantic surface labels |
| Ring reduction | Positive integral divisor, supported source/target ring geometry, conservative deviation bounds, watertight target, checked surface correspondence |
| Vertex cleanup | Exact ordered surface geometry, face identity, and justified transfer across changed storage |
| Scene packaging | Unique definition and occurrence identities, resolved geometry/material references, independent triangle counts and topology |
| Mechanism sampling | Recomputed geometric constraints and solver evidence checked against settings |
| Semantic contract lab | Deliberately legal and illegal transformations, resource-dependent computation, approval checks, and staged effects |

The seventh workbench example is a semantic-contract laboratory. Its modes use real registered passes and the same compiler policy mechanism as the ordinary examples.

| Lab mode | Expected behavior |
| --- | --- |
| Verified cleanup | Remove an unused vertex and accept checked surface preservation |
| Rejected precondition | Reject a zero reduction divisor at the typed input boundary |
| Rejected postcondition | Reject a vertex movement that changes the promised surface |
| Rejected preservation | Reject a fabricated face label without valid transfer justification |
| Undeclared effect | Reject a resource read absent from the active contract |
| Tracked resource check | Recheck cached geometry against a changed volume acceptance limit |
| Resource-derived geometry | Recompute the body when its resource-dependent scale changes |
| Committed effect | Accept a staged in-memory export-counter increment |
| Discarded staged effect | Retain the counter when a later geometry guarantee fails |

The volume control lets a user exercise resource revisions from the workbench. The export counter demonstrates committed versus discarded writes. These operations affect the lab's in-memory resources only.

## 9. Inspecting the implementation

The workbench preserves the requested source-first arrangement. The selected example's actual TypeScript is visible. The Strategy IR is editable and displayed as highlighted YAML. Compiler invocations remain a compact sidebar, with the selected step's details to the right and its IR route above the details. The focus control gives the inspector more space without changing execution.

The pass inspector's Contracts tab provides five views:

- Checks and acceptance: completed clauses, verdicts, assurance, exact subject revisions, and failure reasons.
- Analyses and properties: reused or computed records, transitive dependencies, transfer rules, and explanation buttons.
- Typed contract: the captured versioned interface, named inputs/outputs, and all declared clauses.
- Effects and correspondence: resource versions, staged/committed access, and actual entity mappings.
- Implementation: indexed definition source and the full source browser for dynamically constructed contracts.

The implementation view uses the actual embedded workspace sources. Literal definition identities have source locations and highlighted ranges. Dynamically constructed definitions retain their exact runtime declaration and link into the complete implementation browser; the interface does not invent a literal location that does not exist.

To investigate why an object was cached, select the relevant strategy choice, follow its compiler invocation, inspect the computational cache explanation, then open Contracts to see the evidence that authorized acceptance. Analysis reuse and algorithm reuse are separate facts. An output can be cached while its new acceptance check fails. A property can be checked once and validly reused while the algorithm executes again for another reason.

## 10. Verification and release evidence

The final strict TypeScript build and all **269 automated tests passed**, with zero failures, cancellations, or skipped tests. This includes all 192 v4 tests and 77 new v5 tests. `output/v5-verification.log` records the complete release command and results.

| New verification group | Tests | Main evidence |
| --- | --- | --- |
| Generic contracts engine | 25 | `tests/contracts.test.mjs` |
| Core acceptance policy lifecycle | 14 | `tests/pass-policy.test.mjs` |
| Actual domain integration | 17 | `tests/contract-integration.test.mjs` |
| Independent semantic regression review | 11 | `tests/v5-review.test.mjs` |
| Contract UI and complete application scenarios | 10 | `tests/contracts-ui.test.mjs` |

The checks cover exact typed ports and forged revisions; precondition and postcondition ordering; cache hits under a new contract version; authorized transfer and invalidated dependencies; effect permissions through cached analyses; resource conflicts; body-only dependencies across repeated warm runs; staged post-state checks; rejected output publication; in-flight invalidation; mutable caller inputs during asynchronous verification; unawaited work; manual rollback; asynchronous adapter rejection; and immutable terminal execution history. Existing strategy tests also confirm that edited plans change actual work and that all thirteen operators still execute in the domain examples.

The release runs the 16 authored-source scenarios, 20 strategy scenarios, and 33 semantic-contract scenarios. The semantic suite records 24 successful compilations and nine intentional failures. Those negative outcomes are required experiment results, not failing test assertions. Its exact run and invocation records are under `output/contracts-experiments/`; the summary identifies all **44 registered pass contracts**.

| Example | Cold body executions | Warm cached invocations | Clauses audited per run |
| --- | --- | --- | --- |
| Building | 59 | 59 | 226 |
| Pavilion | 35 | 35 | 118 |
| CAD bracket | 12 | 12 | 6 |
| Four-bar linkage | 11 | 11 | 6 |
| Mechanical door | 49 | 49 | 73 |
| Fixed-point cleanup | 7 | 7 | 16 |

Every unchanged warm run executes zero kernel bodies while enforcing its current contract. Clause counts exclude the additional typed input/output validations. A clause can use an existing valid property fact or analysis; the trace separately records that reuse. The semantic objective query on the building's evaluated divisor-four LOD returns 2,120 rendered triangles with its exact subject and analysis record.

The acceptance-only resource experiment rejects a cached volume-six mesh when its limit falls from 10 to 1, then accepts that cached geometry when the limit returns to 10. The body-resource experiment instead changes scale: 10 to 20 forces one kernel to execute, changing maximum X from 2 to 4 and volume from 6 to 12. Repeating at 20 reuses the new result. These measurements make the two dependency boundaries observable rather than relying on declarations alone.

The browser limitation is explicit. This environment blocked local Chromium launch, the connected browser lacked an originating extension context, and the cloud browser rejected local file navigation. No browser-policy workaround was attempted. Automated UI coverage uses documented DOM, canvas, and worker-transport test doubles with the real evaluator, compiler, strategy interpreter, and contract manager. The provided browser smoke script can be run in an environment that permits the standalone HTML to open. The release does not claim browser pixel or browser compatibility verification that did not occur.

## 11. Reproduction and delivery

The complete archive contains TypeScript sources, compiled JavaScript and declarations, source maps, scripts, tests, reports, verification evidence, lockfiles, and the installed build dependencies from this Linux workspace. `WORKSPACE-MANIFEST.json` records the byte length and SHA-256 of every included workspace file other than the manifest itself. The archive is checked for CRC errors and verified against that manifest. Its workbench HTML is byte-identical to the separately delivered HTML.

```sh
npm run build:source
npm test
node scripts/source-demo.mjs
node scripts/strategy-demo.mjs
node scripts/contracts-demo.mjs
python scripts/render-v5-report.py
```

The TypeScript and workbench have no third-party runtime dependency. Node 22 or newer is required to run the workspace scripts. The installed bundler binary in the archive is for this workspace's Linux platform; on another platform, install dependencies from the included lockfile. The standalone HTML embeds the evaluator, worker source, compiler, definitions, UI, and source catalog. Its content security policy disables network connections.

Python is used only for report rendering and optional browser verification tooling. The searchable PDF is generated from this Markdown report, then rendered and inspected. Historical v3 and v4 evidence remains labeled as historical; it is not presented as evidence of new v5 behavior.

## 12. Scope and extension points

Semantic contracts are dynamic checks and explicit trust boundaries. Their reliability depends on the domain checkers and versioned implementations supplied by the compiler author. Version labels must change when the meaning of a definition changes. The resource protocol assumes an adapter honors its atomic commit interface. Resource accesses outside the declared context remain outside the system's observation.

The existing domain scope remains bounded: the CAD backend recognizes the supplied analytic bracket family; scene simplification supports the implemented ring reduction and retention paths; the mechanism is sampled four-bar kinematics. The framework does not claim a general CAD kernel, arbitrary mesh simplifier, or rigid-body dynamics engine.

The generic representation-adapter, pattern-matching, and rewrite-editing component described as item 3 is a future layer. V5's correspondence data and semantic interfaces are reusable inputs to that work. Current transformations continue to use their concrete TypeScript algorithms, with explicit strategies deciding when they execute and contracts deciding whether their outputs can be accepted.
