# IR Source Workbench — 0.2

A standalone TypeScript experiment in compiling embedded languages. This version is source-first: the authored programs are real executable TypeScript modules, not configuration objects manufactured by compiler passes. The previous parameter-driven project is retained in `src/examples/`, `src/domains/`, and `docs/README-legacy.md` as a regression reference. The new workbench does not use those domain registrations.

## Open the workbench

Open `output/source-workbench.html` in a browser. It includes TypeScript's transpiler, the actual compiler/runtime, all five authored programs, all source files and the visualization code. No server, installation, service, or network access is required. The editor runs **trusted local code only**, in a worker with an eight-second evaluation timeout and a restricted module resolver; this is not a security sandbox. Browser source edits receive TypeScript syntax/transpile diagnostics and runtime domain validation, not full static type checking. Disk sources are checked by strict `tsc` on build.

1. Select Building. The left panel is the actual `src/programs/building.ts`, including its definitions and placement loops. Change `floors = 2` to `floors = 3`, click **Compile source** (or Ctrl/Command+Enter), and inspect the resulting 103 occurrences.
2. Select any invocation. **IR data** is the actual immutable output; **Why / cache** shows recorded dependency manifests, decisions, and derivations; **Pass code** jumps to the exact implementation and opens the full compiler source catalog.
3. **Executed source** displays the exact source set captured for the selected historical run, not the current editor draft. The same pass inspector includes graph, comparison, query, and provenance views. **Focus passes** hides the editor and preview to fit the inspector into the viewport.
4. Edit the bracket or linkage, switch to Mechanical door and compile again. The door imports those exact authored modules. **Save source set** saves all five draft files as JSON; **Load source set** restores them. Individual TypeScript files and IRs can also be downloaded. Session edits and traces are in memory; save them explicitly.

## Build and test

With Node 22 or newer, in this directory:

```sh
npm run verify
```

This builds strict TypeScript and both workbench bundles, runs all automated tests, and records source-driven experiments under `output/source-experiments/`. The included `node_modules` is the original pinned dependency installation for Linux x64. On other platforms run `npm ci` first. To rebuild just the source-first HTML: `npm run build:source`. To record the experiments again: `node scripts/source-demo.mjs`. Optional real-browser regression: `python scripts/check-source-browser.py` (requires local Python Playwright and Chromium; set `CHROMIUM` if needed). The Node build/test path does not require Python.

## The programs

| File | User-authored semantics |
|---|---|
| `src/programs/building.ts` | Modular building: explicit geometry definitions, materials, floors, window/door placement loops, roof, columns and LOD policy. |
| `src/programs/pavilion.ts` | Circular pavilion: unrelated scene composition using the exact same primitives and passes. |
| `src/programs/bracket.ts` | Ordered named sketch, extrusion, upright and two through-hole operations. |
| `src/programs/linkage.ts` | Explicit rigid bodies, ports, revolute joints, drive, branch and solver objective. |
| `src/programs/door.ts` | Imports bracket and linkage as programs; declares scene definitions, instances and body attachments. |

There is no compiler-specific registration or runtime import in these programs. They execute ordinary TypeScript loops and helpers to produce validated plain domain data via persistent builders. The building grammar has been removed from the new compiler.

## Where the implementation lives

```text
src/programs/            authored source modules (editable in browser)
src/languages/           immutable builder APIs, schemas, validation
src/pipelines/           pass registration and task construction
  project.ts             composition root / injected CAD and motion import adapters
  scene.ts               generic definition, layout, LOD and packaging passes
  cad.ts                 profile constraints, feature elaboration and named solid
  mechanism.ts           assembly, residual, tape, motion selection
src/core/                artifacts, compiler runtime, strategies, queries and records
src/math/                expressions, tapes, nonlinear solver, rectangle and four-bar math
src/geometry/            mesh, primitive and bounded analytic bracket algorithms
src/assembly/            body/port/joint representation
src/adapters/            assembly-to-constraint graph recognition
src/scene/               shared scene/animation/collision schemas
src/source-workbench/    TypeScript evaluation, editing, inspection UI
src/workbench/           reused developer inspector and visualization providers
```

The common `dsl.program` artifact is the reified value produced by host-language execution; it is not the TypeScript AST. Domain projection passes extract particular fragments and record explicit derivations. Geometry passes receive shape specifications, not source text. Per-definition tessellation and per-candidate reduction use stable logical task identifiers. Selection criteria and appearance are projected separately. The compiler uses its existing versioned immutable artifact protocol, dependency-aware task cache, structured decisions, and record-based queries.

An important tradeoff: projection passes read the full reified program, so on structural edits they may execute again even if a fragment's value is unchanged. Their unchanged output revisions allow downstream expensive work to be reused. This is a deliberately observable two-tier dependency design, not a claim of optimal invalidation or an incremental JavaScript interpreter. Host execution happens on every requested source compilation; equal reified results then reuse all compiler tasks.

## Scope

The scene compiler accepts arbitrary named definitions and occurrences using the implemented box, cylinder, gable, frame and CAD-import vocabulary. Cylindrical ring decimation is real, with a conservative error bound relative to the input mesh; incompatible divisors retain geometry with an explicit decision. The frame is a compound of closed pieces, not a Boolean union. CAD uses the verified **bounded** analytic bracket backend: rectangular base, matched upright, two symmetric through-holes. Unsupported feature sequences or hole placements fail at the recognizer. The physics backend recognizes the planar four-bar with canonical ground/crank/coupler/rocker roles and endpoint ports; the authored joint graph and source joint names are recorded. It solves prescribed kinematics, not general dynamics or contact. The door is an illustrative rigid attachment model, not a collision-certified mechanism; local AABBs are exported, not simulated. The numeric and closed-form candidates both must succeed in this small prototype. The workbench retains an in-memory history; exports are provided for persistence.

For the detailed earlier framework report and parameter-driven examples, see `docs/README-legacy.md` and `docs/report-template.md` (historical, not the source-first architecture).

## Source-first inspector update

The source-first HTML now has a syntax-highlighted TypeScript editor and a persistent final-output preview. Beneath these, the IR chain shows **one actual dependency route** (not a claim that the full DAG is linear). Select a route node or a compact invocation row to inspect its exact pass record in the same pane. The sidebar lists every invocation in dependency-first order and supports filtering by task, pass, or status. The selected step exposes timing, input references, cache reasoning, decisions, metrics, checkpoints, implementation, graphs, comparison, queries, and its executed source snapshot. Use **Focus passes** to devote the viewport to compilation inspection; **Show source & model** restores editing.

Structured inspection views and the IR download use YAML. The serializer is a presentation-only projection of the existing finite JSON-compatible IR values; the trace export and source-set interchange remain JSON for compatibility. The editor and compiler source use lossless lexical coloring (not a full language service); the original source text is what the compiler evaluates. The existing compiler, mathematical algorithms, and DSL semantics are unchanged. The browser checks include YAML round-trip against the committed artifact, source highlighting, compact pass navigation, and offline execution.
