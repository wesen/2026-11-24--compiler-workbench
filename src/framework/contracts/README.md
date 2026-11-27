# Semantic pass contracts

This is the reusable semantic-contract layer in v5. It is independent of the CAD, scene and mechanism implementations and independent of the compiler scheduler. The integration adapter connects it to compiler acceptance policies so that both computed and cached artifacts undergo the current contract before publication.

## Definition APIs

All definitions have an explicit `id`, `version` and `description`. Definitions are recursively frozen. A `ContractRegistry` registers exact versions, recursively registers referenced definitions, rejects replacement of an existing version, and exposes serializable manifests through `list()`.

| API | Implemented meaning |
| --- | --- |
| `defineIR<T>` | Identifies an artifact kind/schema version and validates its value. |
| `defineType<T>` | Defines a scalar/JSON port type with a runtime validator. |
| `defineProperty<T>` | Names a proposition about one IR artifact and identifies its checking analysis. |
| `defineAnalysis<T,R>` | Defines a typed, versioned computation on an artifact, with parameters, effect declarations and optional checked transfer rule. |
| `defineInvariant<P>` | Defines a relation over named typed ports, such as an input/output approximation bound. |
| `defineObjective<T>` | Associates a finite numerical analysis with a min/max direction. |
| `defineEffect<T>` | Names read or write access to an exact revisioned resource with a scalar value type. |
| `defineTransformation<I,O>` | Declares named inputs/outputs, preconditions, postconditions, establishment, preservation, correspondence, effects and cache policy. |

`createArtifact(ir,id,value)` validates, copies and freezes the payload and creates the same SHA-256 content/revision identities used by the existing compiler. `validateArtifact` verifies the kind, schema, value validator and both hashes. An artifact cannot pass a contract merely by claiming the expected kind or supplying an old revision next to changed data.

An IR port accepts `Artifact<T>`. A scalar port accepts `T`. `PortValues<P>` provides TypeScript inference across named ports; runtime validation additionally checks exact port names. Included scalar definitions are `Integer`, `FiniteNumber`, `JsonValue` and `Check`.

## Writing a contract

```ts
import * as C from './contracts/index.js';

const MeshIR = C.defineIR<Mesh>({
  id: 'geometry.mesh', version: '1', description: 'Triangle mesh',
  validate: validateMesh
});
const ManifoldCheck = C.defineAnalysis({
  id: 'mesh.manifold-check', version: '1', description: 'Closed topology',
  input: MeshIR, output: C.Check,
  run: (_ctx, artifact) => ({
    ok: meshMetrics(artifact.value).watertight,
    reason: 'Every oriented edge must have its opposite partner'
  })
});
const Manifold = C.defineProperty({
  id: 'mesh.manifold', version: '1', description: 'Closed oriented mesh',
  subject: MeshIR, check: ManifoldCheck
});
const Reduce = C.defineTransformation({
  id: 'mesh.reduce', version: '1', description: 'Checked mesh reduction',
  inputs: { mesh: MeshIR, tolerance: C.FiniteNumber },
  outputs: { mesh: MeshIR },
  requires: [{property: Manifold, subject: {from: 'inputs', port: 'mesh'}}],
  ensures: [{property: Manifold, subject: {from: 'outputs', port: 'mesh'}}],
  cache: 'pure'
});
```

The geometry functions in this sketch are application implementations; the framework does not assume a universal mesh representation. Actual contracts for the included domains live under `src/contract-examples/`.

A condition either checks a property on `{from:'inputs'|'outputs',port}` or binds an invariant's named ports to input/output selectors. The factory checks port compatibility and rejects references to outputs in preconditions. Invariant results must be `{ok:boolean,reason?,evidence?}`; truthy objects or strings are rejected.

The clauses have separate operational meanings:

- `requires` runs before the kernel. Failed requirements prevent execution.
- `ensures` checks output properties or relational invariants before acceptance.
- `establishes` checks and records a newly established output fact.
- `preserves` checks that an input property holds and remains valid for an output. `mode:'check'` runs the target checker; `mode:'transfer'` requires a declared correspondence and an executable authorized transfer rule.
- `correspondence` requires supplied records naming exact input/output artifact revisions and the declared relation.
- `effects` governs access through the revisioned resource port.
- `cache` is `pure`, `tracked` or `never`. Pure definitions declare no resource effects. Writes require `never`.

