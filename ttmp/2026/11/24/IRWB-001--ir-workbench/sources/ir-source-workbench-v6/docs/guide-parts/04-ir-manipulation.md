## 4. Inspecting and transforming native IRs

The third layer gives algorithms a common way to observe and edit representations. A scene optimizer can find repeated definitions, an expression optimizer can recognize repeated operands, and a constraint optimizer can follow variable dependencies using the same inspection and transaction machinery. Their native data structures and semantic checks remain separate.

This chapter builds a real transformation of `(x + 0) + 0` into `x`. The complete, executable tutorial is `src/guide/02-ir-manipulation.ts`. From the workspace root, run:

```sh
npm run build
node dist/guide/02-ir-manipulation.js
```

The tutorial asserts its results. It finds two matches, commits two checked rewrites, retains three revisions, and traces the original output to `x`. Its inverse trace identifies `first`, `second`, and `x` as contributors to the final entity. It also demonstrates a prepared draft that never publishes and rejected stale references. The implementation sources for this chapter are `src/ir/`, the expression adapter in `src/ir-examples/expressions.ts`, and the executable tutorial itself.

### 4.1 Keep native storage behind an adapter

The tutorial's native expression value is a keyed arena:

```ts
const source: ExpressionProgram = {
  root: 'second',
  nodes: {
    x: { op: 'variable', name: 'x' },
    zero: { op: 'constant', value: 0 },
    first: { op: 'add', args: ['x', 'zero'] },
    second: { op: 'add', args: ['first', 'zero'] }
  }
};
```

It contains ordinary operation records and operand IDs. The expression adapter projects these into logical entities and typed relationships when the generic layer needs them. Scenes use definition and instance tables; meshes use packed coordinate and face arrays; constraints use sparse coefficients. Those representations do not have to adopt the expression arena's layout.

An `IREntity` has `id`, `kind`, and `attributes`. An `IRRelation` has a stable `id`, a domain-specific `kind`, a shared `category`, `from` and `to` IDs, and optional `order` and `attributes`. `IRGraph` groups entities, relationships, and roots. This graph is the common inspection/edit projection. It is not automatically a valid standalone native program.

`IRAdapter<T>` identifies its own `id` and `version`, the native `kind` and `schemaVersion`, a description, and a `relationKinds` mapping. Its callback interface is:

| Adapter callback | Result and responsibility |
| --- | --- |
| `entities(value: T): Iterable<IREntity>` | Enumerate logical entities. |
| `resolve(value: T, entity: string): IREntity \| undefined` | Agree with enumeration for every existing ID. |
| `relations(value: T): Iterable<IRRelation>` | Enumerate typed edges with existing endpoints. |
| `describe(value: T, entity: string): EntityDescription` | Supply a human-readable label and optional detail/statistics. |
| `roots?(value: T): readonly string[]` | Specify roots; otherwise derive containment roots. |
| `validate?(value: unknown): void` | Reject malformed native data. |
| `rebuild?(base: T, graph: IRGraph): T` | Translate the edited projection back into native storage. |
| `operation?(value: T, entity: string): Operation \| undefined` | Expose an operation name and ordered operand IDs. |
| `serialize?(value: T): string` | Encode the native representation. |
| `deserialize?(text: string): T` | Decode it; must accompany `serialize`. |
| `visualize?(value: T, selection: readonly string[]): IRVisualization` | Return a portable visualization kind and data. |

`defineAdapter` snapshots metadata and callback identities. Projecting or opening an artifact rejects duplicate logical IDs, undeclared relationship types, dangling endpoints, invalid roots, and disagreement between resolution and enumeration. A rewritable adapter must supply both `rebuild` and `validate`. Rebuilding must reproduce the complete edited entity/relationship projection; silently discarding an unsupported edit is an error. Native roots are derived from the rebuilt value and included in the resulting difference.

Capabilities describe what these methods actually provide. Every adapter supports `Traversable`, `Queryable`, and `Diffable`. Optional methods add `Verifiable`, `Rewritable`, `Serializable`, `Visualizable`, and `Operations`. Adapter callbacks are synchronous; entity and relationship enumeration may use synchronous iterators. A class-based implementation should be wrapped in a plain adapter definition with own callback properties.

