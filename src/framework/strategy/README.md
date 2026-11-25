# Strategy IR v1

This module is the domain-independent orchestration language in workbench v4. It is a complete implementation of the thirteen operators enumerated in the design. The executable plan is immutable, versioned JSON; functions remain in an explicit algorithm registry. The existing compiler remains responsible for task dependencies, output validation, artifact caching and provenance.

## Public API

Import the namespace to avoid confusing `require` or `parallel` with other APIs:

```ts
import * as S from './strategy/index.js';

const registry = new S.AlgorithmRegistry()
  .register({
    id: 'mesh.reduce', version: '1', kind: 'transform',
    description: 'Reduce a mesh with a recorded error bound',
    run: async (ctx, mesh, args) => {
      // An adapter may require an existing compiler task here.
      // ctx.link({taskId, invocationId, cache, artifact}) records that link.
      return reduceMesh(mesh, args);
    }
  });

const plan = S.plan('mesh-plan', S.sequence('main',
  S.apply('reduce', S.algorithm('mesh.reduce', '1'), {
    args: { tolerance: 0.01 }, bind: 'reduced'
  }),
  S.checkpoint('inspect', 'Reduced result', S.binding('reduced'))
));

const execution = await S.execute(plan, registry, mesh, {
  id: 'compilation-1', maxSteps: 10000, maxConcurrency: 4
});
if (execution.status !== 'succeeded') {
  console.error(execution.error, execution.records);
}
```

The example's `reduceMesh` is an application implementation, not an engine builtin. Real domain adapters and plans are in `src/strategy-examples/`.

### Algorithm registry

`new AlgorithmRegistry().register(algorithm)` registers an exact `(id, version)` pair. Registration cannot replace that pair. `get(ref, expectedKind?)`, `has(ref, expectedKind?)`, `list()` and `snapshot()` provide inspection and exact resolution. A plan is checked against all referenced algorithm versions, including unselected branches, before execution. `plan(id, root, description?, requirements?)` may additionally pin transitive host dependencies in its `requirements` manifest. The compiler examples populate this manifest from the complete task graph, so removing a direct `apply` node cannot silently upgrade a pass still required by another task. Intentional algorithm upgrades require updating the explicit version pins.

An algorithm has `id`, `version`, `kind`, `description` and `run(context, input, args)`. Its kind is one of `transform`, `analysis`, `predicate`, `selector`, `invariant` or `metrics`. Inputs, arguments and returned values must be finite, acyclic JSON data. Outputs are copied and frozen. Undefined, functions, nonfinite numbers, classes, accessors and cycles are rejected.

Algorithm context exposes `signal`, `executionId`, `nodeId`, `path`, `link(link)`, `record(label, data)` and `reject(code, message, evidence?)`. It closes when the algorithm returns. A late write throws without mutating the trace. Links identify actual compiler tasks and invocation IDs; cached invocation details can be attached rather than inferred from a plan.

### Values and lexical references

Arguments and explicit inputs are JSON templates. Ordinary objects/arrays are recursively copied. `ref('current', path?)` reads the current flow value; `ref('input', path?)` reads the initial input to the entire execution. `binding(name, path?)` reads a preceding binding. `ref('item')`, `ref('index')` and `ref('iteration')` are available only in their corresponding bodies. Paths use own object keys or array indices. Prototype path segments are forbidden.

`literal(value)` escapes data containing the reserved `$ref` or `$literal` keys. Plans contain no callback expressions. Predicates, selectors, metric computations and custom convergence identities are named versioned algorithms.

Every node may have `bind` and `label`. A binding publishes that node's result in its containing sequence. A sequence's local bindings are available to following steps in that sequence. Child branches, scopes, loop iterations and nested sequences have isolated local frames. To export a nested computation, bind its result on the composite node. `require` additionally creates its named analysis binding while preserving the current flow value.

### Operators

