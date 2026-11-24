## 7. Understand execution, caches and explanations

The incremental runtime is deliberately smaller than the languages built on top of it. It accepts registered representation kinds and passes, runs tasks against immutable input snapshots, and records what each invocation observed. It does not decide which mesh simplification is desirable or which equation rewrite is valid. Strategies and semantic policies make those decisions through explicit ports.

### 7.1 The smallest useful compiler

`src/guide/01-runtime.ts` registers a scalar kind, a pass that reads one source key, and a pass that adds two required artifacts. The core pattern is small:

```ts
const left = task('guide/left', 'guide.read', {
  key: 'guide.left'
});
const right = task('guide/right', 'guide.read', {
  key: 'guide.right'
});
const sum = task('guide/sum', 'guide.add', { left, right });

compiler.setInputs({ 'guide.left': 3, 'guide.right': 4 });
const cold = await compiler.run('Cold sum', run =>
  run.require<Scalar>(sum)
);
const warm = await compiler.run('Warm sum', run =>
  run.require<Scalar>(sum)
);
```

The pass registration supplies a version and output kind. The task supplies a logical ID, the pass ID, and finite serializable parameters. Keeping these separate allows the same registered algorithm to execute at many logical tasks. The same logical task cannot acquire two conflicting parameterizations inside one run.

`Compiler.run` returns both the callback's value and the completed `CompilationRun`. If the callback returns an artifact, the result's `value` is that artifact, whose own `value` contains the native payload. Keeping the run object is useful: it scopes queries to exactly the compilation you are debugging.

The runtime captures source input state and registrations for each run. A pass reads source data with `context.read(key)` and requests other tasks with `await context.require(task)`. These calls become dependency records. Reading an unrelated global variable instead creates a hidden dependency that the cache cannot discover. Trusted pass implementations must make their relevant inputs explicit.

### 7.2 Why a cache entry is reusable

The cache records the task request, algorithm version, output kind/schema, actual input reads, required tasks and their output revisions, plus replayable algorithm observations. Reuse checks those dimensions rather than assuming that a task name identifies a timeless value. A pass version change, changed parameter, changed read input or changed required artifact can each explain a miss.

A required task may need to run before the parent can decide whether its cached result is still usable. If the child recomputes but produces the same native revision, a parent that depends only on that revision can still reuse its result. Conversely, a visually similar model with different native content is a different revision. The cache follows declared observations, not visual similarity or semantic guesses.

In the scalar tutorial, the unchanged second run reuses all three tasks. Changing only `guide.left` causes its source pass and the addition to execute. The right source task stays cached. The final native value changes from `7` to `14`. The printed explanation includes the dependency responsible for the addition's miss, and the run comparison shows which task outputs actually changed.

The cache is process-local and bounded by the compiler's configured entry limit. Eviction is a supported explanation for recomputation. Replaying a full trace also requires a cache entry that retained a full trace; a summary-only entry cannot invent missing checkpoints. Cache-disabled runs and noncacheable passes are distinguished from cache misses.

### 7.3 Reuse and acceptance are separate decisions

An artifact can be reusable as a computation and unacceptable under a current condition. The semantic pass-policy boundary handles this distinction. The policy runs around both fresh execution and output reuse. Its `before` hook prepares input checks; `reuse` may reject a candidate cache entry when an extension's computation dependencies changed; `after` checks a provisional output; `committed` synchronously accepts staged policy state before the artifact becomes visible; `failed` performs cleanup and retains failure evidence.

The distinction between `reuse` and `after` matters. If the body used a resource whose revision changed, the old computation is stale and should be recomputed. If a current acceptance threshold changed, the old geometry may still be reusable but fail its present acceptance check. Merely putting every resource read into a general cache key obscures this difference.

The earlier contract lab includes both cases. Its live volume limit can reject cached geometry without rerunning the geometry algorithm. Its resource-derived geometry uses a resource value in the algorithm body; changing that value forces recomputation. A transformation with a write effect is explicitly noncacheable, because reusing its output would not perform the newly requested write.

The four v6 labs also apply semantic acceptance at two useful boundaries. Each generic edit is verified before its local revision is committed. The outer compiler pass validates the artifact it publishes under its own task ID. On a warm run, no new edit trace is fabricated: the actual earlier edits stay attached to their originating invocation, while the current pass has new acceptance records. Analyses used by those checks may themselves be reused when their exact dependencies still match.

### 7.4 A practical debugging sequence

Suppose you ask, "Which object was cached when we optimized for this error bound, and why?" Begin with the selected output and the exact run. Inspect its strategy choice to identify the actual candidate and objective/constraint values. Follow the linked task to the compiler invocation. Read its cache status, origin invocation and dependency changes. Then inspect the semantic checks that accepted it for this run.

If the question concerns a particular entity, switch from artifact-level execution to entity-level correspondence. Select the definition, face or equation in the exact revision and trace its origins. Open the rule and matcher evidence that created, merged or removed it. Finally inspect the native before/after values and the actual operation log. This connects intent, execution and structural consequence without inferring one from another.

The same sequence is available programmatically:

```ts
const explanation = changed.run.why('guide/sum');
const cache = changed.run.explainCache('guide/sum');
const dependencies = changed.run.dependencies('guide/sum');
const comparison = changed.run.compare(warm.run);
```

These query methods read captured records. They do not execute passes or recompute a semantic check while you are looking at history. A question that needs a new analysis should call the analysis manager explicitly and record the resulting evidence separately.

### 7.5 Runtime API reference

The public protocol is defined in `src/core/types.ts`, execution in `runtime.ts`, records in `records.ts`, and inspection in `query.ts`. The following signatures use `T` for a native value and `P` for finite task parameters.

