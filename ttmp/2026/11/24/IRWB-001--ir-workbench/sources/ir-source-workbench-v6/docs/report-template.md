# IR Workbench

## A reusable compiler framework, exercised across CAD, games and kinematics

**Implementation and validation report**  
TypeScript 5.9.3 · Version 0.1.0 · 24 November 2026

## 1. Result and scope

The delivered workspace is a working, standalone TypeScript implementation of the proposed decomposition. It includes an observable compiler runtime, reusable mathematical and geometric libraries, three small domain frontends, a composed mechanical-door example, and an offline developer workbench that can compile edited inputs locally. It contains no imported jig implementation and requires no external CAD or physics service.

The central result is reuse across real computations. The CAD sketch and mechanism frontends emit the same residual-program IR and invoke the same registered numeric-tape pass. The game building and animated door share mesh, definition, occurrence and scene-package interfaces. The door supplies an assembly-derived constraint graph to the existing physics pipeline without changing its residual lowering, solvers or selection pass. A separately registered analysis consumes both CAD and game meshes without modifying the compiler.

The scope is deliberately finite and explicit. The CAD backend supports one useful bracket construction, the game optimizer reduces recognized cylinder rings, and the physics frontend handles planar four-bar kinematics. Within those boundaries the implementation computes actual geometry, numerical solutions, optimization alternatives, dependency manifests and provenance. It rejects unsupported or invalid cases with inspectable errors. The limits are described in Section 14.

### Delivered evidence

| Evidence | Result |
| --- | --- |
| Strict TypeScript build | Passed with the delivered compiler configuration |
| Automated tests | {{TEST_RESULT}} |
| Complete example run | {{BASELINE_TASKS}} actual task invocations across four examples |
| Unchanged rerun | {{WARM_RESULT}} |
| Registered interfaces | {{REGISTRY_RESULT}} |
| Independent reproduction | Every intermediate artifact and all four final roots reproduced across separate Node processes |
| Browser validation | {{BROWSER_RESULT}} |
| Archive recovery | {{ARCHIVE_RESULT}} |

All numerical observations in this report come from the generated artifacts and verification records. The complete machine-readable evidence is included in `output/summary.json`, `output/trace.json`, `validation/`, and the test modules. Source citations appear in Section 17.

## 2. Architecture and dependency direction

The modules follow semantic responsibilities rather than numbered IR levels. A numeric tape and a scene layout are distinct data models; neither is forced into a universal node hierarchy. The runtime only needs a kind identifier, schema version, validator and optional structural projection.

| Module | Owns | Does not depend on |
| --- | --- | --- |
| Core | Artifacts, pass registration, task execution, manifests, cache, decisions, provenance, queries and strategies | CAD, game, physics, geometry and mathematical algorithms |
| Math | Scalar expressions, residuals, numeric tapes, automatic derivatives, rank diagnostics and nonlinear solving | Any domain frontend |
| Geometry | Indexed meshes, transforms, geometric/topological analysis and the bounded analytic bracket backend | Scene policy, assembly, physics or game frontends |
| Scene | Shared geometry definitions, material slots, rigid occurrences and package validation | CAD, game or physics rules |
| Assembly | Named ports, rigid bodies, joint references and assembly validation | The numerical solver or any scene renderer |
| Domain frontends | Supported object languages and their lowering policies | Runtime implementation details |
| Explicit adapters | Recognition and data exchange between independently meaningful boundaries | Hidden solver state or native handles |
| Workbench | Read-only projections of records, registered domain views and an application-level recompile action | Pass-specific UI callbacks inside compiler algorithms |

![Implementation modules and permitted dependency direction](figures/06-module-boundaries.png)

The separation is enforced by an automated import-boundary test that parses TypeScript imports and re-exports, including type imports. That test is more useful than a directory naming convention: moving a CAD import into the math or core layer causes verification to fail.

The scene boundary was extracted when the second consumer, the door, needed it. That removed a prospective door-to-game dependency. Likewise, the math IR registration lives in the math package, so CAD does not have to initialize the physics frontend merely to compile a residual tape. The composition root in `src/examples/project.ts` installs all registrations explicitly.

The assembly-to-physics adapter is intentionally narrow. Its dependency on both public schemas is visible in `src/adapters/assembly-physics.ts`. It verifies the supported topology, endpoint frames, joint axes and driver before creating a physics constraint graph. It has no access to numerical solver internals.

