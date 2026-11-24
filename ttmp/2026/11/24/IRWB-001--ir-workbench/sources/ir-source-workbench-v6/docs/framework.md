# Framework invariants and verified extension boundaries

## Module structure

This project contains several cooperating compiler pipelines. They share protocols and useful intermediate representations; they do not have to share one universal AST or one mandatory sequence of levels.

| Module | Responsibility | Permitted implementation dependencies |
| --- | --- | --- |
| `core` | Immutable artifacts, pass registration, execution, dependency tracking, cache, provenance, queries, strategies | `core` |
| `math` | Symbolic scalar expressions, residual programs, numeric tapes, differentiation, nonlinear solving | `core`, `math` |
| `geometry` | Indexed meshes, bounded geometric constructors, transforms, geometric/topological analysis | `core`, `geometry` |
| `scene` | Reusable mesh definitions, rigid occurrences, appearance and scene-package validation | `core`, `geometry`, `scene` |
| `assembly` | Named rigid bodies, local ports and explicit joint connections | `core`, `geometry`, `assembly` |
| `domains` | CAD, modular-building, linkage, and composed-door languages and policies | Public lower-level interfaces; the door is an explicit composition frontend |
| `adapters` | Narrow conversions between independently meaningful schemas | The public schemas and constructors at each end |
| `workbench` | Read-only inspection and registered views; a browser entry point can compile edited inputs | Trace/query data, view schemas, and application composition |

The import-boundary test parses actual TypeScript import declarations, re-exports, type imports, and literal dynamic imports. It checks the reusable modules against this table and rejects domain, adapter, example, workbench, platform, or package imports there. The assembly-to-physics adapter is deliberately outside this restriction: its purpose is to join public assembly and mechanism interfaces. This is a static dependency check, not a proof that all future concepts are perfectly factored.

## Identity and data

Three identities are separate:

- A **task ID** is a logical computation name. It survives edits. Within a run, one ID must name one pass/parameter definition; conflicting definitions fail.
- An **artifact revision** hashes the output kind, schema version, and canonical value. Equal values under different kinds are different revisions. A code change producing the same typed value can preserve its revision.
- An **entity ID** names something inside an IR: a face, body, port, expression, or occurrence. The domain supplies correspondence when it transforms those entities.

`contentHash` hashes the value alone. It is useful for content comparison but insufficient to establish equivalence across IR kinds; fixpoint detection therefore uses the complete revision. The store addresses an artifact by logical ID plus revision. Definitions and occurrences explicitly encode sharing instead of relying on JavaScript object identity.

Stored values are cloned, canonicalized, and deeply frozen. They must be finite, acyclic JSON data made of plain records and arrays. Functions, accessors, unsupported objects, undefined values, sparse arrays, and cyclic JavaScript references are rejected. Object-key order is normalized; array order remains meaningful; negative zero is normalized to zero. A graph with semantic cycles is represented with IDs and edges, not cyclic JavaScript object references.

## Pass execution and cache contract

A pass declares an ID, explicit algorithm version, output kind, description, role, and optional cache policy. Its output is checked by the registered kind validator. Typed `ctx.require<T>` does not itself prove an input's runtime kind; passes that accept open extension points should check the kind and use the public schema validator, as the extension test demonstrates.

Passes obtain changing source values through `ctx.read` and other artifacts through `ctx.require`. These calls record the exact successful reads and artifact revisions used. A run takes an immutable input snapshot, so edits during compilation affect subsequent runs. Task requests are captured when required, before asynchronous work can mutate a caller-owned request.

The cache validates algorithm version, explicit parameters, output schema, and the recorded dependency manifest. It revalidates transitive tasks even when considering a cached parent. If an upstream task recomputes to the same typed content, the parent can remain cached. Validation stops when a changed dependency could invalidate later, dynamically constructed requests. Historical variants can be reused after inputs are restored. LRU or explicit eviction is distinguished from a semantic change in the cache explanation.

Cache correctness still depends on a **trusted pass contract**: changing behavior must appear in a declared input, task parameter, dependency, or algorithm version. The runtime cannot discover arbitrary hidden closure state, filesystem reads, network calls, random generators, or clock reads inside user-supplied JavaScript. It deliberately does not hash function source as a substitute for declaring those dependencies.

