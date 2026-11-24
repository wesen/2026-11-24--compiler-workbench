# IR Workbench v4

## Strategy IR implementation report

V4 makes compilation strategy an explicit, executable intermediate representation. A program describes the object to build. A strategy describes how to compile and optimize it. Registered algorithms implement the individual operations. The developer workbench connects all three to the artifacts, pass invocations, cache decisions, and selection evidence produced by a particular execution.

The requested scope is the complete Strategy IR component discussed as item 1: all thirteen listed operators, immutable plan construction and editing, validation and serialization, an interpreter, real example integration, and plan-versus-execution inspection. Semantic pass contracts and a generic domain-IR rewrite engine are separate components. This release does not claim that those two later projects have been implemented by adding strategy orchestration.

The implementation extends the source-first v3 workspace rather than replacing its domain algorithms. Its baseline contains 122 passing automated tests. V4 retains the authored TypeScript programs, persistent domain builders, bounded CAD and mechanism backends, immutable artifacts, dependency-aware pass cache, query API, YAML inspection, source browser, and offline HTML delivery.

## 1. The architectural boundary

There are three kinds of source worth inspecting. The object source says what a building, bracket, linkage, or door is. The strategy source chooses the compilation route and the optimization procedure. The compiler source implements tessellation, constraint lowering, numerical solution, selection materialization, packaging, and the execution machinery itself.

The distinction is operational. Changing an object can alter geometry or constraints. Changing a plan can alter ordering, branching, candidates, selection criteria, verification, or instrumentation. Changing an algorithm implementation requires a new algorithm version. A historical run preserves the actual program source and strategy data that executed; an uncompiled editor draft does not rewrite that history.

| Component | Responsibility | Dependencies |
| --- | --- | --- |
| Authored programs | Ordinary TypeScript composition and domain declarations | Domain language builders |
| Domain languages | Immutable, validated program data | Shared finite-data utilities and domain schemas |
| Strategy IR | Serializable control flow, references, versioned algorithm calls | Shared finite-data utilities; no domain imports |
| Strategy interpreter | Execute the plan, isolate bindings, select candidates, retain evidence | Strategy registry and explicit host callbacks |
| Compiler runtime | Resolve tasks, validate artifacts, track dependencies, cache and query pass results | Shared core types; no strategy or domain imports |
| Integration layer | Construct concrete plans and adapt algorithm calls to compiler tasks | Strategy APIs, compiler port, domain pipeline planners |
| Domain algorithms | Geometry, expressions, equations, solver operations, scene assembly | Relevant domain schemas and mathematical utilities |
| Workbench | Author, execute, inspect, compare, export, and open source | Portable compiler and strategy records |

The strategy engine has no knowledge of a mesh, scene, body, or constraint. Its registered algorithms receive immutable finite data through a narrow context. The integration layer supplies the bridge to the existing compiler. The compiler likewise has no dependency on the strategy package. A general run-extension API stores the strategy execution as portable evidence without making the runtime interpret its contents.

This keeps the cache boundary clear. A strategy execution is recorded every time. Individual compiler passes still reuse their results when their algorithm version, parameters, output schema, and recorded dependencies match. Reusing a pass does not erase the strategy step that requested it. Conversely, changing a checkpoint label or adding an observational checkpoint does not need to invalidate an otherwise identical geometry task.

## 2. Strategy data and algorithm identity

The public plan is a finite JSON value with a `formatVersion`, a stable plan `id`, a root node, and an optional description. Each node has its own globally unique `id`, a discriminated `kind`, and optionally a human-readable label or output binding. Composite nodes contain other nodes. Algorithm-bearing nodes carry an explicit `{id, version}` reference.

The thirteen node kinds are not names attached to opaque functions. Each has a separate interpreter case and defined input, output, binding, and failure behavior. User callbacks and executable JavaScript never occur in the serialized IR. Executable implementations live in an external `AlgorithmRegistry`, where registration is keyed by exact identity and version. Registering another implementation under the same key fails. Execution captures a registry snapshot. A plan-level requirements manifest also pins the compiler algorithms that may be reached through implicit task dependencies.