## 3. The common compiler protocol

### Artifacts, tasks and passes

A task is a serializable request consisting of a logical ID, pass ID and explicit parameters. A registered pass has an implementation version, output kind, role and implementation function. Its output is copied through canonical JSON and frozen recursively, then validated against its output kind before it is stored as an immutable artifact.

```ts
interface Task<P = unknown> {
  readonly id: string;
  readonly pass: string;
  readonly params: P;
}

interface Artifact<T = unknown> {
  readonly id: string;
  readonly revision: string;
  readonly contentHash: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly value: T;
}
```

Three identities serve different purposes. The logical task ID identifies a named result across edits. The content hash identifies its canonical value. The revision also includes the IR kind and schema version, so identical JSON in different languages is not treated as the same semantic revision. Entity names such as `hole:left/wall` belong to the domain and are separate from all three.

Canonical serialization sorts object keys and rejects unsupported values: functions, undefined fields, non-finite numbers, cyclic structures, non-plain objects, sparse arrays, accessors and symbol properties. The portable SHA-256 implementation is checked against Node's cryptographic implementation for empty, ASCII, Unicode and multi-block inputs. It supplies content addresses; it does not derive algorithm identity from JavaScript function text.

### The pass context

| Operation | Contract |
| --- | --- |
| `read(key)` | Read one value from the immutable input snapshot for this run and record that dependency |
| `require(task)` | Resolve another task, record its exact request and output revision, and deduplicate shared work |
| `derive(source, mapping)` | Record artifact or entity correspondence, including splits and merges |
| `decision(record)` | Record a domain explanation with evidence and optional accepted/rejected alternatives |
| `metric(name, value, unit)` | Record a finite quantitative observation |
| `diagnostic(record)` | Record an informational, warning or error condition |
| `checkpoint(label, data)` | Retain detailed algorithm progress in full-trace mode |

A pass can be used through the compiler or its pure underlying algorithm can be called directly. This keeps the mathematical and geometric libraries reusable outside this runtime.

Output kinds have runtime validators. TypeScript's `require<T>` parameter documents the consumer's expectation; it is not a runtime proof that an arbitrary injected task produces T. Domain operations validate supported inputs, and adapters explicitly validate the interchange schemas they interpret. A stronger statically typed task builder or required-kind parameter would be a sensible future improvement, not an existing guarantee.

### Execution lifecycle

The runtime snapshots input values and registry definitions at run start. Registry mutation is prohibited while runs are active. Within a run, one logical task cannot be assigned conflicting pass/parameter definitions. Concurrent requests for the same task share its computation. Active dependency edges detect cycles, including cycles formed by independently scheduled roots.

Failures are first-class invocation records and never become successful cache entries. A failed parallel root does not leave the registry locked: the run drains outstanding work before closing and preserves the originating failure. A pass must await its requirements. Ignored asynchronous requirements are reported without leaking orphaned promise rejections. The runtime also records a callback failure occurring after otherwise successful tasks.

## 4. Incremental computation and cache explanations

### What a cache entry means

Each entry retains the pass version, output schema, explicit task parameters, output artifact, recorded input reads, required task requests and required revisions. It also retains the decisions, diagnostics, metrics, correspondence and available trace detail from the original execution.

To reuse an entry, the runtime checks its declared context and recursively revalidates the recorded dependencies. A cached parent therefore cannot conceal an algorithm-version change in a child. If an upstream algorithm runs again but produces the same revision, the parent can still be reused. This is the cutoff that preserves the door's mechanism after a diameter-only CAD edit.

Historical variants are retained until eviction. Restoring earlier inputs can reuse an earlier matching entry. The cache has an LRU entry-count limit; an explicitly evicted entry, a capacity eviction, disabled caching and a changed dependency have distinct explanations. This implementation has no on-disk or cross-process cache.

Revalidation stops when an earlier task dependency changes. Later task parameters may have been computed from that dependency, so replaying the remainder of the old manifest would bind stale requests. The recomputed pass is responsible for requesting the new children. A dedicated regression test exercises this subtle case.

An invocation that catches an absent input or a failed requirement may return a fallback value, but that fallback is not cached. Otherwise the absence or failure could become an invisible dependency and prevent recovery when the input is supplied or the child is repaired. Failed children are memoized within the run to prevent duplicate invocations while preserving the failure in the request graph. A caught child failure still marks the overall run failed. Successful sibling artifacts and cache entries remain available: a run is not a transaction that rolls back all completed work.