| Builder | Semantics |
| --- | --- |
| `apply(id, algorithm, options?)` | Run a transform on current or explicit `input`, with templated `args`; return its value. |
| `sequence(id, ...steps)` | Feed each result to the next step; execute an empty sequence as identity. |
| `parallel(id, steps, options?)` | Run independent branches from the same immutable input and isolated bindings; return ordered result array. |
| `fork(id, branches, options?)` | Run named alternatives from the same input; retain successful values and explicit rejected candidates in a `strategy.candidates` value. |
| `chooseBest(id, candidates, objective, options?)` | Execute its candidate-producing child; score every successful candidate, filter metric constraints and return the winning value. |
| `conditional(id, predicate, then, otherwise, options?)` | Require a boolean predicate; execute the selected branch and record the other as skipped. |
| `repeatUntilStable(id, body, options)` | Run the body repeatedly, carrying its result forward; stop only on identity equality. Bound is mandatory. Cycles and nonconvergence fail. |
| `forEach(id, body, options)` | Select an ordered item array using `items`, a selector, or current input. Run body on each item with item/index references; return ordered results. `maxItems` is mandatory. |
| `require(id, analysis, as, options?)` | Run an analysis and bind its result under `as`; return current input unchanged. |
| `verify(id, invariant, options?)` | Require boolean or `{ok, reason?, evidence?}`. False creates an explicit recoverable rejection; success preserves current value. |
| `checkpoint(id, name, data?, options?)` | Record data or current value as evidence and preserve current input. |
| `attempt(id, body, fallback, options?)` | Run body; only an explicit rejection matching optional `codes` activates fallback on the original input. |
| `scope(id, name, body, options?)` | Name and isolate a subcomputation; return its value, without leaking its local bindings. |

`chooseBest` options include `metrics`, `args`, `constraints`, `decisionAs`, `bind` and `label`. `decisionAs` publishes the immutable selection evidence in a named lexical binding while the node continues to return the winning value. It must differ from `bind`. Downstream materializers can receive that decision explicitly alongside the selected artifact, keeping attribution correct when several choices inspect the same candidates. Decision data includes the responsible node ID, objective, constraints, winner, alternatives and tie-breaking rule. Execution IDs remain in the trace rather than in compiler cache parameters. The metrics algorithm returns a numeric map. Without it, each candidate value must expose its map as `metrics`. Objective is `{metric, direction:'min'|'max'}`; constraints support `<`, `<=`, `>`, `>=` and `==` with finite thresholds. Missing/nonfinite metrics fail instead of quietly rejecting a candidate. Equal objectives use lexicographic candidate-name comparison by JavaScript code-unit order, independent of host locale. Rejected and infeasible alternatives, individual violations and winner are all retained.

The candidate child can be any node returning a `CandidateSet`, not just `fork`. This supports an item loop followed by an application algorithm that names its resulting candidates.

`repeatUntilStable` defaults to canonical finite-JSON identity. Artifact-shaped values with `id`, `revision`, `kind`, `schemaVersion` and `value` compare `(kind, schemaVersion, revision)` and ignore logical names. A custom `identity` analysis can project the application's semantic identity. The identity analysis is versioned and traced. Fixpoints are directed bounded iteration, not an e-graph or a theorem prover.

## Failure, concurrency and budgets

`StrategyRejected` is the only recoverable exception channel. Algorithms may use `ctx.reject`; failed invariants and empty feasible sets use it. Ordinary exceptions, invalid algorithm outputs, unavailable references, cycles and exceeded budgets remain fatal. `attempt` does not hide implementation bugs. When parallel siblings fail differently, a fatal failure takes precedence over rejection; explicit cancellation takes precedence over rejection when the external signal is aborted. Within a failure class, source-order index gives deterministic error selection.

`parallel`, `fork` and `forEach` support optional local `concurrency`. `ExecuteOptions.maxConcurrency` limits active algorithm calls globally, including nested groups. Only algorithm calls acquire a permit, so composites never hold a permit while waiting for child work. This is asynchronous scheduling, not CPU worker parallelism.

