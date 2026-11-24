## 5. Programming compilation strategies

A compilation strategy describes **which algorithms to run, how to compose their
results, and how to choose among alternatives**. It is itself an immutable,
inspectable program. Keep three different programs distinct when designing a
compiler:

| Program | Example | Owner |
| --- | --- | --- |
| Object program | A scene, expression, mesh, or constraint system | Domain language |
| Compilation strategy | Build alternatives, check bounds, select a candidate | Strategy IR |
| Algorithm implementation | Redirect references or simplify a polygon fan | Versioned callback |

Changing a scene definition changes the object program. Changing the allowed
mesh error changes strategy policy. Fixing the simplifier changes its
implementation and requires a new algorithm version. These changes have
different identities and different debugging evidence.

The Strategy IR does not prescribe a universal artifact representation or own a
compiler cache. A registered algorithm may invoke a compiler task, query semantic
analysis, or run a generic rewrite schedule. Its return value becomes strategy
data. The existing `src/ir-examples/lab.ts` connects all these layers; the runnable
guide example below also shows how to compose the reusable layers without a
compiler runtime host.

### 5.1 Plans and versioned algorithms

Import the public strategy API from `src/strategy/index.ts`. A `StrategyPlan`
contains `formatVersion: 1`, an `id`, a `root` node, optional `description`, and
optional `requirements`. Every node has a unique `id`; references to executable
code contain an algorithm `id` and exact `version`.

`algorithm(id, version = '1')` constructs a reference. It does not register code.
`new AlgorithmRegistry().register(definition)` installs a callback with
`id`, `version`, `kind`, `description`, and `run(ctx, input, args)`. The six kinds
are `transform`, `analysis`, `predicate`, `selector`, `invariant`, and `metrics`.
An `apply` node requires a transform; using an analysis reference there is a
validation error.

The registry provides `get(ref, kind?)`, `has(ref, kind?)`, `list()`, and
`snapshot()`. Registering the same ID/version twice is rejected. Execution takes
a registry snapshot, so later registration cannot change an in-flight plan.
Versioning remains an application responsibility: the registry does not derive
an implementation version from a function's source text.

`plan(id, root, description?, requirements?)` validates and freezes a plan.
The optional `requirements` pin additional algorithms used transitively by a
host integration. This is useful when a plan directly references a composite
algorithm whose implementation depends on other registered capabilities.

### 5.2 The thirteen strategy operators

The following are the actual builder calls. They return data nodes; evaluation
happens through `execute` or `executeOrThrow`.

| Builder | Operational meaning |
| --- | --- |
| `apply(id, algorithmRef, options?)` | Call a transform with resolved input and arguments; return its result. |
| `sequence(id, ...steps)` | Feed each result to the next child; return the last result. An empty sequence is an identity. |
| `parallel(id, steps, options?)` | Run children against the same input in isolated binding frames; return results in declared order. |
| `fork(id, branches, options?)` | Run named alternatives and return a `strategy.candidates` value, retaining expected rejections. |

`fork` takes entries shaped as `{name, strategy}`. It differs from `parallel`
because a recoverable rejection is recorded as a rejected candidate rather than
discarding the entire candidate set. An unexpected implementation failure still
fails the fork.

| Builder | Operational meaning |
| --- | --- |
| `chooseBest(id, candidates, objective, options?)` | Evaluate a candidate-producing child, filter by metric constraints, and return the best feasible value. |
| `conditional(id, predicate, then, otherwise, options?)` | Require a Boolean predicate result, execute one branch, and record the other as skipped. |
| `attempt(id, body, fallback, options?)` | Run a fallback only for an explicit recoverable rejection matching the optional code list. |