### Honest explanation records

A hit reports that algorithm, parameters, schema and every recorded dependency matched, and identifies the originating invocation. A miss reports the changed input, required artifact, pass version, parameters or trace requirement, with before/after values where available. Cache validation probes and actual pass requests appear in execution ancestry; they should not all be interpreted as semantic derivation edges.

Full-trace mode can retain numerical iteration checkpoints. Summary mode omits these detailed events. If a full trace is requested after an entry was created without that evidence, the runtime recomputes rather than fabricating missing checkpoints. Trace mode does not alter the domain result.

The guarantee is conditional on pass purity with respect to declared reads, requirements, parameters and implementation version. JavaScript cannot prevent a plugin from consulting a mutable closure, clock, random source or external file without declaring it. All delivered passes obey the explicit-input contract. A persistent distributed implementation would additionally need target/backend fingerprints, external-resource manifests and stronger isolation.

## 5. Transformations, analyses and optimization strategies

Transformations create new IR values. Analyses compute information about a particular revision and are cached by their recorded dependencies. Strategies choose which computations to request and how to select among their outputs. These are distinct roles using the same orchestration protocol.

Because artifacts are immutable, an analysis cannot silently survive a mutation to the IR it describes. A changed revision causes its manifest check to fail. There is no mutable-IR preserved-analysis list to maintain in this prototype.

The shared strategy library implements concurrent task requests, task-chain construction, bounded iteration until revision stability, and constrained metric-based selection. Fixed-point execution detects cycles and fails on its iteration bound. It compares semantic revisions, so equal JSON in different IR kinds does not count as convergence.

`selectByMetrics` receives evaluated candidate artifacts, named metrics, one minimization or maximization objective, and explicit inequality constraints. It validates metric availability, rejects infeasible alternatives, selects a feasible winner and records every alternative and reason. Equal objective values are resolved by portable code-unit ordering of candidate names rather than a host-locale comparator.

The game frontend uses the same selector as physics. For the game, the objective is rendered triangle count or geometric error under an error budget. For physics, it is residual/Jacobian evaluation count or measured link-length error under a geometric tolerance. These policies are explicit. Invocation duration remains a measured execution property and is not embedded into deterministic geometry or used as a hidden optimization objective.

This design borrows established concerns rather than reimplementing a particular compiler API. MLIR documents on-demand analysis caching, invalidation and instrumentation; LLVM documents structured records of performed, missed and analyzed optimizations. The prototype combines these concerns with immutable domain artifacts and entity correspondence. It is not a replacement for MLIR's operation, dialect or rewrite infrastructure. [R1, R2]

## 6. Four different graphs, one queryable record set

| Graph | Nodes and edges | Question it answers |
| --- | --- | --- |
| IR structure | Domain entities and their semantic relationships | Which joint connects these bodies? Which expression feeds this instruction? |
| Computation dependencies | Tasks, source inputs and required artifact revisions | What must be reconsidered if this input changes? |
| Derivation/correspondence | Entities across artifact revisions and IR kinds | Which drilling feature produced this bore triangle? Which fine faces became this coarse face? |
| Execution requests | Actual invocations, requests, status and timing | What ran, what was reused, and which child failed? |

The database stores runs, artifacts, invocation records, derivations, pass descriptors, kind descriptors and structural projections. It uses in-memory maps plus record arrays with a portable JSON snapshot; most queries scan those arrays. A graph database is unnecessary for this scale.

The query API returns data and never invokes a pass:

```ts
run.why('door/package');
run.dependencies('cad/mesh');
run.history('cad/mesh');
run.explainCache('cad/mesh');
run.alternatives('game/package');
run.compare(previousRun);
```

`why` includes the current invocation, any original cached invocation, source inputs, direct derivations and decision ancestry. `alternatives` searches the task ancestry, so asking about a scene package reveals the upstream selection. `lineage` follows explicit entity correspondences backward. Structural diffs distinguish an absent field from a present field whose value is null. They use revision-specific paths; they do not infer semantic matching between unrelated meshes.

The runtime can explain why an entry was reused. It cannot infer the mathematical reason for an optimization from a before/after mesh alone. Algorithms record that rationale when the decision is made. The separation prevents a visualization from inventing an explanation after the fact.

## 7. CAD: a constrained sketch becomes an actual drilled bracket