| Construction and registration API | Return type |
| --- | --- |
| `defineAdapter<T>(definition: IRAdapter<T>)` | `IRAdapter<T>` |
| `describeAdapter(adapter: IRAdapter<any>)` | `AdapterDescriptor` |
| `createIRArtifact<T>(adapter: IRAdapter<T>, id: string, value: T)` | `Artifact<T>` |
| `validateIRArtifact<T>(adapter: IRAdapter<T>, artifact: Artifact<T>)` | `Artifact<T>` |
| `deserializeIR<T>(adapter: IRAdapter<T>, id: string, text: string)` | `Artifact<T>` |
| `openIR<T>(artifact: Artifact<T>, adapter: IRAdapter<T>, store?: IRStore)` | `IRView<T>` |
| `AdapterRegistry.register<T>(definition: IRAdapter<T>)` | `IRAdapter<T>` |
| `AdapterRegistry.get<T>(id: string, version: string)` | `IRAdapter<T>` |
| `AdapterRegistry.describe()` | `readonly AdapterDescriptor[]` |

Changing a registered adapter under the same version tuple is rejected. Identical registrations can be reused. Artifact creation captures finite immutable data and computes content and revision hashes; opening an artifact verifies those hashes instead of trusting supplied strings.

### 4.2 Query a revision, and choose the right relationships

Open the arena with a shared revision store:

```ts
const store = new IRStore();
const artifact = createIRArtifact(
  expressionAdapter, 'guide.expression', source
);
const before = openIR(artifact, expressionAdapter, store);
const output = before.ref('second');
```

`output` is `{artifact, revision, entity}`. A local string such as `'second'` is convenient inside one bound view. A qualified reference is necessary when recording evidence or moving between views: the same entity ID in another revision is not interchangeable. The view carries its `artifact`, `adapter`, `descriptor`, and `capabilities`. Old views stay readable after a commit. `oldView.at(committedArtifact)` obtains a new view through the same adapter and store; it cannot silently retain an unpublished candidate.

Relationship categories answer different questions:

| Category | Example question |
| --- | --- |
| `containment` | Which objects structurally belong to this program or scene? |
| `dependency` | Which operands or variables does this entity use? |
| `binding` | Which shared definition does this occurrence reference? |
| `adjacency` | Which mesh entities are neighbors? |
| `provenance` | Which explicitly modeled origin relationship is present? |

The expression adapter's program contains all arena nodes, while `operand` edges describe nested computation. Therefore, `children(program)` lists membership; `dependencies(sum)` follows computation. Treating both relations as one undifferentiated graph would change the meaning of an inner-first transformation.

The following tables use `Target = EntityTarget`, `Targets = readonly EntityTarget[]`, `Names = readonly string[]`, and `Attributes = Readonly<Record<string, unknown>>` as typography abbreviations, not additional exported types. `Direction` abbreviates `'incoming' | 'outgoing' | 'both'`; `Order` abbreviates `'pre' | 'post' | 'breadth'`.

| `IRView<T>` observation method | Return type |
| --- | --- |
| `ref(target: Target)` | `IRRef` |
| `entities()` | `readonly IRRef[]` |
| `resolve(target: Target)` | `IREntity` |
| `describe(target: Target)` | `EntityDescription` |
| `relations(target?: Target, direction?: Direction)` | `readonly IRRelation[]` |
| `operation(target: Target)` | `Operation \| undefined` |
| `graph()` | `IRGraph` |
| `find(predicate: (entity: IREntity, ref: IRRef) => boolean)` | `readonly IRRef[]` |
| `serialize()` | `string` |
| `visualize(selection?: Targets)` | `IRVisualization` |

`relations()` without a target returns all edges. With a target, its default direction is `both`. Unsupported serialization or visualization fails explicitly. `find` requires a synchronous Boolean predicate; frozen entities cannot be edited through its arguments.

| Navigation method | Return type and scope |
| --- | --- |
| `walk(options?: WalkOptions)` | `readonly WalkVisit[]`; cycle-safe traversal. |
| `children(target: Target)` | `readonly IRRef[]`; outgoing containment. |
| `parents(target: Target)` | `readonly IRRef[]`; incoming containment. |
| `successors(target: Target, relation?: string \| Names)` | `readonly IRRef[]`; outgoing selected kinds, or all kinds when omitted. |
| `predecessors(target: Target, relation?: string \| Names)` | `readonly IRRef[]`; reverse selected kinds. |
| `ancestors(target: Target, options?: {maxNodes?: number})` | `readonly IRRef[]`; transitive containment parents. |
| `dependencies(target: Target, options?: DependencyOptions)` | `readonly IRRef[]`; dependency and binding closure by default. |
| `subgraph(selection: Targets, options?: SubgraphOptions)` | `IRSubgraph`; selected logical projection. |