Independent requests can run concurrently. Identical task requests are deduplicated within a run, and dynamic dependency cycles fail. A failed task is memoized as a failure for that run; its error is not repeatedly executed during validation and fallback handling. A pass that catches a failed requirement or missing input can return an inspectable fallback, but that invocation is not cached. The run retains failed status when a child failed. `cache: false` disables persistent cross-run reuse; it does not mean repeated requests for one logical task execute repeatedly inside the same run.

The runner drains outstanding work before closing after failure. Unawaited requirements produce an explicit error rather than publishing a parent with an incomplete manifest or leaking an orphaned rejection. The registry cannot change while a run is active. Analyses use the same mechanism as transformations and belong to exact immutable input revisions; there is no mutable-IR preservation/invalidation protocol to maintain separately.

## Four distinct relationships

The implementation records four relationships instead of overloading a single graph:

1. IR structure comes from each kind's registered structural projection.
2. Successful reads and required artifacts form the computation dependency graph.
3. Explicit `derive` records describe cross-IR artifact and entity correspondence.
4. Invocations and requests describe what ran, failed, or was obtained from cache.

`ctx.derive` must refer to an artifact that the pass actually required. Equal-length `from` and `to` lists pair their entries; unequal lengths express all indicated source/target combinations, supporting splits and merges. The runtime does not invent correspondence or verify that a domain's entity names express the intended geometry. Coarse artifact-level relationships can legitimately make entity lineage broad.

`why`, `dependencies`, `history`, `explainCache`, `alternatives`, `lineage`, `compare`, and `diff` are read-only queries over portable records. Calling them does not run a pass. Cached invocations identify their original producer and retain its recorded decisions. Reasons come from explicit algorithm decisions and observed dependencies; they are not reconstructed explanations guessed from a final mesh. Request ancestry includes cache-validation probes and failed requests, so an aggregate source-input explanation can contain more observations than the final successful dependency manifest. Structural JSON diffs distinguish missing fields from explicit null values.

## Strategies and observability

Generic helpers support parallel tasks, sequential composition, bounded fixpoints with cycle detection, and objective-based selection subject to feasibility constraints. Selection retains the evaluated alternatives, their metrics, feasibility reasons, chosen objective, and deterministic tie-breaking. These strategies are ordinary versioned TypeScript pass implementations; this version does not claim to implement a separate serialized strategy language or global search optimizer.

Metrics that affect decisions must be explicit and reproducible. Wall-clock duration is invocation metadata, not a deterministic IR field or an implicit optimization input. Full tracing retains checkpoints; summary tracing omits them. A request for full tracing cannot invent checkpoints from a summary-only cached invocation, so that computation is rerun when necessary.

The offline workbench consumes the same records and public IR values. Views are registered by kind, keeping rendering out of transformation passes. The trace is inspectable JSON; it is not an executable event log that can reconstruct arbitrary external runtime state.

## Extension and reproduction evidence

`tests/extensibility.test.mjs` registers a new `extension.surface-inventory` kind and analysis pass that existing core and domain code do not know about. The identical pass consumes the CAD bracket, the game's polygonal column, and a newly registered box producer through `geometry.mesh`. It receives ordinary validation, provenance, structural projection, metrics, immutability, and caching. Enlarging CAD holes invalidates only the corresponding analysis; the game analysis is reused. The column result is checked against an independent regular-prism area formula.

The same test module compiles the complete four-example project in two independent Node processes. Inputs are equal but supplied in reverse key order; labels, process identities, wall-clock timing, and tracing modes differ. It compares every intermediate artifact's ID, kind, schema version, content hash, and revision, as well as all four final roots. This verifies fresh-process reproduction on the tested Node version, not bit-for-bit agreement across every JavaScript engine, math library, operating system, or future algorithm version.

## Practical limits

The cache is bounded, but the in-memory trace database retains artifacts, invocations, input snapshots, and provenance for the session. Summary mode reduces checkpoint detail; it does not impose a total database memory bound. Large geometry, binary buffers, disk-backed caches, distributed scheduling, and durable trace retention need additional storage policies.

IR schemas, validators, versions, and domain correspondences are application responsibilities. The supplied geometry and mechanism algorithms are deliberately bounded implementations with tested semantics, not generic production CAD or physics kernels. The framework has no external plugin sandbox, automatic code-version discovery, schema migration system, mutable-analysis preservation model, or proof that arbitrary transformations preserve domain semantics. These limits keep the reusable contracts explicit while the examples exercise real computations rather than fabricated snapshots.