The CAD example starts with a rectangular sketch and an ordered construction: extrude a base, join a rear upright, and drill two symmetric through bores. Its ten tasks are parameters, symbolic sketch constraints, numeric tape, solved sketch, base extrusion, independent upright definition, feature history, named analytic solid, mesh and mesh analysis.

The rectangle contains eight coordinate unknowns and eight scalar constraints. The starting coordinates are deliberately perturbed. The shared residual/tape/AD/solver stack must satisfy the residual tolerance with full Jacobian rank before extrusion. After feasibility is verified, the known rectangle dimensions project away numerical roundoff; that restricted, domain-specific projection is recorded as a decision.

The analytic bracket records ten named surfaces. Its volume is computed from the supported construction:

```text
V = width*depth*thickness
  + width*thickness*(height-thickness)
  - 2*pi*radius^2*thickness
```

The tessellator creates the actual drilled boundary. Radial annular cells include the rectangle corner directions, matching seam subdivisions are welded, and the internal base/upright interface is omitted. The result is one connected surface, not overlapping boxes with visually suggested holes. The bound on bore radial approximation is `radius*(1-cos(pi/segments))`; inserted corner samples only reduce the maximum angular gap.

![Default CAD bracket generated from the actual indexed mesh](figures/01-cad-bracket.png)

| Default bracket measurement | Observed value |
| --- | ---: |
| Width / depth / height | 0.12 / 0.08 / 0.06 m |
| Thickness / bore diameter | 0.008 / 0.012 m |
| Vertices / triangles | {{CAD_COUNTS}} |
| Connected components | {{CAD_COMPONENTS}} |
| Euler characteristic | {{CAD_EULER}} |
| Boundary / nonmanifold / inconsistent-orientation edges | 0 / 0 / 0 |
| Analytic volume | {{CAD_ANALYTIC_VOLUME}} m^3 |
| Mesh volume | {{CAD_MESH_VOLUME}} m^3 |
| Maximum bore chord-gap bound | {{CAD_BOUND}} m |

Independent tests check area and volume against known primitives, edge incidence, connectivity, orientation, convergence under refinement and actual vertical ray intersections through the bore centers. The last test is important: a topology counter alone would not demonstrate that the intended bores remain open.

The semantic bore face names remain stable within the supported construction. Triangle IDs are local to a revision. Provenance maps a bore triangle to its named cylinder and then to the drilling feature. The actual constraint-to-point structural graph is derived from expression variable dependencies rather than a misleading all-to-all relation.

## 8. Game assets: shared modules and defensible LOD selection

The game frontend expands a two-floor, four-bay building into reusable definitions and rigid occurrences. It includes wall and door frames with actual openings, glazing, floor slabs, a closed roof prism and columns. Geometry definitions are stored once; occurrences supply translations and rotations. Masonry frames are compounds of closed pieces and retain coincident interfaces. The implementation does not claim that these pieces have been Boolean-unioned.

The IR chain separates a procedural recipe, definition evaluation, occurrence layout, meshes, a shared mesh set, four LOD candidates, selection and the scene package. Per-definition input reads allow a column-radius edit to preserve unrelated mesh definitions. Appearance is read only during packaging.

![Procedural building assembled from shared geometry definitions](figures/02-modular-building.png)

The LOD operation recognizes the canonical cylinder layout, validates its coordinates, connectivity, names and metadata, retains every nth ring vertex, and reconstructs caps and side triangles. It preserves cap identity and explicitly records the many-to-one relation from fine side faces to coarse faces. It never obtains a smaller mesh by deleting arbitrary triangles.

For a radius R and m retained sides, the geometric bound uses `R*(1-cos(pi/m))` plus a conservative coordinate-tolerance margin. For exact canonical coordinates, the fine and coarse polygons lie within the exact cylinder and outside the coarse inscribed polygon; the additional tolerance margin covers the permitted coordinate perturbations. The identity candidate has zero error relative to its input mesh. The source mesh's own approximation to the analytic cylinder is reported separately. Tests independently sample distances and reject forged primitive metadata or inconsistent geometry before any bound is certified.

At the default 0.006 m reduction-error budget, the triangle objective chooses the 12-sided column candidate. The quality objective chooses the original 48-sided geometry. Only the selector and package execute when this policy changes; the candidate artifacts are reused.