Algorithms declare one of six roles: transform, analysis, predicate, selector, invariant, or metrics. Validation checks a node's reference against its required role when a registry is supplied. For example, a conditional requires a predicate, verification requires an invariant, and a transformation step requires a transform. These are orchestration roles. They do not establish the semantic preconditions, preservation claims, or effect guarantees planned for the future contracts component.

Arguments and input overrides are data templates. A reference can select the execution's original input, the current pipeline value, a named lexical binding, the current collection item, its index, or the current repetition iteration. An explicit path traverses own properties. Reserved reference-looking data can be wrapped with `literal` so that it is passed as data rather than interpreted. Prototype traversal is forbidden.

The builders expose these concepts directly:

```ts
const p = plan('example.optimization', sequence('pipeline',
  apply('lower', algorithm('example.lower', '1')),
  require('measure', algorithm('example.stats', '1'), 'stats'),
  verify('valid', algorithm('example.valid', '1'), {
    args: { stats: binding('stats') }
  }),
  checkpoint('ready', 'ready for packaging', ref('current'))
));
```

The IDs above are illustrative algorithm registrations, not hidden built-ins. A caller supplies implementations through the registry. The same resulting plan can be serialized, inspected, edited, validated, and executed in Node or in the browser.

## 3. Complete operator semantics

| Operator | Input and result | Control and evidence |
| --- | --- | --- |
| `apply` | Calls a versioned transform with current or explicitly referenced input and resolved arguments; returns its result | Records the actual call, output, evidence, and linked compiler invocations |
| `sequence` | Feeds each step's result into the next; returns the final result | Child bindings are visible to later siblings in that sequence |
| `parallel` | Runs independent steps from the same starting input; returns results in declared order | Isolated branch environments and bounded concurrency; ordering is independent of completion time |
| `fork` | Runs named alternative strategies from the same input; returns a candidate set | Retains successful values and explicit rejections with their reasons |
| `chooseBest` | Executes its candidate-producing node, evaluates metrics and constraints, and returns the winner | Records feasibility, objective values, rejection reasons, and deterministic tie resolution |
| `conditional` | Evaluates a registered predicate and returns the chosen branch's result | Executes one branch and identifies the skipped branch in the trace |
| `repeatUntilStable` | Repeatedly feeds the body result back into the body until identity stabilizes | Requires an iteration bound, detects cycles, and records each dynamic iteration |
| `forEach` | Selects or resolves a collection, executes the body for each item, and returns ordered results | Enforces an item bound; exposes item and index; isolates item bindings |
| `require` | Computes an analysis and binds it by name while preserving the current pipeline value | Makes the analysis dependency explicit without replacing the IR being processed |
| `verify` | Evaluates an invariant and preserves input when it passes | A false result becomes a structured, explicitly recoverable rejection |
| `checkpoint` | Preserves the current value and records named resolved data | Adds instrumentation directly to the plan without a new domain pass |
| `attempt` | Tries a body and, for an eligible explicit rejection, executes a fallback from the original state | Optional rejection-code filter; records the rejected attempt and the fallback |
| `scope` | Executes a named nested strategy and returns its result | Isolates local bindings and supplies an inspectable grouping |

### Sequential and lexical behavior

The current value and the original execution input are different references. This matters after several lowering steps: the original program remains available explicitly while the current value progresses through representations. Named bindings retain selected intermediate values and analysis results. A node's optional `bind` exports that node's result into its enclosing environment.

A sequence creates a lexical region for its children. A nested sequence, scope, conditional branch, fork alternative, or collection item does not leak arbitrary internal bindings to its parent or siblings. Values cross those boundaries through explicit results and bindings. Static validation catches a reference to a name that is unavailable in that lexical position.

This design prevents concurrent branches from communicating through a mutable local variable. It also makes fallback meaningful: the fallback receives the input and lexical environment from before the rejected attempt. Intermediate host computations may still have produced cache entries and diagnostic records. Those effects are retained, not rolled back.

### Alternative selection