`WalkOptions` contains `order`, `roots`, `relations`, `direction`, `maxNodes`, and `maxDepth`. Defaults are pre-order, outgoing containment, and node/depth limits of 10,000. Without explicit roots, disconnected components are included. `DependencyOptions` adds `transitive`—default `true`—and selected `relations`/`maxNodes`. `SubgraphOptions.closure` is `'none'`, `'dependencies'`, or `'connected'`; the default is the induced selection without closure. Its optional relation filter determines included edges.

These traversal methods also have exported function forms with the view as their first argument. Exhausting a bound throws `IRBudgetError`; a partial traversal is not returned as a complete answer.

### 4.3 Match structures and inspect the evidence

The tutorial recognizes an addition whose second operand is the constant zero:

```ts
const addZero = pattern(capture('sum', op(
  'add', capture('term'),
  entity('expression.constant', { value: 0 })
)));
const found = matchAll(addZero, before, {
  order: 'post', relations: ['operand']
});
```

The two roots are `first` and `second`, in that order. Each match binds `sum` and `term` to exact revision references. `op` checks operation name, arity, and ordered operands through the adapter; it does not inspect arbitrary native field names.

| Pattern constructor | Return type |
| --- | --- |
| `entity(kind?: string, attributes?: Attributes)` | `NodePattern` |
| `op(name: string, ...operands: NodePattern[])` | `NodePattern` |
| `capture(name: string, inner?: NodePattern)` | `NodePattern` |
| `sameAs(name: string)` | `NodePattern` |
| `pattern(nodes: NodePattern \| Readonly<Record<string, NodePattern>>)` | `PatternBuilder` |
| `distinct(...names: string[])` | `PatternCondition` |
| `equalContent(...names: string[])` | `PatternCondition` |
| `relation(kind: string, from: string, to: string)` | `PatternCondition` |
| `where(predicate: VersionRef, params?: unknown)` | `PatternCondition` |
| `new PatternBuilder(descriptor: PatternDescriptor)` | `PatternBuilder` |
| `PatternBuilder.where(condition: PatternCondition)` | New `PatternBuilder` |
| `PatternBuilder.toJSON()` | `PatternDescriptor` |
| `describePattern(input: PatternInput)` | `PatternDescriptor` |

`entity` tests the supplied attribute subset; each supplied nested value is compared completely. `sameAs` means the same entity identity, including when used as a forward equality constraint on a declared capture. Different names may bind the same entity until `distinct` forbids it.

`equalContent` compares kind, complete attributes, and—when available—operation name and ordered operand IDs. It ignores the entity's own ID and incoming edges. It does not recursively prove equivalent subgraphs or equivalent geometry. For stronger domain meaning, register a versioned predicate, then reference it with `where({id, version}, params)`. The constraint example does this to compare normalized sparse equations.

| Query API | Return type |
| --- | --- |
| `match(input: PatternInput, view: IRReader<any>, options?: MatchOptions)` | `PatternMatch \| undefined` |
| `matchAll(input: PatternInput, view: IRReader<any>, options?: MatchOptions)` | `readonly PatternMatch[]` |
| `explainMatch(found: PatternMatch)` | `MatchExplanation` |
| `explainMatch(input: PatternInput, view: IRReader<any>, target?: Target, options?: MatchOptions)` | `MatchExplanation` |
| `searchPattern(view: IRReader<any>, input: PatternInput, options?: MatchOptions, firstOnly?: boolean)` | `PatternSearch` |
| `orderedCandidates(view: IRReader<any>, order?: Order, relations?: Names)` | `readonly IRRef[]` |

`match`, `matchAll`, and the query form of `explainMatch` also accept view-first argument order. `IRView` satisfies `IRReader`. A builder's `descriptor` is finite data, so serialized patterns can be restored and queried independently of their construction code.