| Default selected scene measurement | Observed value |
| --- | ---: |
| Unique triangles | {{GAME_UNIQUE}} |
| Rendered triangles after instancing | {{GAME_RENDERED}} |
| Unique vertices | {{GAME_VERTICES}} |
| Conservative reduction error bound | {{GAME_ERROR}} m |
| Original cylinder approximation bound | {{GAME_SOURCE_ERROR}} m |

The package validator checks reference integrity, unique occurrence/definition IDs, finite poses, material slots, opacity ranges and geometry-derived counts. Missing definitions are errors, not zero-cost instances. This shared package interface is also used by the door.

## 9. Physics: residual compilation and two independently verified solvers

The physics example is a prescribed planar four-bar linkage. Ground pivots are O=(0,0) and D=(g,0). The driven crank endpoint is A=(a*cos(theta), a*sin(theta)). The remaining point B=(x,y) must satisfy the coupler and rocker lengths b and c.

The frontend eliminates fixed and driven coordinates and emits two residuals:

```text
r1 = ((x-Ax)^2 + (y-Ay)^2 - b^2) / (2*b)
r2 = ((x-g)^2  + y^2       - c^2) / (2*c)
```

These scaled residuals have length units and approach signed length error near a solution. Their symbolic DAG is lowered by the same `math.compile-tape` pass used for the CAD sketch. The tape removes unreachable nodes, folds constant operations and interns shared instructions, preserving source-expression origins. It does not perform floating-point reassociation under an assumption of exact real arithmetic.

Forward automatic differentiation computes the Jacobian. The numerical solver forms a damped augmented least-squares system, scales damping using Jacobian column norms and solves each step with Householder QR. It accepts only residual-reducing trials, increases damping after rejection and reduces it after acceptance. A separate reorthogonalized rank diagnostic checks whether the local Jacobian has numerical full column rank. It establishes neither global uniqueness nor global convergence. QR-based least-squares solving is a standard numerical building block; the implementation here is self-contained rather than a LAPACK binding. [R3]

Initial coordinates, tolerance, iteration bound and sampling order are explicit inputs. Continuation uses the previous verified sample only within that invocation. There is no hidden global warm-start state. The alternative solver recognizes the exact four-bar topology and intersects two circles, choosing the explicitly declared assembly branch. Both results are verified against the same residual tape and independently computed link lengths.

![Four-bar linkage samples and the actual coupler-point trajectory](figures/03-four-bar-motion.png)

The default ground, crank, coupler and rocker lengths are 1.2, 0.35, 1.0 and 0.8 meters. The input describes 65 samples over one complete crank revolution in four seconds, beginning at 0.15 radians. Both branches are supported explicitly; an unsuitable numerical seed that converges to the wrong branch is rejected.

{{PHYSICS_TABLE}}

The selector currently requires both candidate computations to succeed. A bad numerical seed can therefore abort comparison even if the closed-form algorithm could produce a solution; failure-tolerant optimization search is not implemented. For the valid default inputs, the policy selects the closed-form candidate because it requires fewer residual/Jacobian evaluations while satisfying the error constraint. This metric is a deterministic work proxy. Counted tape arithmetic excludes linear algebra, circle construction, allocation and orchestration, and is not a total runtime estimate. Errors close to floating-point precision are observations of this example, not a meaningful promise of physical accuracy.

Tests compare AD derivatives with central finite differences, solve an independently specified coupled system, test rank and iteration failures, compare the two solvers, check every link length and body endpoint, and reject unreachable, singular, concentric and wrong-branch configurations. The recorded iteration checkpoints show accepted and rejected trials, residuals, damping and step norms.

## 10. Integration: an animated mechanical door

The door demonstrates composition through explicit schemas. Two ports are extracted from named CAD bore surfaces. A rigid-body assembly refers to ports and revolute joints. The adapter validates the supported arrangement and emits the same physics constraint-graph kind as the standalone linkage frontend. The existing residual, tape, numerical, closed-form and selection tasks consume that graph unchanged.

The left bracket uses its first mounting port, and the right bracket uses its second. The physical pivot span is therefore:

```text
groundSpan = supportOriginSpacing + rightPort.x - leftPort.x
```

At default settings the CAD offset is 0.06 m and the support-origin spacing is 1.14 m, giving a 1.20 m ground span. This is an actual CAD-to-mechanism dependency. Increasing the bracket width to 0.16 m changes the span to 1.22 m and invalidates the dependent mechanism. Changing the bore diameter leaves the attachment coordinates unchanged and preserves it.