Forking and parallel execution have different results. Parallel execution collects independent results. Forking produces named alternatives and can retain an expected rejection as an alternative outcome. A compiler bug, malformed output, unknown algorithm, or ordinary thrown exception is not silently converted into a rejected candidate.

Selection evaluates the requested objective and every numeric constraint against each successful candidate. Missing or nonfinite required metrics are errors. A candidate violating a constraint remains in the evidence with the violated condition. Ties use deterministic code-unit ordering of candidate names rather than machine locale or completion time. If no candidate is feasible, the result is an explicit strategy rejection that an enclosing attempt may handle.

Metrics may be embedded in the candidate's value or supplied by a versioned metrics algorithm. The latter allows the strategy component to stay independent of domain representation. Selection evidence explains what won, which alternatives lost, and why; linked compiler invocations separately explain whether a candidate's artifact was computed or reused. An optional `decisionAs` binding carries that exact immutable decision to later steps. This is separate from the winning value and prevents a later choice over the same artifacts from overwriting the causal explanation for an earlier choice. Dynamic execution IDs stay in the trace rather than contaminating cache parameters.

### Repetition and bounded execution

A repeated body must eventually produce the same semantic identity as its input or fail within its configured bound. Plain data uses canonical finite-data equality. Artifact-shaped values use kind, schema version, and revision, allowing logical task names to change between iterations. An optional analysis supplies another domain-appropriate identity. A changing timestamp, invocation identifier, or accumulating trace is not a suitable convergence criterion.

Repeated states that form a cycle are rejected as nonconvergent execution rather than accepted as a fixed point. Reaching the iteration limit also fails explicitly. Every iteration has its own execution identity while retaining the same planned body-node identity. A collection similarly has a mandatory maximum item count and preserves input collection order in its output.

Cancellation is cooperative. The interpreter checks cancellation and execution budgets at scheduling boundaries; registered asynchronous algorithms receive an abort signal. Synchronous geometry or solver code runs on the JavaScript thread and cannot be forcibly interrupted in the middle of a computation. Parallel means bounded concurrent asynchronous scheduling, not automatic CPU parallelism or a worker pool.

## 4. Validation, editing, and interchange

`validate` returns structured issues with paths and codes. `assertValid` turns those issues into an exception suitable for API boundaries. Validation checks schema version, node shape, legal fields, node uniqueness, algorithm-reference shape and role, lexical references, iteration and collection bounds, concurrency options, selection objectives and constraints, and finite-data restrictions. Executable values, cycles, accessors, unsupported prototypes, and nonfinite numbers cannot enter a committed plan.

The editing API operates on immutable plans:

| API | Behavior |
| --- | --- |
| `walk` | Enumerates nodes with parent, structural path, depth, and child slot; optionally calls a preorder visitor |
| `find` | Resolves a stable node ID or the first node matching a predicate |
| `replace` | Substitutes a node or subtree and validates the resulting whole plan |
| `insertBefore` | Inserts a sibling in a sequence, or creates a sequence around the selected target |
| `insertAfter` | Performs the corresponding insertion after the selected target |
| `remove` | Removes an optional/list child; mandatory structural children require explicit replacement |
| `diff` | Reports additions, removals, local changes, and moves using node identity |
| `serialize` | Produces canonical lossless JSON interchange, optionally pretty-printed |
| `deserialize` | Parses, validates, and freezes a plan, optionally checking a registry |
| `execute` | Returns a terminal execution record, including traces of failures |
| `executeOrThrow` | Convenience entry point for callers preferring exception-based failure handling |

An invalid edit leaves the original plan unchanged. Deleting a required analysis while another step references its binding fails validation. Reusing a node ID in an inserted subtree also fails. Removing a required conditional branch is not silently interpreted as an identity operation; callers must supply the replacement they intend.

JSON is the portable interchange representation. The workbench displays and edits strategy data in highlighted YAML, using a deliberately bounded data subset that round-trips the application's finite-data serializer. It does not evaluate YAML tags, instantiate arbitrary classes, or fetch external references. Parser diagnostics are separate from strategy schema diagnostics and execution failures.

Editing strategy data changes compilation control, not the implementation of a registered algorithm. The source browser exposes that implementation separately. This preserves the distinction between experimenting with a plan and authoring new compiler code.

