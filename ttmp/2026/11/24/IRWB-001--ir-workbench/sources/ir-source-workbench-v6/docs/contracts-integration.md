# V5 domain integration: semantic pass contracts

## What this implementation adds

The existing compiler, task cache, domain kernels and editable Strategy IR remain the execution mechanism. V5 adds a semantic acceptance boundary to each registered source compiler pass. Every invocation receives a fresh, versioned contract transaction, including invocations whose computational artifact comes from the cache. A result is published only after its typed ports, required properties, postconditions, preservation claims and declared resource effects have been checked.

There are **44 registered pass contracts**: the existing source compiler, domain and cleanup passes, plus the semantic lab passes. All have named, runtime-validated input and output ports. The strongest semantic contracts are attached to transformations where an independently checked statement is useful: mesh cleanup and ring reduction, scene candidate construction and packaging, and sampled mechanism motion. The remaining contracts provide exact IR/schema checks and relevant authored-language preconditions; they do not claim a proof of every algorithm's mathematical correctness.

The reproducible experiment script is `scripts/contracts-demo.mjs`. Its current output records **33 compiler runs: 24 successful runs and 9 intentional failures**, with complete contract and compiler-invocation records for each run under `output/contracts-experiments/`. The failure cases are part of the experiment, not failed test assertions.

## Boundaries and dependencies

| Module | Responsibility | Depends on |
|---|---|---|
| `src/core/runtime.ts` | Task execution, dependency observation, computational cache, generic pass-policy lifecycle | Core artifact/task types; no semantic-contract module |
| `src/contracts/` | Definition registry, analysis/fact validity, transaction verification, effect checking, queries and evidence | Immutable core artifact references and a resource-port interface; no CAD, scene or physics domain |
| `src/contract-examples/domain-semantics.ts` | Pure, independently callable mesh/scene/motion checks | Existing geometry and motion kernels/types |
| `src/contract-examples/domain-contracts.ts` | Named semantic definitions; maps Task parameters/results to typed ports; installs generic policies | Contracts, runtime interface and domain validators |
| `src/contract-examples/lab.ts` | Small real transformations that demonstrate acceptance, rejection, caching and effects | Existing mesh/cleanup kernels and the contracts bridge |
| `src/pipelines/project.ts` | Composition root: installs ordinary passes, captures their IR validators, then installs policies | All compiler modules being composed |
| Strategy IR | Which transformations and candidates run, and why a candidate is selected | The existing compiler bridge; it does not implement semantic analysis |
| Source workbench | Source, plan, invocation, artifact and contract inspection | Serialized execution records and registered source metadata |

IR validators are captured from the ordinary registration process and reused by `defineIR`; there is no second, drifting copy of every domain schema. Array and map ports validate each contained artifact's kind, schema version, revision and content hash. Scalar ports have separate value types, such as a positive integral ring divisor.

The core policy API is reusable for other acceptance mechanisms. It does not know what a property, analysis or correspondence means. The domain adapter is where the two interfaces meet.

## Transaction lifecycle

For every actual pass invocation, the adapter follows this order:

1. Resolve the named input ports through ordinary tracked `ctx.require` calls. These are the same Task dependencies used by the kernel.
2. `AnalysisManager.beginTransformation` captures immutable inputs, validates their types and checks `requires` clauses. Its body context is made available to the kernel through `semanticContext(compiler, ctx)`.
3. If the ordinary compiler cache proposes an artifact, the policy `reuse` hook checks the prior invocation's **body** semantic dependencies. Stale analysis generations, property facts or resource revisions cause computational recomputation. Accepted manifests are imported into the new transaction.
4. Run the kernel if needed. Its declared resource reads and requested analyses/properties become body dependencies. No provisional artifact is published yet.
5. The policy `after` hook verifies the current output under the **current contract version**. It checks output types, correspondence endpoints, preservation rules, postconditions and established properties, on both cold and warm executions.
6. The synchronous `committed` hook atomically commits staged resource writes and accepted facts. The compiler then publishes the artifact and computational cache entry.
7. On any failure, pending semantic requests settle, staged state is discarded, and a terminal rejected/failed execution remains available for inspection. No rejected output or valid provisional output fact is published.

The compiler stores its policy identity/version on the invocation. Contract records are stored in the run extension `contracts.execution`. The extension includes this run's executions, recursively referenced analysis/fact evidence, definition descriptors, and events. It does not repeat the whole manager's history on every run. Both successful and failed runs retain their evidence.

## Concrete semantic contracts

### Ring reduction