`MatchOptions` supplies exact candidate `roots`, traversal `order`, `relations`, `registry`, `maxSteps`, and `maxMatches`. In a graph pattern, capture names are assigned in lexical order; its first capture determines the root. Later captures can search the whole representation. Defaults allow 100,000 matching steps and 10,000 matches. `matchAll` either completes or throws `PatternBudgetError`, whose `partial` results are explicitly incomplete. `match` can stop earlier because its contract asks for only one result.

Every `PatternMatch` includes `artifact`, `root`, `bindings`, `pattern`, `evidence`, `steps`, and a stable `key`. Evidence records which kind, attribute, arity, equality, or predicate checks passed. Failure explanations retain a candidate's mismatch evidence; they are diagnostic traces rather than formal proofs of impossibility.

| `PatternPredicateRegistry` method | Return type |
| --- | --- |
| `register<T, P>(definition: PatternPredicateDefinition<T, P>)` | `this` |
| `get(reference: VersionRef)` | `PatternPredicateDefinition<any, any>` |
| `descriptors()` | `readonly PatternPredicateDescriptor[]` |
| `snapshot()` | `PatternPredicateRegistry` |

A predicate definition has `id`, `version`, `description`, and `test({view, bindings}, params)`, returning a Boolean or `{pass, reason}`. Queries snapshot registry callbacks. Async predicates are rejected, and callback exceptions remain errors; they do not quietly mean “no match.”

### 4.4 Express the change, then let the transaction publish it

The replacement redirects consumers of the addition to its surviving operand, removes the addition, and records both entities as contributors:

```ts
const eliminateAddZero = rewrite<ExpressionProgram>({
  id: 'guide.eliminate-add-zero', version: '1', match: addZero,
  description: 'Replace x + 0 in the integer polynomial fragment',
  replace(found, edit) {
    const { sum, term } = found.bindings;
    edit.redirectReferences(sum, term, {
      relations: ['operand', 'result']
    });
    edit.remove(sum);
    edit.correspond([term, sum], term, 'eliminated-add-zero');
  },
  preserves: [{ id: 'guide.same-polynomial', version: '1' }]
});
```

The correspondence call after removal is valid: its source IDs resolve against the immutable base, while target IDs resolve against the draft. A merge can therefore name a removed source without pretending that it still exists in the output.

`view.beginEdit(options?: EditOptions<T>): IREdit<T>` is the direct transaction entry point. `EditOptions` has `label` and optional `verify`. Its mutation API is:

| Edit signature | Behavior |
| --- | --- |
| `insert(entity: IREntity): IRRef` | Insert a unique ID. Its returned handle is draft-local. |
| `replace(target: Target, entity: IREntity): void` | Preserve ID; replace kind/attributes. |
| `update(target: Target, attributes: Attributes): void` | Shallow merge attributes. |
| `remove(target: Target): void` | Remove the entity and incident edges, without cascading other entities. |
| `connect(from: Target, relation: string \| RelationSpec, to: Target): string` | Add a typed edge and return its ID. |
| `disconnect(relationId: string): void` | Remove one exact edge. |
| `disconnect(from: Target, kind: string, to: Target): void` | Remove matching endpoint edges. |
| `redirectReferences(from: Target, to: Target, options?: RedirectOptions): void` | Redirect selected edges; default is incoming dependency/binding. |
| `correspond(from: Target \| Targets, to: Target \| Targets, relation?: string): void` | Record origin association, including empty endpoints. |

`RelationSpec` contains required `kind` and optional `id`, `order`, and `attributes`. Supply an ID compatible with native reconstruction when the adapter derives IDs from structural roles. `RedirectOptions` selects `relations` and `direction`; containment and adjacency are not redirected implicitly. An inserted handle carries the base revision but is usable only inside its draft. Obtain a normal output reference from the committed view.

| Transaction lifecycle method | Return type and effect |
| --- | --- |
| `preview()` | `IRGraph`; immutable draft projection. |
| `prepare()` | `TransformationResult<T>`; seal, rebuild, validate, compute changes/correspondence, without publishing. |
| `commit()` | `Promise<TransformationResult<T>>`; verify and atomically publish. |
| `rollback(reason?: string)` | `void`; discard an uncommitted draft. |
| `view.at(artifact: Artifact<T>)` | `IRView<T>` over an already retained revision. |