## 5. Observable execution

The strategy trace stores the complete immutable executed plan, a plan revision, the algorithm registry manifest, original input, terminal status, result or error, node executions, and ordered events. A planned node has one stable identity. An execution of that node has another identity. Repetition, collection traversal, and nested alternatives may therefore produce many execution records for one planned node.

Each execution record includes its planned node ID, parent, path, children, status, timing, input and output, evidence, and links to compiler tasks. Dynamic context records the branch, iteration, or collection index where applicable. Events identify starts, completions, evidence, links, and skipped branches. This supports both tree inspection and chronological reconstruction without pretending that a parallel run is a single linear pass chain.

Task links carry the real task ID and, where available, invocation identity, output artifact reference, and cache explanation. For the question "Which object got cached when we optimized for this objective, and why?", the inspection route is concrete:

1. Open the `chooseBest` execution to inspect its objective, constraints, and candidate rankings.
2. Follow the selected or rejected candidate's execution to the pass that produced its artifact.
3. Open that pass invocation to see whether it executed or reused a stored result.
4. Inspect the cache explanation: algorithm and schema versions, explicit parameters, recorded dependencies, and the original invocation supplying the reused value.
5. Open the algorithm's source and inspect the exact IR and source snapshot associated with that historical run.

Strategy evidence is attached to a compiler run through `recordExtension('strategy.execution', trace)`. The core snapshots the data and permits only one value per namespace. A failed callback still leaves the evidence in the run record. Writing evidence after the run has closed, overwriting an existing namespace, or supplying executable data fails.

The compiler's original artifact and dependency queries remain useful. Strategy traces add control-flow evidence; they do not replace provenance, task dependencies, or cache manifests. Durations are wall-clock execution measurements, including awaited work. They are not an exclusive CPU profiler.

## 6. Real example integration and verification

### Domain plans

All five existing authored examples now compile through Strategy IR by default. The existing `compileProgram` call keeps its `{value, run}` result and adds `{strategy: {plan, trace}}`. A caller may supply an edited plan. The CAD strategy explicitly schedules projection, equations, tape, numerical sketch solution, feature elaboration, analytic recognition, tessellation, analysis and verification. Its final mesh matches the previous task-driven result.

The scene strategy runs independent projections in parallel and traverses authored geometry with `forEach`. A conditional selects the primitive or imported-CAD backend. LOD candidates are named fork branches. Each reduction first checks algorithm applicability; incompatible geometry selects an explicit retention fallback. `chooseBest` performs the optimization itself. A materialization pass records the selected artifact and provenance without running a second optimizer.

The mechanism strategy shares assembly recognition, residuals and the numeric tape, then forks numerical and closed-form solvers. Each candidate is checked against the same authored link-error bound. Selection chooses the requested work or accuracy objective. The door composes imported CAD, this mechanism strategy, scene construction, collision boxes and rigid attachments. Tests compare the final artifacts of all five examples against the earlier task-driven compiler path.

### Plan edits have measurable consequences

The recorded building experiment starts with 59 compiler invocations. Its 59 static strategy nodes expand to 248 execution records because collection traversal, candidate alternatives and skipped paths are recorded explicitly. Recompiling the same program and plan reuses all 59 pass results while creating a new execution trace.

Changing only the strategy objective from minimizing rendered triangles to minimizing reduction error changes the selected LOD from divisor 4 to divisor 1. Rendered triangles rise from 2,120 to 2,696; the reduction-error bound relative to the source mesh falls from approximately 0.005452 metres to zero. The original primitive approximation remains separately recorded; zero reduction error does not mean an exact analytic cylinder. Only two compiler passes execute again, and 57 reuse their artifacts.

Removing the divisor-8 strategy branch reduces actual compiler invocations from 59 to 50. The selection materializer considers only candidates evaluated in the current run. It does not silently recreate the removed alternative from its old task list or from historical cache entries. Adding an observational checkpoint changes the plan revision and adds an execution record, while all 59 compiler invocations reuse their results and the final artifact remains identical.