The `objective` is `{metric, direction: 'min' | 'max'}`. Constraints are
`{metric, op, value}`, with `op` one of `<=`, `>=`, `<`, `>`, or `==`.
`chooseBest` obtains a finite numerical metric map from its `metrics` algorithm,
or from the candidate value's `metrics` field. Missing or nonfinite metrics are
errors. Equal objective values are resolved by candidate name in code-unit
lexicographic order. `decisionAs` can bind the complete selection evidence,
including rejected and infeasible alternatives.

| Builder | Operational meaning |
| --- | --- |
| `repeatUntilStable(id, body, options)` | Repeat until adjacent identities agree; diagnose cycles and exhausted iteration limits. |
| `forEach(id, body, options)` | Select a bounded array of items, run the body for each, and preserve result order. |

`repeatUntilStable` requires `maxIterations`; its optional `identity` is an
analysis algorithm. The default treats an artifact's kind, schema version, and
revision as its semantic identity, so changing only its logical artifact name
does not prevent convergence. Other values use their complete finite-data
content. A repeated nonadjacent identity is a cycle, not a fixed point.

`forEach` requires `maxItems`. Supply either a `selector` algorithm or an `items`
template; the current value is the default when neither supplies another array.
The body receives the item as its current value and also exposes item/index
references. `concurrency` bounds local scheduling.

| Builder | Operational meaning |
| --- | --- |
| `require(id, analysis, as, options?)` | Compute an analysis, bind its value under `as`, and preserve the current value. |
| `verify(id, invariant, options?)` | Check a Boolean or `{ok, reason?, evidence?}` result; preserve the current value on success. |
| `checkpoint(id, name, data?, options?)` | Record resolved evidence without changing the current value. |
| `scope(id, name, body, options?)` | Give nested execution a named boundary and isolate its bindings. |

To avoid confusion with other meanings of `require`, the guide imports the
strategy builder as `requireAnalysis`. It is unrelated to JavaScript module
loading and distinct from the semantic context's property requirement method.

Where accepted by a builder, common options are `label` and `bind`. Call options
are `input` and `args`; otherwise the algorithm receives the current value and
an empty argument object. `parallel` and `fork` accept local `concurrency`;
`attempt` accepts `codes`; `verify` accepts a rejection `code`. The `sequence`
builder takes only an ID and variadic children, not an options object.

### 5.3 Value references and binding scope

Templates recursively contain ordinary finite values plus explicit references.
`ref(source, path?, name?)` supports these sources:

| Source | Value available at that point |
| --- | --- |
| `input` | The original execution input |
| `current` | The value entering the current node |
| `binding` | A named visible binding; use `binding(name, path?)` |
| `item`, `index` | The current `forEach` item and its zero-based index |
| `iteration` | The current one-based repeat iteration |

For example, `ref('input', ['source'])` selects a field of the original input;
`binding('baseline', ['triangles'])` selects an earlier analysis result. Paths
must name existing own properties. An absent path fails explicitly instead of
silently supplying `undefined`.

Sequential siblings share bindings created in their sequence's local frame.
Parallel branches, fork alternatives, scopes, and iteration bodies receive
isolated frames. A binding inside a nested composite does not leak outward;
bind the composite's result if the parent needs it. Validation checks reference
availability and scope before execution.

Use `literal(value)` when domain data legitimately contains `$ref` or `$literal`
keys. Without that wrapper, the template evaluator interprets those keys as
template syntax. Functions, cyclic objects, accessors, and nonfinite numbers do
not belong in plans or algorithm results.

### 5.4 Validate, edit, and persist a strategy

`validate(value, registry?)` returns `{valid, issues}`. Each issue identifies its
path, code, message, and applicable node ID. `assertValid` throws a
`PlanValidationError`. Validation covers structure, unique node IDs, bounded
operators, reference scope, and, with a registry, exact algorithm availability
and kind. `execute` performs this check before running callbacks.

The editing API operates on complete immutable plans:

| API | Result |
| --- | --- |
| `walk(plan, visitor?)` | Preorder visits containing node, parent, path, depth, and slot |
| `childNodes(node)` | Direct children with their structural slot names |
| `find(plan, idOrPredicate)` | The first matching node, or `undefined` |
| `replace(plan, id, node)` | A validated plan with the selected node replaced |
| `insertBefore` / `insertAfter` | Insert a sibling in a sequence, or create a fresh sequence wrapper |
| `remove(plan, id)` | Remove an optional collection child; reject removal of a root or required slot |
| `diff(before, after)` | Added, removed, changed, and moved node records |

Each edit preserves the previous plan and validates the resulting one. To remove
the behavior in a required slot, explicitly replace it with `sequence(id)`;
leaving a missing branch is invalid.

`serialize(plan, pretty = true)` produces canonical JSON interchange, while
`deserialize(text, registry?)` parses, validates, and freezes it. The workbench
renders and edits the same data as highlighted YAML. YAML presentation does not
change the strategy model or introduce executable functions into the plan.

### 5.5 Execution, budgets, and failure classification

`execute(plan, registry, input, options?)` returns an immutable
`StrategyExecution`, including the plan snapshot/revision, registered versions,
input, status, successful value or error, node execution records, and events.
Algorithm/runtime failures become trace statuses; invalid plans or options can
throw before execution begins. `executeOrThrow` additionally throws a
`StrategyExecutionError` for a non-successful execution, retaining the trace in
its `execution` field.

Options include `id`, `signal`, `maxSteps`, `maxDepth`, `maxConcurrency`, and
`onEvent`. Defaults are 100,000 node visits, depth 256, and concurrency 8.
Visits include skipped nodes. Operator-specific iteration/item limits apply in
addition to these global budgets. Concurrency is bounded asynchronous
scheduling, not automatic worker-thread parallelism. Cancellation is cooperative;
long-running algorithms must observe `ctx.signal`.

The algorithm context also supplies `record(label, data)`,
`link({taskId, invocationId?, cache?, artifact?})`, and
`reject(code, message, evidence?)`. Links connect strategy decisions to actual
compiler invocations. Contexts close when their callback returns.

Only `StrategyRejected` is an expected rejection. `ctx.reject` creates it;
failed strategy verification creates one as well. `attempt` never converts an
ordinary thrown bug into a successful fallback. A fork retains expected
rejections but propagates unexpected failures, and waits for already-started
sibling work before finishing. An observer exception is recorded as diagnostic
evidence and disables that observer; it does not rewrite the compilation result.

### 5.6 Walkthrough: a strategy with checked rewrites

Run the complete, strictly compiled example from the workspace root:

```sh
npm run build
node dist/guide/03-strategy-contracts.js
```

The source is `src/guide/03-strategy-contracts.ts`. The excerpts here are from
that file; its imports, registered callbacks, and helper definitions are part of
the runnable example. Its strategy counts arithmetic operations, normalizes an
expression, recounts, checks input/output equivalence, and records the comparison:

```ts
const original = plan('guide.checked-normalization', sequence('pipeline',
  requireAnalysis('count.before', algorithm('guide.cost'), 'before'),
  apply('normalize', algorithm('guide.normalize')),
  requireAnalysis('count.after', algorithm('guide.cost'), 'after'),
  verify('equivalence', algorithm('guide.equivalent'), {
    args: { before: ref('input') }
  }),
  checkpoint('cost.report', 'Arithmetic cost', {
    before: binding('before'), after: binding('after')
  })
));
```

The normalization callback uses the generic IR adapter and rewrite engine:

```ts
const result = await saturate(
  openIR(before, expressionAdapter),
  [expressionCSE, expressionDouble],
  { budget: 32, verify: acceptEdit }
);
```

Strategy scheduling and rewrite scheduling are different levels: the strategy
invokes one normalization algorithm; that algorithm schedules individual
matches and edits. `acceptEdit` checks each candidate before publication. Section
6 explains this boundary.