![Mechanical door assembled and posed using verified physics samples](figures/04-composed-door.png)

The exported scene contains six definitions and seven occurrences: a shared bracket used twice, a support rail, three links and the leaf. The leaf follows the rocker body pose. The default result has 732 unique and 1,404 rendered triangles, 65 recorded animation samples and one local box collider for each definition.

Collision proxies are computed from actual mesh bounds. Each box is conservative in local coordinates and follows the same occurrence pose as the visible mesh. The animated package validator checks containment; tests transform both mesh vertices and collider corners at every sample and check the exported world-space result. Bores and concavities are filled by these boxes. This is useful collision geometry, without claiming a contact-response simulation.

Tests independently transform both endpoints of every assembly joint using the exported scene poses. They also check the actual CAD mounting placement, prescribed driver phase, full-cycle endpoints, occurrence identity, body-order-independent provenance, collider integrity and cross-domain invalidation. Those checks exercise the interfaces between modules rather than merely trusting the solver's status field.

## 11. Recorded incremental experiments

The demonstration applies edits cumulatively, except for the explicit recovery run that restores all baseline inputs. Every successful full-project run requests the same 57 logical tasks. Cache validation can stop early in a failed branch, so a failed run need not visit all tasks.

{{SCENARIO_TABLE}}

![Observed task execution, cache reuse and failures across the recorded scenarios](figures/05-execution-counts.png)

The counts describe actual invocation status. They are not inferred from a dependency diagram and are not timing benchmarks. Invocation durations include the waits for required tasks; summing them would double-count dependency work. Full trace retention and snapshot generation also have a cost not represented by a domain's arithmetic-operation metric.

The most instructive edit is the enlarged-hole scenario. Within CAD, exactly the feature history, solid, mesh and analysis execute, while six other stages are reused. Door port extraction executes and returns equal semantic content. That equal revision stops invalidation before assembly, residual compilation and motion. The door's collected geometry, collision analysis and final asset are reconsidered as appropriate. Unrelated game and standalone physics tasks remain cached.

The failure scenario requests oversized bores. The feature history can be a well-formed description of the requested operation, but evaluating the invalid solid fails. The downstream bracket mesh and door are not produced for that run. Diagnostics and failed requests remain queryable. Restoring the baseline reuses earlier valid variants; an explicit mesh eviction then forces that mesh alone to execute while downstream equal-content results remain reusable.

## 12. Developer workbench

`output/index.html` is a self-contained application with embedded trace data, JavaScript and styles. It opens directly from a local file. No remote font, analytics service, rendering backend or authenticated session is required.

The workbench provides a run selector, searchable task timeline, status filters, artifact/JSON inspection, cache manifests and reasons, decision alternatives, checkpoints, diagnostics, the four graph projections, source inputs and revision comparison. Its query panel delegates to the shared query implementation. Its execution graph uses recorded requests so failed children remain visible.

Views are registered by IR kind. Meshes and scenes get an orbitable orthographic preview; physics gets a linkage view and recorded sample playback; the door gets scene playback driven by actual exported occurrence poses. Graph and JSON inspectors remain available without a domain-specific renderer. Large graph projections and diffs are bounded in the UI; the complete records remain in the trace and query data.

The Inputs panel supports actual local recompilation. It parses edited JSON values, initializes a compiler from the selected context, runs all four examples, and replaces the displayed snapshot with the resulting live history. The first live run starts a fresh cache; later live runs retain it until the page is reloaded. Failed compiles remain inspectable. The bundled browser and command-line application use the same TypeScript runtime and domain implementations. CPU-heavy passes execute on the main JavaScript thread and can pause the UI; asynchronous task orchestration supplies neither worker parallelism nor cooperative cancellation.

Animation playback shows recorded samples at their declared times; interpolation is explicitly absent. Mesh preview rendering is a small CPU canvas viewer rather than a production graphics engine. It is sufficient to inspect surfaces, instances, motion and provenance while keeping the delivered application free of runtime libraries.

Browser validation opened the standalone file, exercised the recorded UI, checked a mobile viewport, compiled live cold/warm/edited/failing inputs, and checked for page or console errors. The retained browser evidence lists the exact actions and observations. [E3]

## 13. Verification and what it demonstrates