A preservation declaration is not accepted as its own evidence. Required transfer rules are versioned parts of the analysis definition; redefining their implementation requires a new definition version.

## Analysis manager API

`new AnalysisManager(registry?, resourcePort?)` retains reusable analyses, facts, executions and evidence.

| Method | Result / behavior |
| --- | --- |
| `analyse(definition,artifact,params?)` | Compute or reuse an `AnalysisRecord<R>` for the exact subject, definition version and parameters. |
| `hasAnalysis(definition,artifact,params?)` | Check current reusable availability, including transitive dependencies and explicit invalidations. |
| `check(property,artifact)` | Obtain a checked or otherwise authorized `PropertyFact`; false is a recorded fact, not an exception. |
| `checkInvariant(invariant,namedInputs)` | Query a relational invariant independently; returns checked evidence and records its actual typed inputs. |
| `properties(artifact)` | Inspect current revision-specific facts and their current validity. |
| `explainProperty(property,artifact)` | Explain availability, checker version, assurance, evidence and invalidation for this exact revision. |
| `preserve(analysis,from,to,correspondence,params?)` | Transfer a valid existing result only after the registered transfer checker approves this exact correspondence. |
| `invalidate(analysisOrProperty,artifact,reason?)` | Invalidate information and advance its epoch; dependent information becomes unavailable, including a checker still computing when invalidation occurs. |
| `evaluateObjective(objective,artifact)` | Execute/reuse the numerical analysis and return its value, direction and exact analysis record. |
| `declare(property,artifact,reason)` | Record an unverified declaration. It cannot satisfy a requirement. |
| `recordProof(property,artifact,certificate)` | Invoke the property's explicitly registered external certificate verifier and record its accepted evidence. |
| `snapshot()` | Return immutable manifests, histories, executions and events for inspection. |

Analyses may depend on analyses, properties and versioned resources. These dependencies are retained as exact record IDs and resource revisions. A change to a dependency, definition version, artifact revision or invalidation epoch prevents stale reuse. Cycles across analyses and properties are diagnosed. Analysis/fact identities are deterministic for equivalent computations, so concurrent verification of the same immutable source does not create false conflicts.

Inside an analysis, invariant or transformation, `ContractContext` provides:

```ts
await ctx.analysis(TriangleCount, mesh);       // returns the typed value
await ctx.check(Manifold, mesh);               // returns a fact
await ctx.require(Manifold, mesh);             // throws when not established
await ctx.checkInvariant(WithinBudget, inputs);
ctx.properties(mesh);
ctx.explainProperty(Manifold, mesh);
ctx.readResource(ReadProfile);
ctx.writeResource(WriteExport, value);
ctx.record('measured deviation', evidence);
```

All asynchronous context requests must be awaited. Pending requests are observed, drained and rejected at lifecycle boundaries; they cannot silently finish after output acceptance. Contexts close after their owner returns. Rolling back a transaction immediately closes every descendant context, so pending work cannot publish late analysis or fact records. Every asynchronous query captures artifact revisions, parameters, certificates and correspondences before awaiting caller code. Fact-set/explanation introspection can observe absent information, so its computations and dependants conservatively disable caching rather than pretending an incomplete dependency list captures absence.

## Evidence and transfer

Every property fact identifies its exact artifact ID, revision, kind and schema version, the property and checker versions, the supporting analysis, dependencies, current validity and assurance:

- `declared`: an assertion was recorded, without verification; `ok` is false for authorization purposes.
- `checked`: the specified checker ran or its exact valid evidence was reused.
- `transferred`: an existing valid result was carried to another revision after an authorized transfer checker verified the explicit correspondence.
- `proof`: the property-specific external certificate verifier accepted a supplied certificate.

The last category is an explicit trust boundary. This framework does not contain a theorem prover and does not turn a Boolean checker into a mathematical proof. The record identifies the external verifier and certificate, so callers can evaluate the authority of that evidence. Supplying an assurance string cannot create an accepted fact.

A correspondence contains `id`, exact `from` and `to` artifact references, `relation`, optional entity groups and application evidence. An IR definition may provide `entities(value)` to enumerate its entity IDs; when it does, correspondence checking compares the corresponding `sourceEntities` or `targetEntities` list against that artifact's IDs. `semanticCorrespondence` carries these lists from a generic IR correspondence. Transfer checks validate exact revisions and their semantic justification. Same-artifact preservation reuses the existing analysis without introducing a self-dependency. Source invalidation also invalidates transferred results.