The example inserts a revision checkpoint with `insertAfter`, verifies the old
plan remains unchanged, serializes/deserializes the edited plan, and executes
it. Its assertions establish these results:

| Measurement | Verified result |
| --- | --- |
| Plan nodes before / after editing | 6 / 7 |
| Arithmetic operations before / after normalization | 5 / 4 |
| Applied rewrites / accepted edit contracts | 3 / 3 |
| Repeated analysis query | Same valid analysis record reused |
| Invalid follow-up edit | Rejected as `postcondition`; original revision retained |

The expression checker compares canonical polynomials with safe-integer
coefficients and records numerical samples. This is the declared semantics of
the example; it is not a claim that arbitrary floating-point expressions permit
the same algebraic substitutions.

Implementation references: `src/strategy/builders.ts`, `ir.ts`, `registry.ts`,
`validation.ts`, `editing.ts`, `serialization.ts`, and `interpreter.ts`.

## 6. Specifying semantic contracts

A transformation's type says what shape it consumes and produces. Its semantic
contract says **when it is applicable and what must be established before its
result is accepted**. Valid syntax alone does not establish geometric fidelity,
equivalent equations, or preservation of expression meaning.

The semantic module is independent of Strategy IR and generic IR storage.
Import it from `src/contracts/index.ts`. A strategy can call it directly; a
compiler can attach it to pass acceptance; an IR edit can defer publication until
it approves a candidate. Each integration uses the same definitions and evidence.

### 6.1 The eight definition APIs

Every definition has an `id`, `version`, and `description`. Factories freeze
definitions; callbacks remain explicitly supplied application code.

| Definition | Purpose and essential fields |
| --- | --- |
| `defineIR<T>` | An artifact kind/schema, with `validate(value)` |
| `defineType<T>` | A scalar or finite-data port type, with a runtime validator |
| `defineAnalysis<S,R>` | A computation with IR `input`, scalar `output`, `run`, optional effects and transfer rule |
| `defineProperty<S>` | A proposition about one `subject` IR, backed by a checking analysis |

| Definition | Purpose and essential fields |
| --- | --- |
| `defineInvariant<P>` | A relation over named typed `inputs`, implemented by `check` |
| `defineObjective<S>` | A numerical analysis and direction `min` or `max` |
| `defineEffect<T>` | Exact resource access: `resource`, `access`, and scalar `type` |
| `defineTransformation<I,O>` | Named ports, obligations, effects, cache policy, correspondence, and optional `run` |

An IR port receives an `Artifact<T>`; a scalar port receives `T` directly.
`PortValues<P>` captures that distinction in TypeScript, while runtime validation
also rejects missing or unexpected port names. Built-in scalar definitions
include `Integer`, `FiniteNumber`, `JsonValue`, and `Check`. The last represents
`{ok: boolean, reason?, evidence?}`.

`createArtifact(ir, id, value)` validates, copies, freezes, and hashes a value.
`validateArtifact(ir, artifact)` checks its kind/schema, payload, and hashes.
Supplying the expected kind next to changed data and an old revision is not
sufficient to pass validation.

`ContractRegistry.register` recursively registers referenced definitions.
Re-registering the same definition object is harmless; redefining its exact
ID/version with another object is rejected. `get`, `has`, and `list` provide
lookup and finite descriptors. `AnalysisManager` registers definitions as they
are used, so manual registration is optional for ordinary calls.

### 6.2 Named ports and transformation obligations

The included expression contract consumes `{input: ExpressionIR}` and produces
`{output: ExpressionIR}`. It requires a valid source, preserves validity, checks
the relation between old and new expressions, and requires an entity map. Its
important clauses are:

```ts
requires: [{
  property: expressionValid,
  subject: { from: 'inputs', port: 'input' }
}],
preserves: [{
  property: expressionValid,
  from: 'input', to: 'output', mode: 'check'
}],
ensures: [{
  invariant: expressionEquivalent,
  bindings: {
    before: { from: 'inputs', port: 'input' },
    after: { from: 'outputs', port: 'output' }
  }
}],
correspondence: [{
  id: 'entities', from: 'input', to: 'output',
  relation: 'generic-ir-edit'
}]
```

This is a declaration excerpt from `src/ir-examples/contracts.ts`, not a separate
program. The checker implementations in that file give the clauses their
meaning.

| Clause | What the manager does |
| --- | --- |
| `requires` | Check inputs when the semantic transaction begins; `execute` does this before its body. |
| `ensures` | Check output properties or input/output invariants before acceptance. |
| `establishes` | Check and record a newly established guarantee, with its own evidence phase. |
| `preserves` | Check the source property, then recheck or authorize transfer to a named output. |
| `correspondence` | Require named mappings with exact input/output revisions and any required relation. |
| `effects` | Authorize declared access through the resource port. |
| `cache` | Choose `pure`, `tracked`, or `never` body reuse policy. |

`ensures` and `establishes` both run real checks; their distinction expresses the
contract author's intent and remains visible in evidence. Neither creates a
true fact by assertion. `preserves` with `mode: 'check'` evaluates the target
property. With `mode: 'transfer'`, it requires a named correspondence and an
executable transfer verifier on the analysis definition.

A condition either applies a property to `{from, port}` or binds every named
invariant input to such a selector. Factories reject incompatible port kinds or
versions, missing invariant bindings, and preconditions that reference outputs.
For a relation such as “error from the original mesh is within tolerance,” use
an invariant binding both artifacts and the scalar tolerance.

### 6.3 Analysis, properties, and objectives

Create `new AnalysisManager(registry?, resourcePort?)` for a compilation session
or another deliberate lifetime. It owns reusable analysis results, facts,
executions, and evidence; it does not mutate an artifact's payload.

| Query | Result |
| --- | --- |
| `analyse(definition, artifact, params?)` | `AnalysisRecord<R>` with value, exact subject, dependencies, and validity |
| `hasAnalysis(definition, artifact, params?)` | Whether reusable evidence currently exists |
| `check(property, artifact)` | A `PropertyFact`, including a recorded false result |
| `checkInvariant(definition, namedInputs)` | Checked relational evidence |
| `evaluateObjective(objective, artifact)` | Numerical value, direction, and supporting analysis record |
| `properties(artifact)` | Revision-specific facts with current validity |
| `explainProperty(property, artifact)` | Availability, checker identity, evidence, and invalidation explanation |

A false `check` result is inspectable information. A contract requirement or
`ctx.require(property, artifact)` turns failure to establish a needed property
into rejection. Analysis parameters participate in identity; omitted parameters
default to `null`.

Inside a checker or body, `ContractContext.analysis` returns the typed **value**;
the manager's `analyse` returns the **record**. The context also provides `check`,
`require`, `checkInvariant`, `properties`, `explainProperty`, `readResource`,
`writeResource`, and `record`. Context calls track dependencies automatically.
Await asynchronous calls; escaping a context or starting work that finishes
after its owner closes is not a supported lifetime model.

An objective definition does not choose an optimization candidate. Its numerical
analysis supplies a measurement. A Strategy IR `metrics` callback can call
`evaluateObjective`, then expose that number under the metric name used by
`chooseBest`. This bridge keeps semantic measurement independent of search
policy.

### 6.4 Evidence, invalidation, and checked transfer

Evidence belongs to exact artifact IDs/revisions, kind/schema versions, and
definition versions. Analysis reuse also depends on parameters, transitive
analysis/property records, resource revisions, and invalidation epochs. A
matching payload alone does not authorize copying arbitrary facts between
different subjects.