| API | Purpose and important behavior |
| --- | --- |
| `task(id, pass, params)` | Construct a task request; the run checks consistent logical task identity |
| `new Compiler({maxCacheEntries?})` | Create registrations, retained artifacts, run history and bounded computation cache |
| `registerKind(kind)` | Register a versioned native schema with validator and optional description/structure |
| `register(pass)` | Register a versioned pass with output kind, role, cache policy and implementation |
| `replacePass(pass)` | Replace a registered algorithm using the versioning rules; do not silently redefine an old version |
| `setInput(key,value)`, `setInputs(record)` | Capture finite source data for subsequent runs |
| `getInputs()` | Read an immutable source-state snapshot |
| `run(label,action,options?)` | Run and finish an async compilation callback, returning its value and run |
| `beginRun(label,options?)` | Obtain an explicitly managed run; the caller must finish it correctly |
| `evict(taskId?)` | Remove computation cache entries for a task or the whole cache |
| `snapshot()` | Capture portable runs, registrations, artifacts, invocations and derivations |
| `artifact(ref)`, `passDescriptors()` | Retrieve retained exact artifacts and registered algorithm metadata |

Run options include `cache` and trace level `summary` or `full`. A full trace retains checkpoints; both modes retain the execution/dependency information required by the runtime. `CompilationRun.require<T>(task)` requests a root or dependency and returns an artifact. Repeated compatible requests in a run share the pending/completed work. Cyclic task dependencies fail explicitly.

| Run or pass API | Purpose |
| --- | --- |
| `run.id`, `run.record` | Exact run identity and captured status |
| `run.require<T>(task)` | Resolve a task within this run's immutable snapshot |
| `run.artifact(refOrTaskId)` | Retrieve an artifact actually available in this run |
| `run.invocation(taskId)` | Inspect that task's recorded invocation in this run |
| `run.recordExtension(namespace, value)` | Attach one finite execution-layer record before run closure |
| `run.finish()`, `run.finishAsync()` | Close an explicitly managed run; async closure drains outstanding work |
| `context.read<T>(key)` | Read and record a source dependency |
| `context.require<T>(task)` | Request and record a task dependency; await every request |
| `context.decision(record)`, `diagnostic(record)` | Record algorithm choices or diagnostics with finite evidence |
| `context.metric(name, value, unit?)` | Record a finite numeric metric |
| `context.checkpoint(label, data)` | Retain detailed intermediate evidence in full-trace mode |
| `context.derive(source, mapping?)` | Record provenance from a previously required artifact |

Pass and policy contexts have bounded lifetimes. Holding a context and using it after its callback returns is rejected. Returning while required tasks are still outstanding is also rejected and drained. A failed required task remains a failed invocation even if surrounding JavaScript catches the exception; a compiler run cannot quietly turn that history into a clean successful run. Expected optimization rejection belongs in the strategy or rewrite rejection protocol.

`setPassPolicy(passId, policy)` and `removePassPolicy(passId)` attach acceptance behavior outside active runs. A policy has an exact ID/version and optional `before`, `reuse`, `after`, `committed`, `failed` hooks and cache override. Its observations are separate from replayable algorithm observations. `committed` is synchronous because it lies inside the publication boundary.

### 7.6 Query API reference

`compiler.query` reads all captured history. `run.query` reads the same portable record model with a run filter. `new Queries(snapshot, runId?)` can inspect an exported snapshot without a running compiler.

| Query | What it returns |
| --- | --- |
| `invocations(target?)` | Matching invocations, optionally for an artifact/reference/task ID |
| `artifact(target)` | The matching exact artifact when retained |
| `why(target)` | Invocation, origin invocation, source inputs, derivations and ancestral decisions |
| `explainCache(target)` | Cache status, reason, dependency changes, key and origin identity |
| `history(target)` | All invocations of the logical task across captured runs |
| `alternatives(target)` | Recorded alternative-selection decisions in its requested ancestry |
| `dependencies(target)` | Actual input/task dependencies of its invocation ancestry |
| `sourceInputs(target)` | Recorded source reads supporting that ancestry |
| `lineage(entityRef)` | Backward runtime derivation edges for an exact entity/reference |
| `compare(beforeRun,afterRun)` | Source changes, task changes, execution statuses and cache explanations |
| `diff(before,after)` | Native data differences at stable JSON-style paths |

There are intentionally two levels of diff and dependency API. `Queries.diff` compares retained native payloads; `ir.diff` compares adapter-projected entities, relationships and roots. `Queries.dependencies` follows computed-value dependencies; `IRView.dependencies` follows semantic edges inside one representation. Choose the one that answers your question.

The older runtime provenance API represents edges and whole-artifact relationships. The generic layer's correspondence is a total relation with explicit insertion/removal witnesses and grouped Cartesian meaning. The v6 composition root expands real source-target pairs when bridging to runtime edges; it retains empty-endpoint witnesses in the complete correspondence evidence. Treating an empty list as a wildcard ancestor would lose the distinction between deletion and derivation.

### 7.7 Failure evidence is part of the result

A failed compilation is still useful evidence. Invocation records retain error diagnostics and failed task requests; Strategy IR retains the branch or node that failed; the semantic manager retains failed or rejected verification without authorizing those facts; rewrite traces can retain a provisional candidate without publishing it.

The important question is which boundary accepted a value. A prepared edit is not a retained revision. A checked candidate is not necessarily the selected alternative. A selected artifact has not necessarily passed a later export policy. A fact recorded as a declaration has not become a dynamically checked or externally verified fact. The workbench keeps these statuses explicit so a failure does not make a previous successful result look like the new result.