| Recorded scenario | Executed passes | Cached passes | Observed result |
| --- | --- | --- | --- |
| Building, cold | 59 | 0 | Divisor 4; 2,120 rendered triangles |
| Building, unchanged | 0 | 59 | Same artifact; new strategy trace |
| Building, quality plan | 2 | 57 | Divisor 1; 2,696 rendered triangles |
| Building, branch removed | 2 | 48 | Removed candidate never invoked |
| Building, added checkpoint | 0 | 59 | Same artifact; one extra strategy record |
| Pavilion, cold | 35 | 0 | Same generic scene strategy generator |
| CAD bracket, cold | 12 | 0 | Verified watertight bracket mesh |
| Linkage, cold | 11 | 0 | Closed-form candidate selected |
| Door, cold | 49 | 0 | CAD, scene and motion composed |
| Mesh cleanup, cold | 7 | 0 | Three changes, then stable |
| Mesh cleanup, unchanged | 0 | 7 | All transformation artifacts reused |

These rows are a subset of the twenty recorded strategy scenarios in `output/strategy-experiments/summary.json`. Warm pavilion, bracket, linkage and door runs also reuse every pass. The separate sixteen-run source-edit suite remains under `output/source-experiments/`: material changes preserve independent geometry, bore changes preserve the solved profile, sampling changes preserve equations and tape, and imported CAD edits preserve motion. The source-edit counts describe that recorded sequence of edits; they should not be misread as isolated deltas from one identical starting state.

### Nontrivial fixed-point transformation

The sixth example starts with an eleven-vertex box: eight required positions, two unused vertices, and one exact duplicate used by a triangle. The transformation removes one unused vertex or welds one duplicate per invocation. It checks that every oriented triangle's coordinates and semantic face label remain identical.

The repeated strategy performs three modifying passes and a fourth stable pass. The result has eight vertices and repaired watertight connectivity. There are seven compiler invocations in total, including source and the before/after analyses, and thirteen strategy execution records. Limiting repetition to two iterations produces an explicit nonconvergence error and retained partial evidence; it does not return the partially cleaned mesh as a successful output. This exercises real iteration rather than repeating an identity function as the only demonstration.

### Failure and correctness regressions

The twenty scenarios include no feasible candidate, attempted relaxation of a hard authored error bound, iteration exhaustion, unsupported CAD geometry, and a changed transitive compiler version. Expected failures are asserted by the experiment script. A version mismatch is rejected before any compiler invocation; it is a validation failure rather than a fabricated execution trace.

Two additional review regressions are significant. First, a saved plan cannot evade source-pass version pins by deleting the explicit source node and allowing a later pass to request it indirectly. Second, a strategy can choose a low-triangle candidate, choose a high-quality candidate over the same artifacts, then materialize the first bound choice; its decision evidence still identifies the first objective. Repeating that two-choice strategy preserves all pass cache hits.

Required data dependencies remain the compiler's responsibility. Removing an explicit scheduling node does not delete the inputs a later algorithm needs. If that later pass resolves an omitted prerequisite, the bridge links the actual invocation and labels it as a required compiler dependency. Every invocation in the recorded strategy scenarios has a strategy link, including these implicit requests and failed compiler passes.

### Release verification

The strict TypeScript build and the full automated suite passed: **192 tests, zero failures, zero skips**. This includes the 122 baseline regressions plus 36 strategy-engine tests, 16 domain integration tests, two independent bridge-review tests, four run-evidence/runtime-inspection tests, and twelve YAML/component/UI tests. The engine tests cover concurrency limits, failure precedence, cancellation, immutable contexts, version snapshots, lexical binding, invalid plans, serialization, editing, cycles, item/depth/record budgets and every operator.

The UI tests call the actual component handlers, source evaluator, strategy interpreter and domain compiler. They check plan edits that change geometry, all six examples, source browsing, failed-plan evidence, draft preservation, history restoration, invalid YAML and source-error recovery. Their DOM, canvas and Worker transport are explicit test doubles. They are not browser rendering tests.