The verification suite contains {{TEST_COUNT}} automated tests across {{TEST_FILES}} modules. It includes independently computed numerical/geometric expectations, negative cases, incremental execution assertions, cross-domain composition and regression tests for faults found during independent review. There are no skipped tests in the delivered successful run.

| Area | Important independent checks |
| --- | --- |
| Data and identity | Platform SHA-256 agreement, canonicalization rejection cases, immutable input/artifact snapshots |
| Execution and cache | Conditional dependencies, diamond sharing, transitive pass versions, stale child parameters, reversion, eviction, cycles, drained failure, missing-input/failure fallback recovery |
| Queries and strategies | Entity lineage, exact revision analysis, absent-versus-null differences, heterogeneous fixed points, deterministic ties, feasibility explanations |
| Geometry and CAD | Analytic area/volume, actual bore rays, connected topology, approximation convergence, true constraint sparsity and precise invalidation |
| Game | Independent mesh-distance sampling, canonical primitive validation, face correspondence, definition instancing, material-only and policy-only reuse |
| Math and physics | Finite-difference Jacobians, independent residual formulas, coupled QR solve, rank/nonconvergence, both branches and solver agreement |
| Door integration | World-space joint closure and CAD mounting, all sampled poses, collider containment and semantic invalidation boundaries |
| Workbench | Query equivalence, failed-request graph, bounded comparisons, safe embedded JSON and IR-view registration |
| Extensibility | New IR and analysis on two domains, a third producer, parsed import boundaries and separate-process reproduction |

The extension proof registers a semantic-face area inventory as a new kind and analysis. The same pass consumes a CAD mesh, a game mesh and an independently registered third mesh producer. No core or existing domain code is edited to accommodate it. Its incremental behavior is checked by changing only the CAD geometry.

The reproduction test compares every intermediate artifact and all four final roots from two independent Node processes. It reverses input key order and changes trace detail. Equal semantic outputs retain equal revisions; clocks and invocation identifiers are deliberately excluded. This verifies reproducibility in the tested Node environment, not bit-identical transcendental math across all JavaScript engines or hardware.

Review found real defects before delivery: stale dependent requests during cache validation, cached fallbacks hiding recovery, incorrect run cleanup after parallel failure, mutable request manifests, missing/null comparisons, cross-kind fixed-point detection, locale-sensitive ties, incomplete mesh error contracts, broken many-to-one provenance, reordered-body correspondence and insufficient collider validation. Each was fixed and retained as a regression. The report treats that evidence as more significant than the raw test count.

## 14. Limits and remaining engineering work

| Area | Implemented limit | Implication for a larger system |
| --- | --- | --- |
| Geometry | One analytic bracket family; boxes, cylinders and a roof prism; compound concatenation | Add independent kernel adapters and correspondence contracts before arbitrary CAD construction |
| Persistent naming | Semantic names within recognized constructions | General Boolean topology changes need a domain naming policy and ambiguity handling |
| Mesh validation | Finite/index checks, edge incidence, orientation, connectivity and tested families | Arbitrary meshes still need self-intersection and solid-validity checks |
| Simplification | Canonical cylindrical ring reduction | Arbitrary topology needs a separately validated simplifier with suitable error semantics |
| Constraints | Dense scalar Euclidean least squares and one planar mechanism family | Larger or spatial systems need sparse structure, manifold updates and stronger conditioning/continuation policies |
| Physics | Prescribed kinematics and discrete samples | Dynamics, contact, friction, impacts and continuous collision remain separate work |
| Units | Explicit meter/radian/second conventions at supported boundaries | No general dimensional algebra or automatic conversion is implemented |
| Pass trust | Explicit version/dependency discipline | Hidden side effects cannot be detected automatically in ordinary JavaScript |
| Scheduling | Async orchestration in one JavaScript thread | CPU parallelism requires workers, cancellation and resource ownership contracts |
| Storage | Bounded in-memory cache; exportable records | Cache persistence, backend fingerprints, migration and failure-safe writes are not implemented |
| Trace retention | Summary/full checkpoints, but session records retained without a global memory limit | Long interactive sessions need retention policies, indexing and lazy artifact loading |
| Typing | Typed pass implementations with runtime output validators | Stronger typed task handles or required-kind checks would make incorrect composition harder |

These limits do not invalidate the demonstrated reuse. They identify where an additional module, capability contract or backend belongs. The next step should be selected by a real consumer rather than introducing a universal AST, solver or storage abstraction in anticipation of every future compiler.