| Assurance | Meaning |
| --- | --- |
| `declared` | An assertion was recorded; it cannot satisfy a requirement. |
| `checked` | The registered checker ran, or its still-valid exact evidence was reused. |
| `transferred` | A registered transfer verifier authorized an existing result for another revision. |
| `proof` | A property-specific external certificate verifier accepted supplied evidence. |

`declare(property, artifact, reason)` deliberately records unverified evidence;
it is not a way to bypass a checker. `recordProof(property, artifact, certificate)`
requires the property's `proofVerifier`. The framework records that external
trust boundary and contains no theorem prover.

`invalidate(analysisOrProperty, artifact, reason?)` advances an epoch and makes
dependent evidence unavailable. Invalidation also prevents a computation that
was already in flight from publishing a stale result. `snapshot()` returns
immutable manifests, histories, executions, and events with validity evaluated
at snapshot time.

To reuse a result across changed representations, first obtain a valid source
analysis, then call `preserve(analysis, from, to, correspondence, params?)`.
The analysis must define `transfer: {id, version, verify}`. Its verifier receives
the two artifacts, source record, and mapping; it must justify preserving the
**analysis value**, not merely observe that some entities have matching IDs.
Transferred evidence depends on the source record and the verifier's own
dependencies. Source invalidation therefore invalidates the transfer too.

Semantic correspondence uses `{id, from, to, relation, entities?, evidence}`.
The generic IR correspondence layer additionally provides total entity
universes, composition, inversion, and tracing. The guide's bridge converts that
structural mapping into a semantic correspondence; the polynomial invariant
separately checks meaning. Mapping data is not semantic proof.

### 6.5 Computational caching and semantic rechecking

`manager.execute(definition, inputs, options?)` runs a transformation's optional
`run(ctx, inputs)` body, which returns `{outputs, correspondence?}`. It can reuse
a cached body, then verifies current obligations. The default accepts the result
before returning. `cache: 'pure'` forbids declared resource effects;
`tracked` permits declared reads; writes require `never`.

Body dependencies and guarantee dependencies serve different purposes. If a
profile read changed the computed geometry, the body must run again. If only a
postcondition's permitted bound changed, the old geometry may be computationally
reusable but fail today's acceptance check. `execution.bodyDependencies` and
`bodyCacheable` expose this distinction.

An external compiler should check `manager.canReuseDependencies` and import a
reused body's complete manifest through `transaction.importBodyDependencies`.
Importing it retains resource permissions, revision stamps, and dependency links
for subsequent warm runs. The supplied pass integration does this at the
compiler's acceptance boundary; a cache hit never skips current contracts.

Fact-set introspection can depend on missing information as well as present
facts. Computations using `properties` or `explainProperty` conservatively
disable caching where that absence cannot be represented by ordinary dependency
edges. This prevents an apparently unchanged dependency list from hiding a
newly established fact.

### 6.6 Revisioned effects and atomic staged writes

An effect names one resource, access mode, and value type. The runnable guide
constructs an in-memory port and an exact read capability:

```ts
const resources = new MemoryResources({
  'guide:factor': 2, 'guide:accepted': 0
});
const effectManager = new AnalysisManager(undefined, resources);
const readFactor = defineEffect({
  id: 'guide.factor.read', version: '1', description: 'Scaling factor',
  resource: 'guide:factor', access: 'read', type: Integer
});
```

Its resource-driven scaling transformation declares that effect and
`cache: 'tracked'`. Repeating the same request reuses its body. Changing the
factor from 2 to 3 changes the resource revision, forces recomputation, and
produces a different output revision. These are asserted results in the guide
program, not simulated cache counters.

Permissions are checked transitively: calling a read-capable analysis does not
grant its enclosing transformation undeclared resource access. Cached analysis
reuse checks permissions too. Analyses and invariants may read but cannot
declare write effects.

Writes through `ctx.writeResource` are staged. Later reads in the transaction
see them; preconditions inspect the original state and postconditions can
inspect the staged state. Commit checks original physical revisions and applies
all writes atomically. In the guide, a rejected negative result leaves an export
counter at zero; the next accepted result increments it to one.