`scene.reduce-rings` receives a `geometry.mesh` artifact and a positive integral divisor. It requires a closed, oriented, nondegenerate mesh with semantic surface labels. Its ordinary output remains `scene.reduced-mesh`; the adapter also exposes the nested mesh as a typed semantic projection with an exact revision:

```text
<reduction artifact id>/semantic-mesh
```

The transformation establishes watertightness on that projection and checks a conservative analytic error bound. For a cylinder, the checker reconstructs the expected source and reduced ring geometry from radius, height and segment count and compares actual coordinates, connectivity and face identities. It also verifies the reported source approximation bound. An unchanged mesh must report zero additional reduction error and retain its existing source bound.

Preservation of semantic surface families is explicit. A correspondence records exact source/output artifact revisions, retained vertex coordinates, and face mappings. Coarsened cylinder side faces map the actual group of source segments to the target segment. The transfer verifier checks endpoints, output coverage, vertex equality, semantic family agreement and the family set before reusing the named-surface fact. A caller cannot justify a renamed cap by pointing to a different face merely because that face exists.

This is a supported cylinder-ring bound, not a general Hausdorff-distance verifier for arbitrary meshes. Unsupported arbitrary geometry is retained by the existing reducer; the contract does not invent a general simplification guarantee.

### Vertex cleanup

`geometry.cleanup-one-vertex` and the successful lab mode use the existing cleanup kernel. The postcondition hashes the ordered triangle coordinates and face IDs, independently of vertex numbering, and compares the complete surface before and after each iteration. Removing unused vertices or merging exact duplicate vertices preserves that signature; moving a vertex or changing a face identity does not.

Every output vertex must be justified by an equal source coordinate. Semantic surface labels transfer only through checked correspondence. The fixed-point example has four real cleanup steps and checks every one. Intermediate watertightness is not a precondition: the fixture is deliberately being repaired, and the strategy's final analysis checks the converged result.

The lab kernel also exercises the actual context APIs: `require`, `analysis` and `check`. The preservation invariant records `properties` and `explainProperty` results. Broad fact-store introspection conservatively disables reuse of the frame making that query; putting these developer queries in the acceptance guard leaves the computational body dependency manifest precise.

### Mechanism motion

Each `physics.sample-motion` result is checked against the solver settings. The checker recomputes link-length errors and normalized loop residuals from sampled point geometry, and compares them with both the requested tolerance and the reported measurements. It checks ground anchors, driven crank position, assembly branch, all four body poses, sample count, time schedule and angle schedule. Floating-point comparisons include an explicitly recorded scale-relative numerical slack.

This checks the sampled four-bar solution actually produced by the supported solver. It does not establish continuous-time behavior between samples or cover an arbitrary constraint language.

### Scene candidates and packaging

`scene.build-candidate` checks that each resulting definition uses its actual reduced mesh and authored material slot. Aggregate reduction/source bounds must match the component bounds. An independent instance-weighted triangle count must agree with the candidate's cost analysis.

`scene.package` checks exact preservation of selected geometry, occurrences, material values, name, selected LOD and metrics. Its established scene-consistency property also checks unique definition/instance identities, resolvable material and geometry references, watertight component meshes, and independent triangle counts.

Candidate materialization preserves v4's editable Strategy IR behavior. The compiler bridge filters materializer candidate Task parameters to candidates actually evaluated in the current run. Contract input resolution uses that filtered list; it does not silently resurrect a removed optimization branch. Necessary ordinary Task dependencies can still be resolved lazily and remain linked in the Strategy IR evidence.

## Analysis, properties and objectives

An analysis record is keyed by its definition/version, parameters and exact artifact revision. It stores its value and all analysis, property and resource dependencies. A cache hit is valid only while those dependencies and explicit invalidation epochs remain valid. Explicit invalidation changes the generation used by the dependency manifest even when recomputation returns the same numeric value.

A property fact distinguishes four assurance levels:

| Assurance | Meaning |
|---|---|
| `declared` | An assertion has been recorded; it does not satisfy a required verified property |
| `checked` | The registered checker evaluated this exact revision and its dependencies |
| `transferred` | A registered transfer verifier justified reuse across exact revisions and a correspondence |
| `proof` | A configured external verifier accepted a supplied certificate; trust remains in that verifier |

The shipped domain examples use checked and transferred evidence. The experiment script separately records an assertion and its later checked result. No domain check is presented as a mathematical proof, and the framework does not contain a theorem prover.

`defineObjective` supplies a numeric analysis plus minimization/maximization direction. `semantic.min-rendered-triangles` operates on a real `scene.lod` artifact. Candidate acceptance uses its analysis and compares it against independently counted triangles. The experiment explicitly calls `evaluateObjective` on the building's evaluated divisor-four candidate and obtains **2,120 rendered triangles**, with the exact analysis record and subject revision saved to `property-and-objective-queries.json`.