`TransformationResult` contains `artifact`, `changes`, `correspondence`, and `diagnostics`. Preparation verifies the complete requested projection against the rebuilt native value. Commit checks the current head again after awaited verification, so a second writer cannot be overwritten by a slow first writer. A generation counter also detects an intervening no-op commit or an A→B→A content cycle. These guarantees apply to writers sharing the same in-memory `IRStore`.

The semantic gate has this exact shape:

```ts
verify(
  candidate: TransformationResult<T>,
  before: Artifact<T>
): EditAcceptance | Promise<EditAcceptance>
```

Its acceptance object has synchronous `commit(): void` and `rollback(reason?: string): void`. Checks may await; final acceptance/publication does not. The semantic manager's prepared transformation implements this protocol. If verification throws before returning an acceptance, the verifier must discard any staging it created; after receiving an acceptance, the edit transaction owns commit/rollback.

The tutorial gate compares `expressionPolynomial(candidate.artifact.value)` with `expressionPolynomial(before.value)` and records acceptance only inside `commit`. This is an actual equality check for the bounded integer-coefficient fragment, distinct from a `preserves` declaration and from checking a few numeric samples. It does not claim a general floating-point equivalence theorem or a formal proof certificate.

Rewrite callbacks receive a narrower `RewriteEdit`: mutation methods, `base`, `state`, and `preview`, with no lifecycle methods. Their mutation lease expires when the replacement settles, before verification. Guards, predicates, and replacements receive a frozen `IRReader` without `beginEdit` or `at`. These boundaries prevent accidental early publication. Registered TypeScript remains trusted code; closures holding unrelated application resources are outside this capability boundary.

### 4.5 Choose a schedule and interpret its stopping condition

Local rewriting and scheduling are separate. The tutorial uses:

```ts
const optimized = await innermost(before, eliminateAddZero, {
  relations: ['operand'], budget: 8, verify
});
```

This first eliminates `first`, re-matches the changed arena, and eliminates `second`. Both steps preserve the checked polynomial. Selecting `operand` matters: program containment is flat, whereas the computation is nested.

| Operator | Implemented scheduling semantics |
| --- | --- |
| `applyOnce` | Commit the first eligible changing match; skip rejected guards and no-ops. |
| `applyAll` | Snapshot the starting match frontier, then revalidate surviving binding tuples after each edit. Introduced matches are outside that sweep. |
| `topDown` | One initial pre-order sweep; at most one accepted replacement per surviving root. |
| `bottomUp` | The corresponding single post-order sweep. |
| `innermost` | Normalize one rule in post-order; restart matching after each accepted change. |
| `outermost` | Normalize one rule in pre-order; restart after each accepted change. |
| `saturate` | Normalize prioritized directed rules; restart at the first rule after a change. |

For the first six names, the overloads are identical:

```ts
operator<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>)
  : RewriteSchedule<T>
operator<T>(view: IRView<T>, rule: RewriteRule<T>,
  options?: RewriteOptions<T>): Promise<RewriteResult<T>>
operator<T>(rule: RewriteRule<T>, view: IRView<T>,
  options?: RewriteOptions<T>): Promise<RewriteResult<T>>
```

For `saturate`, replace the single `rule` parameter with `rules: readonly RewriteRule<T>[]`. A reusable schedule has `descriptor` and `run(view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>`. The descriptor records the mode, rule references, budgets, and selected relationship names.

All schedules default to containment order. Explicit `relations` derive starting roots from zero incoming selected edges, then include disconnected and cyclic components deterministically. No-op replacements cannot drive an infinite loop. Normalizing schedules detect repeated content before publishing the repeating candidate and retain the last unique accepted revision. This is bounded directed rewriting, without an e-graph or equality-saturation search.

`RewriteOptions` includes `budget`, `registry`, `relations`, `verify`, synchronous `classifyRejection(error): boolean`, and `signal: AbortSignal`. Numeric `budget` sets `maxApplications`. The object form provides:

| Budget field | Default |
| --- | --- |
| `maxApplications` | 100 accepted changes |
| `maxAttempts` | 1,000 attempted matches |
| `maxMatchSteps` | 1,000,000 shared matching steps |
| `maxMatches` | 10,000 matches per query |