`ResourcePort` requires synchronous reads and an atomic synchronous
`commit(writes, expectedRevisions)`. `MemoryResources` supplies `read`, `set`,
`commit`, and `snapshot`. A custom host must provide the promised atomicity;
returning a Promise from commit is rejected. These capabilities govern the
explicit resource port. They cannot sandbox arbitrary callback code that writes
files or changes global state outside that port.

### 6.7 Coordinating semantic acceptance with IR publication

For an existing algorithm, begin a semantic transaction before exposing its
result. `beginTransformation(contract, inputs, options?)` checks requirements
and returns `inputs`, `context`, `execution`, `verify`, `rollback`, `fail`,
`settle`, and `importBodyDependencies`.

`await transaction.verify(outputs, correspondences?, {cached?})` validates the
candidate and returns a prepared object with `outputs`, `execution`, synchronous
`commit()`, `rollback(reason?)`, and `fail(error)`. Verification seals the body
context. Output facts and resource writes remain provisional until commit.

The guide passes prepared acceptance directly to the IR transaction:

```ts
async function acceptEdit(
  result: TransformationResult<ExpressionProgram>,
  before: Artifact<ExpressionProgram>
): Promise<EditAcceptance> {
  const transaction = await manager.beginTransformation(
    expressionContract, { input: before }
  );
  return transaction.verify(
    { output: result.artifact }, [correspondence(result)]
  );
}
```

The generic edit engine validates the native result, checks its exact base
revision, invokes this gate, and commits acceptance at its final publication
boundary. The helper must return the prepared object; calling a convenience
method that already commits would move semantic acceptance ahead of IR
publication.

This edit hook runs after candidate construction: it gates publication, not the
work already spent building a private draft. If a precondition must prevent an
expensive or effectful kernel from starting, begin the semantic transaction
before that kernel and return its prepared acceptance afterward. The compiler
pass integration uses such a pre-body policy hook. An already computed result
can be rejected, but its computation cannot be retroactively prevented.

`verifyTransformation(before, after, contract, correspondence?, options?)`
checks an already computed result and commits by default. Both it and `execute`
support `deferCommit: true`. In that mode the caller owns final acceptance;
the current `execute` implementation does not automatically populate its body
cache when the caller later commits the deferred object.

On failure, `rollback` discards provisional state; `fail` preserves the original
classification; `settle()` drains started semantic work for an asynchronous host
failure path. Discarded analysis/fact records remain in history as invalid
evidence. They cannot authorize later reuse. A successfully accepted transaction
cannot subsequently be relabelled failed or rolled back.

The guide deliberately changes an introduced multiplier from 2 to 3. Native
structure still validates, but polynomial equivalence fails. The edit reports
`postcondition`, retains the prior revision and multiplier, and leaves a rejected
semantic execution available for inspection.

### 6.8 Debugging across the boundaries

Follow identities and evidence in this order:

1. Find the strategy node and its execution status. Check which branch ran,
   which candidate won, and whether failure was expected rejection or a bug.
2. Follow its invocation link. Distinguish the original computation from a warm
   cache hit; inspect the dependency manifest and exact output revision.
3. Read the semantic execution's phases, definitions, subject revisions,
   assurance, and checker evidence. A declared claim is insufficient.
4. For a rewrite, inspect the pattern bindings, guard decision, transaction
   diff, and correspondence. A provisional candidate may be inspectable even
   though it was never committed.
5. If evidence was reused, follow its analysis/property/resource dependencies
   and invalidation reason. Fix the responsible definition or dependency;
   weakening a contract would change the accepted semantics.

Implementation references: `src/contracts/types.ts`, `definitions.ts`,
`registry.ts`, `analysis-manager.ts`, and `effects.ts`; the complete tested
composition is `src/guide/03-strategy-contracts.ts`.