The existing Strategy IR objective still drives candidate choice. The semantic objective is a separately inspectable, checked cost measurement; this integration does not claim a new optimization algorithm.

## Two resource cases with different cache behavior

The safe in-memory resource port supports versioned reads and compare-and-swap commit of staged writes. Permissions are declared by exact effect definitions. Analyses and invariants may read declared resources; they cannot declare writes. Transformations with writes use `cache: 'never'`.

The lab deliberately distinguishes two cases:

- **Guard resource:** `resource-bound` returns unchanged mesh geometry, then checks volume against `mock:volume-limit`. Changing the limit from 10 to 1 rejects a previously cached volume-six artifact during current postcondition evaluation. Restoring the limit to 10 accepts the same cached geometry. Its body dependency list is empty because the resource did not compute the geometry.
- **Body resource:** `resource-derived` reads the limit while computing X coordinates. With limit 10, the mesh volume is 6 and maximum X is 2. Changing the limit to 20 forces the body to rerun, yielding volume 12 and maximum X 4. A subsequent unchanged run reuses that output with the imported resource dependency. This closes the gap where a compiler cache could otherwise serve stale resource-derived geometry despite fresh postconditions.

`commit-effect` increments an in-memory counter only after acceptance. Two accepted executions produce two increments. `rollback-effect` stages the same increment and then violates surface preservation; no increment commits. The effect-violation mode attempts an undeclared read and is rejected before access. There are no actual network or file effects in these experiments.

## Failure classification and retained evidence

Semantic rejection and implementation failure are different terminal outcomes. A false postcondition, invalid positive-integer precondition, rejected preservation justification or undeclared effect produces a `ContractError` with a specific code and a rejected contract execution. A checker that throws an ordinary implementation exception produces a failed execution with `contract-error`; it is not silently treated as a feasible-search failure.

Both make the registered compiler pass fail and stop its compiler run. The v4 task runtime does not support rolling back a failed invocation and continuing that same compilation as though the failure had never occurred. Strategy-level expected candidate infeasibility remains the separate, explicit StrategyRejection mechanism. The semantic manager's standalone transaction API can be used to inspect separate candidate transactions; this integration makes no claim that every failed compiler pass is recoverable.

Previously accepted input artifacts remain available. A rejected provisional output does not enter the artifact database or computational cache. Provisional analysis/fact history may remain in the trace as `valid: false`, with the reason it was discarded. This makes the failure inspectable without presenting its claims as established facts.

## Measured domain runs

Each cold run below has an accepted contract execution for every actual compiler invocation. Each warm run executes zero kernel bodies while still producing all current semantic checks.

| Example | Cold kernel executions | Warm cached invocations | Semantic clause checks per run |
|---|---:|---:|---:|
| Building | 59 | 59 | 226 |
| Pavilion | 35 | 35 | 118 |
| CAD bracket | 12 | 12 | 6 |
| Four-bar linkage | 11 | 11 | 6 |
| Mechanism door | 49 | 49 | 73 |
| Mesh cleanup | 7 | 7 | 16 |

These clause counts exclude the implicit typed-port validation, so a contract with zero clauses still checks exact input/output schemas. Analysis/property cache reuse is separately recorded; a warm acceptance check can reuse valid analysis evidence while still checking whether its dependencies and contract version remain current.

Additional measured cases cover all nine lab modes, a tighter contract version applied to an old cached artifact, explicit analysis invalidation, a changed body resource, a changed guard resource, accepted and discarded writes, and a deliberate checker callback bug. `tests/contract-integration.test.mjs` asserts domain behavior and adversarial cases. Existing Strategy IR tests remain the regression gate for edited branches, source attribution, version pinning and computational cache behavior.

## Reproduction and practical limits

```bash
npm run build:source
node --test tests/contract-integration.test.mjs
node scripts/contracts-demo.mjs
```

The bridge is intentionally explicit: the mapping from each pass's Task parameters to typed contract ports belongs to the domain integration module. Adding a pass without such a mapping fails installation instead of silently running without a contract. A generic pass-description refactor is a separate future task.

Validators and checkers are trusted TypeScript implementations. Dependency capture is sound only for data read through the supplied context/resource interfaces; arbitrary JavaScript globals, direct I/O or side effects bypassing those interfaces are outside the model. `MemoryResources` demonstrates atomic versioned effects in-process; integrating an external resource system requires an implementation of its atomic commit contract. Dynamic geometry checks, sampled residual checks and checked transfers provide explicit evidence at the stated scope, not universal formal verification.