The first three permit zero; `maxMatches` must be positive. Reaching a limit is not evidence of convergence. At the application limit, the engine may still establish that no changing candidate remains; otherwise it returns `budget` with the uncommitted candidate when available.

`RewriteResult` reports `status`, `reason`, `applications`, `attempts`, `matchSteps`, immutable `steps`, and the final artifact/view. Outcomes distinguish `applied`, `converged`, `no-match`, `rejected`, `budget`, `cycle`, and `cancelled`. Unexpected failures throw `RewriteExecutionError` with the partial `result` and cause; false guards, `RewriteRejected`, or an explicit classifier identify expected rejection.

Each accepted step is a separate transaction. Earlier accepted steps remain if a later one fails. A step's provisional `result` can also appear on rejection, cycle, or budget records: **only step status `applied` means publication**. Preservation metadata is `unverified` or `host-accepted`; consult the host's actual semantic evidence for what was checked. Persist a schedule result without its live `view`.

| Rule and execution API | Return type |
| --- | --- |
| `rewrite<T>(definition: RewriteDefinition<T>)` | `RewriteRule<T>` |
| `RewriteRegistry.register<T>(rule: RewriteRule<T>)` | `this` |
| `RewriteRegistry.get<T>(ref: VersionRef)` | `RewriteRule<T>` |
| `RewriteRegistry.descriptors()` | `readonly RewriteDescriptor[]` |
| `RewriteRegistry.snapshot()` | `RewriteRegistry` |
| `executeRewrites<T>(view: IRView<T>, rules: readonly RewriteRule<T>[], mode: RewriteMode, options?: RewriteOptions<T>)` | `Promise<RewriteResult<T>>` |
| `readIR<T>(view: IRReader<T>)` | `IRReader<T>` |

A rule definition has `id`, optional `version`/`description`, `match`, optional synchronous `guard(match, reader)`, `replace(match, edit, reader)`, and optional `preserves: readonly VersionRef[]`. Replacements may be awaited; guards return a Boolean or `{accept, reason?}`. Registry versions cannot be redefined.

### 4.6 Compare revisions and follow origins

Differences answer what changed. Correspondence answers what an entity became or which entities contributed to it. These are separate questions: merging a definition removes an ID, redirects several bindings, and associates multiple source definitions with one survivor.

`diff` compares logical entity content, relationships, and roots, even across different adapters. It does not infer semantic equivalence. `affectedEntities` includes changed entity references, changed edge endpoints, and changed roots, qualified by their before/after revisions. The transaction's operation log records requested edits; its calculated difference records their actual effect.

| Difference API | Return type |
| --- | --- |
| `diff(before: IRView<any>, after: IRView<any>)` | `ChangeSet` |
| `diffGraphs(before: IRGraph, after: IRGraph, from: RevisionRef, to: RevisionRef, operations?: readonly EditOperation[])` | `ChangeSet` |
| `affectedEntities(changes: ChangeSet)` | `readonly IRRef[]` |

An `EntityCorrespondence` names exact source and target revisions, their complete entity universes, and entries `{from: string[], to: string[], relation: string}`. Every source and target must be accounted for. An empty source represents creation; an empty target represents removal. Empty-to-empty entries are invalid.

A grouped entry denotes a Cartesian relation. Thus `[a,b] → [c,d]` means all four associations, not just `a→c` and `b→d`. Use separate entries for the latter. The tutorial's `[term,sum] → [term]` is a many-to-one relation; a face split would use one-to-many. Ordinary relational composition joins through an intermediate entity:

```text
(a, c) belongs to S composed with R
exactly when some b has (a, b) in R and (b, c) in S.
```

Creation and deletion witnesses supplement that ordinary relation. Composition retains their surviving endpoints; an entity created and subsequently deleted has no endpoint to report. Intermediate artifact ID, revision, and complete entity universe must agree. Equal-looking IDs in a different revision are insufficient.

| Correspondence API | Return type |
| --- | --- |
| `makeCorrespondence(from: RevisionRef, to: RevisionRef, sourceEntities: Names, targetEntities: Names, explicit?: readonly CorrespondenceEntry[])` | `EntityCorrespondence` |
| `validateCorrespondence(input: EntityCorrespondence)` | `EntityCorrespondence` |
| `composeCorrespondence(first: EntityCorrespondence, second: EntityCorrespondence, options?: {maxPairs?: number})` | `EntityCorrespondence` |
| `invertCorrespondence(input: EntityCorrespondence)` | `EntityCorrespondence` |
| `traceEntity(start: IRRef, throughRevisions: readonly EntityCorrespondence[], options?: {maxRefs?: number})` | `EntityTrace` |