**Live browser verification could not be completed in the release environment.** Local Chromium launch was blocked by the sandbox, the connected browser lacked an originating extension context, and the supported cloud browser rejected local-file navigation under its URL policy. The reproducible browser suite is included as `scripts/check-strategy-browser.py`; it checks real Workers, downloads, desktop/mobile layout, offline operation and errors when run in an environment that permits Chromium. Historical v3 browser screenshots and results are kept in `output/history/v3/` and are not presented as v4 evidence. This is the outstanding verification limit, not an unimplemented Strategy IR feature.

## 7. Workbench and source navigation

The source-first workflow remains intact: choose one of the five programs, edit actual TypeScript, compile, inspect the resulting model or motion, and follow a compact invocation list into pass details. IR values, query results, and strategy data are shown as YAML with syntax coloring. Compiler and example source are the actual bundled files.

The strategy workspace adds a compact plan-node list and an adjacent inspector. It distinguishes the editable plan, the default generated plan, and the exact plan captured by a selected historical run. The execution view shows dynamic visits, branches, repetition, selected candidates, and linked passes. The implementation view opens the plan generator and the strategy interpreter as well as the underlying domain pass code.

Plan editing and import validate before execution. A failed edit produces an error without presenting the old successful artifact as the output of the new plan. Historical records remain inspectable after subsequent edits. Exports preserve the actual plan and execution evidence rather than only the current visual selection.

The HTML bundle includes the compiler, interpreter, source catalog, visualizers, authored programs, and TypeScript transpiler. It runs offline without a server or external network requests. TypeScript edits execute trusted local code in a worker with a timeout and a restricted module resolver. This is not an untrusted-code security sandbox. Browser compilation checks syntax/transpilation and runtime domain validity; the disk build additionally runs strict TypeScript checking.

## 8. Practical limits and remaining components

Completeness is scoped to the Strategy IR component. The domain backends retain their deliberate bounds. The CAD backend recognizes the supported rectangular-base bracket, matched upright, and two symmetric through-bores. The mechanism backend solves the recognized planar four-bar's prescribed kinematics. The scene vocabulary includes the implemented primitives and CAD imports. These examples exercise composition; they are not a general solid-modeling kernel, arbitrary mesh optimizer, dynamics engine, or collision certification system.

A strategy can schedule an algorithm only when an implementation with the required version is registered. Making that reference inspectable does not make arbitrary algorithms available. A verification algorithm executes a check; it does not construct a mathematical proof. Analysis results can use the compiler's existing task cache through the bridge, but this is not yet a property-aware analysis manager with preservation and transfer semantics.

The interpreter's branch isolation covers its immutable input and lexical environment. It does not undo filesystem writes or other host side effects of an algorithm. The supplied compiler integrations operate through immutable artifacts and their cache, so retaining successful computations after a rejected alternative is useful and explicit. A future effect system could restrict or classify richer algorithm integrations.

Compiler caches and the workbench session remain in memory. Exported plans and traces are portable records, while arbitrary restoration of a warm compiler cache is not part of this release. Artifact and history retention are not bounded by the pass-cache capacity. Source locations point to actual implementation files; there is no claim of a full TypeScript AST-to-domain-entity source map.

The next architectural work remains separate: semantic pass contracts for requirements, established properties, preservation and verification evidence; generic capability-based IR traversal and rewriting with correspondence; and a richer query algebra over runs, artifacts, entities and decisions. Strategy IR supplies the control and evidence boundary those components can use without coupling their domain semantics into the scheduler.

## 9. Reproduction and release inventory

Use Node 22 or newer for the TypeScript project. The complete archive retains the pinned installed development dependencies for Linux x64; on a different platform, install from the lockfile with `npm ci`. No third-party runtime package is required by the strategy engine.

The release includes all authored and compiler source, the new strategy package, domain integration, unit and integration tests, browser checks, build scripts, generated standalone HTML, compiled JavaScript and declarations, report sources, PDF rendering tooling, and experiment evidence. Python is used only for optional browser/document verification, not for the compiler or its Node test suite.

The workspace ZIP and standalone HTML are separate deliverables. The archive includes the release-verification record and SHA-256 file manifest.