## Transaction and compiler integration

A transformation can be evaluated directly through `manager.execute(definition,inputs)`. Its optional `run(ctx,inputs)` returns `{outputs,correspondence?}`. The manager validates inputs, executes requirements, computes or reuses the body, checks every guarantee, and then accepts the result.

For an existing compiler, use the explicit transaction lifecycle:

```ts
const tx = await manager.beginTransformation(contract, namedInputs, {
  runId, invocationId
});
// Existing compiler kernel executes; tx.context is its semantic resource/query port.
const prepared = await tx.verify(namedOutputs, correspondences, {cached});
// After every compiler acceptance gate has succeeded:
prepared.commit();
```

`verifyTransformation(before,after,contract,correspondences?,options?)` is a convenience for an already computed lowering. It commits by default; `deferCommit:true` returns a prepared transaction for a host acceptance gate.

`verify` seals the body context immediately, snapshots outputs/correspondences before waiting, and allows only one verification in flight. Output analysis/facts and resource writes remain provisional until synchronous `commit()`. `rollback(reason)` discards them; `fail(error)` additionally retains the original error classification. A closed accepted execution cannot be rewritten as failed. `tx.settle()` drains started semantic work before an asynchronous host failure hook finalizes the error.

Failed provisional analysis/fact records remain in history with invalidation explaining that they were discarded. They are not exposed as current facts and cannot authorize reuse. The execution still contains the rejected checks, exact revisions, effects and error, so failure is inspectable rather than disappearing.

### Computational reuse versus guarantee checks

A cached artifact is still checked under the current contract. The body has its own tracked dependency frame; pre/post checks do not masquerade as computational dependencies.

`execution.bodyDependencies` and `bodyCacheable` describe what the previous kernel used. Before an external compiler reuses that kernel's artifact, it calls `manager.canReuseDependencies(previous.bodyDependencies)`. If reuse is allowed, `tx.importBodyDependencies(...)` validates and imports those dependencies, resource compare-and-swap stamps, permissions and evidence links. Then current guarantees run normally. Importing the complete old manifest on every warm run prevents a second cache hit from dropping body-only dependencies.

The v5 compiler adapter uses its generic pass policy hooks for this sequence. New artifacts are checked before the artifact store and computational cache accept them; cache hits are gated too. A rejected current guarantee cannot expose an old cached artifact as an accepted result of the new run.

## Revisioned effects

`ResourcePort` exposes synchronous snapshot reads and an atomic synchronous commit of staged JSON writes against expected original revisions. `MemoryResources` is the included reference adapter. The port contract requires all-or-nothing commit: it validates all names/values and expected revisions before applying any write. Async external systems can be adapted by preparing a stable snapshot and using an appropriately transactional host commit boundary; they must not claim atomicity they cannot provide. Native async adapter methods and thenable commit results are rejected; rejected asynchronous adapter work is observed but cannot be undone by the manager. The host adapter remains responsible for its atomicity guarantee.

Resource access is checked transitively. An analysis's declared read does not grant its caller permission; the enclosing transformation must declare the effect too. Cached analysis reuse checks the same permissions and dependency revisions. Missing-resource reads record a `missing` revision before throwing, so a caught fallback is invalidated if the resource later appears.

Writes are staged and visible to subsequent reads in the same transaction. Preconditions can read the original resource state, while postconditions see staged revisions. Commit checks the physical original revisions for conflicts and validates post-write dependencies against the proposed final view before installing writes and facts. A rejected postcondition publishes neither the proposed resource state nor its facts.

These rules enforce use of the explicit effect port. They do not sandbox arbitrary JavaScript: an application implementation that directly changes global variables, files or network state outside the port violates the host contract and cannot be made pure by declaration. `cache:'pure'` is not a security boundary. The same qualification applies to caller-supplied validators and transfer/certificate verifiers; their versions and behavior remain an application responsibility.

## Scope

This module implements semantic pass contracts and analysis management. It does not introduce a universal AST, generic rewrite matcher, transaction-based IR editor, e-graph, static effect inference, persistent cache backend or formal proof engine. Those are separate architectural layers.