`makeCorrespondence` fills unmentioned retained IDs, additions, and removals. An explicitly reassigned origin can leave a surviving target with an `unmapped-origin` witness; explicit association does not magically preserve identity. Composition and tracing default to 100,000 pairs/references and fail explicitly on exhaustion.

The tutorial collects only applied results and follows their chain:

```ts
const chain = committed.map(result => result.correspondence);
const composed = composeCorrespondence(chain[0], chain[1]);
const traced = traceEntity(before.ref('second'), chain);
const origins = traceEntity(after.ref('x'), [
  invertCorrespondence(composed)
]);
```

`traced.current` contains `x`. `origins.current` contains `first`, `second`, and the original `x`. Inversion recovers historical associations; it cannot reconstruct discarded native data or execute an undo. Tracing retains branching and removal evidence at each step. For competing compiler branches, first select a contiguous recorded path; unrelated branch correspondences are not one chain.

Finally, an origin relation does not prove a preservation claim. Transferring an analysis across revisions still requires the semantic layer's justification. Likewise, an entity with no descendant may have been intentionally eliminated, not lost by a broken visualization.

### 4.7 Lower-level reference and practical boundaries

The revision store exposes history and head inspection, not a public publication bypass:

| `IRStore` API | Return type |
| --- | --- |
| `retain<T>(artifact: Artifact<T>)` | `Artifact<T>`; seed a lineage or retrieve an exact retained revision. |
| `get<T>(ref: RevisionRef)` | `Artifact<T>` |
| `head<T>(id: string)` | `Artifact<T>` |
| `revisions(id: string)` | `readonly Artifact[]` |
| `generation(id: string)` | `number` |
| `assertHead(base: Artifact, generation?: number)` | `void`; reject stale ownership. |

An existing lineage cannot acquire an arbitrary new revision through `retain`; new revisions enter through edit transactions. Storage is process-local and in memory. Export traces and source for persistence; distributed publication, recovery, and persistent indexing are separate extensions.

Adapter authors and infrastructure extensions also have these projection helpers:

| Helper signature | Return type |
| --- | --- |
| `project<T>(adapter: IRAdapter<T>, value: T)` | `IRGraph` |
| `validateEntity(entity: IREntity)` | `IREntity` |
| `validateGraph(adapter: IRAdapter<any>, input: IRGraph)` | `IRGraph` |
| `compareRelations(a: IRRelation, b: IRRelation)` | `number` |
| `relationFilter(view: IRView<any>, kinds?: Names)` | `Set<string> \| undefined` |
| `revisionRef(artifact: {id: string; revision: string})` | `RevisionRef` |
| `sameRevision(a: RevisionRef, b: RevisionRef)` | `boolean` |
| `refKey(ref: IRRef)` | `string` |
| `compareText(a: string, b: string)` | `number` |

The barrel also exports these validation utilities from `src/ir/common.ts`:

| Utility signature | Return/assertion |
| --- | --- |
| `nonempty(value: unknown)` | `value is string` |
| `requireText(value: unknown, label: string)` | `asserts value is string` |
| `requireRecord(value: unknown, label: string)` | `asserts value is Record<string, unknown>` |
| `limit(value: number \| undefined, fallback: number, name: string, allowZero?: boolean)` | `number` |
| `synchronous<T>(value: T, label: string)` | `T` |
| `syncFunction(fn: Function, label: string)` | `void` |

Domain clients normally use adapter/view APIs, which already apply these checks. Error types distinguish `IRError`, `IRBudgetError`, `PatternBudgetError`, `RewriteRejected`, and `RewriteExecutionError`.

When adding a representation, first make enumeration, resolution, native validation, and reconstruction agree. Then choose meaningful named relationships, author a small rule, inspect its actual change set and origins, and attach the domain check that makes publication acceptable. The tutorial demonstrates that progression with executable assertions; `tests/ir-foundation.test.mjs` and `tests/ir-rewriting.test.mjs` cover the failure cases that the happy-path walkthrough intentionally does not trigger as unhandled errors.