All started operations are awaited after failure. Unscheduled siblings are marked skipped while the trace budget permits. There is no rollback: successful compiler tasks can remain cached even if a later alternative rejects or execution fails. That retained work remains observable.

`maxSteps` counts every allocated node visit, including skipped subtree records, and therefore bounds trace-record allocation. A limit failure does not allocate records for remaining nodes; the nearest recorded ancestor explains the budget failure. `maxDepth` bounds execution nesting; plans are also limited to 10,000 static nodes and static depth 128. `maxItems` and `maxIterations` are required at the corresponding nodes. These are structural budgets, not memory/process isolation or wall-clock preemption. Algorithm evidence payload sizes remain the host's responsibility.

Cancellation is cooperative. The interpreter checks `AbortSignal` between nodes and before/after algorithms and cancels queued semaphore requests. Long asynchronous algorithms must honor `ctx.signal`; synchronous JavaScript cannot be preempted by this interpreter. No fallback catches cancellation. Already-started host work is awaited, not abandoned with an unhandled rejection.

## Validation, editing and interchange

- `validate(value, registry?)` returns `{valid, issues}` with paths and codes. It checks JSON shape, format version, exact fields, IDs, references, lexical binding availability, algorithm categories/versions and numeric bounds.
- `assertValid(value, registry?)` throws `PlanValidationError` with the same issues.
- `walk(plan, visitor?)` returns ordered `{node,parent?,path,depth,slot?}` visits and optionally calls `visitor(node, visit)` in preorder; `find(plan,id)` or `find(plan,predicate)` returns the first matching node or undefined (`predicate(node, visit)`); `childNodes(node)` exposes direct structural children.
- `replace(plan,id,node)`, `insertBefore(plan,id,node)`, `insertAfter(plan,id,node)` and `remove(plan,id)` return new immutable validated plans. Invalid operations leave the old plan untouched. Insertions create a fresh sequence when the target has no sequence parent. Removal supports list entries; a required child or root must be replaced explicitly (an empty sequence is identity).
- `diff(before,after)` reports added, removed, changed and moved nodes by stable node ID. Composite changes refer to child IDs rather than duplicating entire descendant trees. Plan metadata changes use the `$plan` pseudo-ID.
- `serialize(plan, pretty=true)` uses deterministic key ordering; `deserialize(text, registry?)` validates and freezes the JSON interchange value. The workbench has its own lossless YAML view/editor; persisted plan bytes remain normal data.

## Execution evidence

`execute(plan, registry, input, options?)` preflights the plan, snapshots it and the registry, then returns a `StrategyExecution` for succeeded, rejected, failed or cancelled execution. Invalid plans fail preflight with `PlanValidationError` and do not run any algorithm. `executeOrThrow` wraps a nonsuccessful execution in `StrategyExecutionError`, retaining the complete `execution` property.

The execution contains the exact immutable plan, SHA-256 plan revision, algorithm manifest, input, terminal result/error, node records and an event stream. Each dynamic record has its own execution ID, stable plan node ID, parent execution ID, deterministic structural path, iteration/item/branch location, input/output, status, child IDs, evidence, timestamps and compiler invocation/cache links. A repeated or mapped static node has multiple dynamic records; inactive paths are explicitly skipped. Selection, predicates, fixpoint comparisons, checks and recovery decisions are recorded at the responsible nodes.

Pass an explicit execution ID to correlate compiler runs. Otherwise, IDs combine the plan revision and a process-local run counter. Timings describe elapsed inclusive wall time, not exclusive CPU profiling.

`onEvent` receives frozen events. If an observer throws, its error is recorded as `observer-error` evidence and the observer is disabled; compiler semantics remain unchanged. Returned traces are immutable and retain this diagnostic.

## Scope boundary

This module does not implement the separately proposed semantic property/contract system or generic IR rewriting framework. It invokes existing transformations through a clean registry, and composes, edits, validates and explains their strategies. Domain algorithm correctness and semantic equivalence remain the domain compiler's responsibility.
