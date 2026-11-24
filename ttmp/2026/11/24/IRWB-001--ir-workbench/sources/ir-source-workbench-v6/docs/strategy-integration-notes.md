# V4: Strategy IR integration with the real compilers

## Ownership and public APIs

The domain-neutral language, validator, editing APIs, registry and interpreter live in `src/strategy`. The compiler adapter and reusable domain plan generator live in `src/pipelines/strategy.ts`. Individual CAD, scene and mechanism transformations remain in the existing domain pipeline modules. `src/strategy-examples/cleanup.ts` supplies a real geometry fixed-point example and its strategy.

`compileProgram(compiler, program, label, prefix, options)` now executes a Strategy IR plan for all five authored programs. The first four parameters and the existing `{ value, run }` result are preserved. The result also contains `strategy: { plan, trace }`. Options accept an edited `strategyPlan`, an abort signal, a node budget, and a concurrency limit.

Other public entry points:

- `prepareStrategyProgram(program, prefix)` produces immutable task descriptors and dynamic iteration inputs.
- `planProgramStrategy(program, prefix)` builds a serializable default strategy with exact pass-version requirements.
- `getProgramStrategyRegistry(compiler, run?, plan?)` provides registry descriptors for validation; execution also receives the active run and plan.
- `strategySnapshot(compiler)` returns the executed plan and complete trace for each recorded strategy run, including failed and cancelled runs.
- `planCleanup`, `prepareCleanupInput`, `getCleanupStrategyRegistry`, and `compileCleanup` provide equivalent APIs for the mesh cleanup example.

Every completed strategy execution is stored in the compiler run extension `strategy.execution`. The generic compiler runtime treats this as immutable data and has no dependency on the Strategy IR package. Consequently exported compiler traces preserve the executed plan, dynamic execution records, explicit failures, cache explanations, and actual algorithm versions.

## How plans control the real work

The CAD plan schedules source projection, constraint lowering, numeric tape creation, sketch solving, feature elaboration, analytic recognition, and tessellation. A `require` node computes mesh analysis without replacing the current mesh. A `verify` node checks its watertightness. The final checkpoint records the analysis reference.

The scene plan uses `parallel` for independent projections. `forEach` traverses the authored geometry definitions, and `conditional` chooses primitive tessellation or imported CAD compilation. Each LOD candidate is a named `fork` branch. Its reductions use `forEach`; `attempt` first checks ring-reduction applicability and falls back to exact retention when the mesh topology does not support that algorithm. The fallback is a recorded, explicitly recoverable strategy rejection, not a swallowed compiler exception.

`chooseBest` performs the actual constrained optimization over evaluated artifacts. It records the objective, constraints, all alternatives, measurements, rejection reasons, and deterministic tie-breaking. A small materialization path in the existing selection pass then packages the chosen candidate and provenance. It does not rerun the selection algorithm. It considers only candidates that actually produced an artifact in the current run, so removing a candidate branch from an edited plan prevents its work even when an older cached candidate exists.

The scene selection artifact retains the authored policy in its existing `objective` and `maxError` fields. Its additional `strategySelection` describes the actual executed plan objective and constraints. The materialization decision labels the authored objective explicitly. `chooseBest` binds its immutable decision with `decisionAs`; materialization receives that exact lexical binding. A later choice over the same candidate artifacts cannot overwrite the earlier choice's causal evidence. This distinguishes an authored preference from a developer's edited optimization plan. The authored maximum error remains a hard validation bound at materialization.

The mechanism plan shares assembly recognition, residual lowering and numeric tape creation, then forks the numerical and closed-form solvers. Each candidate is independently verified against the same link-error budget before `chooseBest`. The selected artifact is materialized with provenance. Door compilation composes this plan with imported CAD geometry and the ordinary scene plan.

## Fixed-point example

The mesh cleanup lab starts from a box with eleven vertices: its eight required vertices, two unused vertices, and one duplicate vertex used by one triangle. `geometry.cleanup-one-vertex` removes exactly one unused vertex or welds exactly one duplicate per invocation. It preserves every oriented triangle's coordinates and semantic face identity, checked explicitly by the implementation.

`repeatUntilStable` therefore performs three changing iterations and a fourth stable iteration. Its identity analysis compares the resulting artifact kind and content revision, ignoring logical task IDs that intentionally differ per iteration. The result has eight vertices and becomes watertight. The original surface geometry and volume remain the same. A two-iteration budget fails explicitly and preserves the partial execution evidence; it does not present a partially cleaned mesh as a successful result.

Together, the ordinary examples and this lab execute all thirteen operators listed in the proposal. The earlier conversational total of fourteen was a counting error; no named operator was omitted.

## Version and dependency semantics

Plans carry a `requirements` manifest pinning the full compiler task dependency closure, independently of explicit scheduling nodes. Every manifest entry resolves against the exact registry version before execution. The adapter also checks the actual nested task closure against this manifest before requesting a task. Removing an explicit source step cannot silently allow a newer source pass to execute as an indirect dependency.

The compiler still owns data dependencies. If a developer removes an explicit scheduling step that a later pass requires, the pass can resolve that necessary dependency. The bridge links its actual invocation to the requesting strategy execution and records `required compiler dependency` evidence. Removing a schedule node is therefore distinct from changing the pass's required inputs. Candidate branch removal is different: omitted optional alternatives are not requested by selection materialization.

Compiler pass IDs and cache identities are preserved. Strategy control flow executes on every compilation so the new run has its own branches, iterations, decisions, and cache links. The real artifact transformations can be cached. Warm compilation therefore reconstructs an honest strategy trace while reusing all pass artifacts. Material-only edits retain independent meshes and reductions; policy-only edits retain evaluated candidate geometry.

## Failures, cancellation and retained work

Only explicit `StrategyRejected` conditions are recoverable by `attempt`, and only configured rejection codes select its fallback. Invalid imported geometry, missing algorithms, runtime errors and other compiler failures remain fatal. Completed sibling artifacts may remain in the compiler cache after failure or cancellation. There is no claim of transactional rollback.

Cancellation is cooperative at strategy and algorithm boundaries. Existing synchronous numerical and geometric pass bodies are not preempted midway. If a pass commits before cancellation is observed, its invocation remains linked in the cancelled trace. Version-validation failures occur before a strategy starts, so they produce validation diagnostics rather than a fabricated execution history.

## Verification and reproducibility

`tests/strategy-integration.test.mjs` compares the final artifact values of all five default examples against their legacy task plans, verifies explicit and implicit invocation links, checks warm caching, exercises edited strategies and omitted branches, rejects transitive version mismatches, inspects failure and cancellation traces, and proves nontrivial fixed-point behavior.

`node scripts/strategy-demo.mjs` creates reproducible runs under `output/strategy-experiments`, including per-run plans, strategy traces, final artifacts, a structured summary, and the complete compiler snapshot. It checks that all thirteen operators executed and that every compiler invocation has a strategy link.

This release implements the Strategy IR scope. Semantic property contracts, general IR pattern matching, generic rewrite transactions and universal correspondence APIs remain separate later work. Existing bounded CAD and physics backends keep their documented domains; a reusable control language does not expand their geometric or physical capabilities.