A practical next increment is one additional frontend that reuses an existing boundary: a 2D assembly editor supplying the physics graph, a different parametric mesh feeding the area analysis, or a second scene exporter consuming the shared package. A persistent artifact store becomes useful only when process-level rebuild cost and data volume justify it. A general CAD kernel should be introduced behind geometry and correspondence interfaces, with its ownership and tolerance semantics explicit.

## 15. Reproduce, inspect and extend the workspace

The workspace includes TypeScript source, generated ESM JavaScript and declarations, the lockfile, installed development tools for the build platform, tests, module notes, the full trace, sample assets, reports and verification records. The browser artifact is already bundled. Command-line execution of prebuilt code needs Node.js 22 or later and no package installation.

```bash
node dist/examples/run.js
node scripts/serve.mjs
```

For development, `npm run verify` type-checks and builds, runs all tests, saves test evidence and regenerates the demonstration. On another platform, install development dependencies from the lockfile first so esbuild has the appropriate native binary.

```bash
npm ci
npm run verify
```

Custom mode records a baseline and a supplied configuration. This allows the resulting workbench to compare actual output revisions and cache behavior:

```bash
node dist/examples/run.js --set cad.holeDiameter=0.018 \
  --out output/custom-hole
node dist/examples/run.js --set game.objective=quality \
  --out output/custom-quality
```

The detailed query exports are in `output/queries/`. The data-only assets are in `output/assets/`. `output/reproduce.json` records baseline inputs, algorithm descriptors, schema descriptors and expected output revisions. `validation/test-results.tap` retains the complete test execution record.

The PDF is rendered from the delivered Markdown. `scripts/write-report.py` fills evidence tables from generated JSON, `scripts/make-figures.py` draws figures from actual artifacts, and `scripts/render-report.py` produces the PDF. These reporting scripts use Python libraries separately from the TypeScript compiler runtime. Their dependency file is included.

## 16. Design conclusion

The examples support the proposed decomposition. The shared object is an inspectable computation over versioned, validated artifacts. Each domain keeps its own semantics and IR shape. Strategies operate on explicit alternatives and metrics. Queries operate on recorded evidence. Views consume those records through kind-specific projections.

The strongest evidence is the way edits stop at meaningful boundaries: equal attachment coordinates preserve a mechanism despite a changed CAD solid; a policy change selects among cached meshes; appearance changes leave geometry intact; and an independently added analysis can consume multiple frontends without changing them. The implementation provides a concrete foundation for extending those boundaries while keeping their assumptions visible.

## 17. Sources and evidence

### Delivered implementation and generated records

- **[E1] Generated experiment data:** `output/summary.json`, `output/trace.json`, `output/reproduce.json`, and `output/queries/`. These are the sources for all task counts, artifact metrics, cache observations and recorded example failures.
- **[E2] Automated verification:** `validation/tests.json`, `validation/test-results.tap`, and the files under `tests/`. These support the verification totals and acceptance claims. The independent import and reproduction tests are in `tests/extensibility.test.mjs`.
- **[E3] Browser and recovery evidence:** files under `validation/` describing workbench actions, errors, screenshots and archive recovery. These support the interaction and restoration claims.
- **[S1] Runtime and queries:** `src/core/types.ts`, `records.ts`, `data.ts`, `runtime.ts`, `query.ts`, and `strategies.ts`.
- **[S2] Reusable algorithms and schemas:** `src/math/`, `src/geometry/`, `src/scene/schema.ts`, and `src/assembly/planar.ts`.
- **[S3] Domain and composition implementations:** `src/domains/`, `src/adapters/assembly-physics.ts`, and `src/examples/project.ts`.
- **[S4] Developer workbench:** `src/workbench/`, with `scripts/build.mjs` supplying its standalone browser bundle.

### Primary background references

- **[R1] MLIR, Pass Infrastructure.** Analysis management, preserved analyses, pass instrumentation and failure reporting. Consulted 24 November 2026. https://mlir.llvm.org/docs/PassManagement/
- **[R2] LLVM, Remarks.** Structured successful, missed and analysis optimization remarks, including serialized records. Consulted 24 November 2026. https://llvm.org/docs/Remarks.html
- **[R3] LAPACK Users' Guide, Linear Least Squares Problems.** QR/LQ and rank-sensitive least-squares formulations. The delivered solver is an independent TypeScript implementation. https://netlib.org/lapack/lug/node27.html
