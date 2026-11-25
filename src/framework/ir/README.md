# Generic IR manipulation

This package implements the third layer independently of the scheduler, semantic contracts and domain implementations. Public exports are in `index.ts`. Domain adapters retain their native representations and expose a finite logical projection for shared algorithms.

## Adapt and open a representation

`defineAdapter(definition)` captures versioned adapter metadata and callbacks from a plain record with own callback properties. Wrap class methods explicitly when adapting an existing class implementation. The mandatory methods are `entities`, `resolve`, `relations` and `describe`; `relationKinds` assigns each named edge kind to containment, dependency, binding, adjacency or provenance. Enumeration and resolution must agree. Duplicate IDs, invalid edge categories, missing endpoints and malformed roots are rejected.

Optional `validate`, `rebuild`, `operation`, `serialize`/`deserialize` and `visualize` functions supply additional capabilities. A rewritable adapter requires a native validator. A serializer and deserializer must be supplied together. Adapter callbacks are synchronous; enumeration may use synchronous iterators. Registration is versioned through `AdapterRegistry`, which rejects changing a registered definition under the same version tuple.

`createIRArtifact(adapter,id,value)` captures finite immutable data and computes its content/revision hashes. `openIR(artifact,adapter,store?)` validates those hashes and binds a view to an exact revision. The optional `IRStore` retains history and owns a compare-and-swap head for each artifact ID. Reopening an existing revision does not advance its head; new revisions are published by edit transactions.

Every reference is `{artifact,revision,entity}`. Methods accept local entity IDs as a convenience, but reject a qualified reference from another artifact or revision. `view.at(committedArtifact)` creates a new view using the same adapter and store. The previous view remains immutable and readable.

## Navigation

`entities`, `resolve`, `describe`, `relations`, `operation`, `find`, `graph`, `serialize` and `visualize` inspect the bound representation. `children`, `parents` and `ancestors` follow containment only. `successors` and `predecessors` follow explicitly named edge kinds. `dependencies` defaults to transitive dependency and binding edges; use `{transitive:false}` for one step.

`walk` supports pre-order, post-order and breadth-first order, selected roots and relation kinds, direction, maximum nodes and maximum depth. It is deterministic and cycle-safe. With no explicit roots it includes disconnected components. Budgets throw `IRBudgetError` instead of returning an incomplete result as success. Default node/depth bounds are 10,000.

`subgraph(selection)` returns the induced logical subgraph. Select `closure:'dependencies'` or `closure:'connected'` for a closure, and optionally restrict its relation kinds and node budget. This is a view projection, not automatically a valid standalone native artifact.

## Transaction lifecycle

`view.beginEdit({label?,verify?})` returns a draft tied to the exact current head and its generation. Available mutations are:

| Method | Behavior |
| --- | --- |
| `insert(entity)` | Insert a unique stable ID and return a transaction-local handle |
| `replace(target,entity)` | Replace kind/attributes while preserving the entity ID |
| `update(target,attributes)` | Shallow merge attributes |
| `remove(target)` | Remove the entity and its incident relations, without cascading other entities |
| `connect(from,spec,to)` | Add a declared typed relation; supply a stable ID when required by native reconstruction |
| `disconnect(id)` or `disconnect(from,kind,to)` | Remove an exact edge or matching endpoint edges |
| `redirectReferences(from,to,options?)` | Redirect incoming binding/dependency edges by default; other kinds/directions must be explicit |
| `correspond(from,to,relation?)` | Record one-to-one, split, merge, insertion or removal correspondence |

An inserted handle carries the base revision and is valid only inside that draft. It cannot be resolved through the immutable base view. After commit, obtain a reference from the returned revision's view.

`preview()` returns a frozen logical draft. `prepare()` seals mutations, validates the graph, rebuilds native storage, validates its native schema and reprojects the result. It rejects any silent loss or invention of edited logical entities/relations. Native roots are derived by the adapter from the rebuilt value. It then computes actual entity, relation and root changes plus a total correspondence, including implicit retention/addition/removal entries. Preparation does not publish.

`await commit()` optionally verifies the prepared candidate, rechecks the exact head and generation, synchronously accepts semantic state, and publishes the new native revision. The verifier returns `{commit(),rollback()}`; both callbacks must be synchronous. The existing semantic manager's prepared transformation implements that protocol. A rejected candidate never advances the head.

The generation check detects concurrent edits, no-op intervening commits, and an A→B→A content cycle. Native and semantic checks may await before publication, but the final acceptance/publication boundary does not await. Reentrant publication is forbidden. Cancellation through `rollback()` during verification discards subsequent acceptance. A committed draft cannot be reused or rolled back as an undo operation.

Each edit transaction is atomic. A sequence of several committed edits is not automatically one atomic transaction. The rewrite scheduler keeps earlier accepted revisions if a later candidate fails. An enclosing compiler pass has its own publication boundary.

## Differences and correspondence

`diff(beforeView,afterView)` compares logical entities, edge data and roots, including views with different adapters. `affectedEntities(changes)` returns revision-qualified references to changed entities, edge endpoints and changed roots. The edit operation log describes what was requested; the structural difference describes what actually changed.

`makeCorrespondence`, `validateCorrespondence`, `composeCorrespondence`, `invertCorrespondence` and `traceEntity` work independently of a particular native format. A grouped correspondence denotes the Cartesian relation between its source and target IDs. Empty endpoints represent additions or removals. Source and target universes are explicit and fully accounted for.

Composition requires the same intermediate artifact ID, revision and entity universe. Splits and merges compose relationally; creation followed by deletion leaves no surviving endpoint. Inversion reverses historical relations, not the executable edit. Tracing follows an ordered exact-revision chain and retains per-step branching/removal evidence. Default composition and trace bounds are 100,000 pairs/references.

Correspondence records association, not semantic equivalence. A domain checker must justify any preservation or analysis transfer that uses it.

## Patterns and rewriting

See [Patterns and rewrite schedules](PATTERNS-AND-REWRITES.md) for all builders, matching evidence, registries, seven schedules, order selection, budgets, scoped edit authority and failure statuses. Pure pattern/guard callbacks receive a frozen `IRReader`; rewrite callbacks receive a mutation-only `RewriteEdit`. The scheduler retains prepare/commit authority and seals callback access before semantic acceptance.

## Extension and trust boundaries

The package imposes a common logical inspection/edit protocol, not a physical storage model or universal semantic type system. Adapter callbacks, registered predicates, rewrite implementations and semantic verifiers are trusted TypeScript code. Read-only/mutation-only facades constrain the capabilities passed to callbacks; they are not a JavaScript sandbox against code holding unrelated references.

The revision store is in memory. Traces can be exported, but process recovery, distributed transactions, graph indexes, unbounded streaming and persistent cache services are separate concerns. There is no e-graph engine, SSA package, formal prover or automatic derivation of domain invariants.
