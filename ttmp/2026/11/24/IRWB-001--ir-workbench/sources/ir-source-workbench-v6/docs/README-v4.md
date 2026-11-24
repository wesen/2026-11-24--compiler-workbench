# IR Source Workbench v4

A self-contained TypeScript compiler framework with executable Strategy IR. Inspect three distinct sources: the authored object program, the compilation plan, and its transformation implementations. Follow a planned node into actual executions, candidate selection, pass invocations, immutable IR, and cache explanations.

## Open the result

Open `output/source-workbench.html` in a browser. It bundles the TypeScript transpiler, compiler, interpreter, all example and compiler source, and visualizers. No server or network is required.

1. **Building** shows actual authored TypeScript. Change `floors = 2` to `floors = 3`, then **Compile source**. The scene changes from 70 to 103 occurrences.
2. **Strategy plan** shows a compact node tree and adjacent inspector. Select `scene/choose` for objectives, constraints, alternative scores and the winner. **Executions** separates static node identity from dynamic visits.
3. Follow a linked invocation into **Compiler passes**. The original IR, source, cache, provenance, query and graph inspector is retained. **Focus passes** gives the lower workspace the viewport.
4. **Edit plan** edits highlighted YAML. Validate, apply, and compile it. Change the `scene/choose` objective metric from `renderedTriangles` to `surfaceErrorBound` to select the highest-quality feasible scene. Structural edit buttons can insert checkpoints. Invalid versions, bindings, structures and YAML produce diagnostics.
5. **Implementation** opens the actual plan generator, interpreter, builder, validation and editing source. Historical runs retain their exact executed plan and authored source separately from current drafts.
6. **Mesh cleanup lab** shows a real repeated transformation: 11 vertices become 8 through three changes, followed by a fourth, stable iteration. The final mesh is watertight and preserves all oriented triangle geometry. Its actual TypeScript implementation is visible; its strategy is editable.

Use source-set, plan, IR, and trace downloads to retain session edits and records. The history and cache live in memory.

## Strategy API

`src/strategy/index.ts` exports all thirteen operators in the agreed list:

```ts
apply; sequence; parallel; fork; chooseBest; conditional;
repeatUntilStable; forEach; require; verify; checkpoint; attempt; scope;
```

It also exports `plan`, `algorithm`, `ref`, `binding`, `literal`, `AlgorithmRegistry`, `walk`, `find`, `replace`, `insertBefore`, `insertAfter`, `remove`, `validate`, `assertValid`, `diff`, `serialize`, `deserialize`, `execute`, and `executeOrThrow`.

Plans are immutable finite JSON. Implementations are external, exactly versioned registry entries. Lexical references make data flow explicit. Independent branches cannot leak bindings. Only explicit rejection is recoverable; fatal bugs cannot be swallowed by fallback. Selection retains infeasibility and ranking evidence. Repetition detects convergence, cycles and bounds. Cancellation is cooperative; concurrency is bounded asynchronous scheduling, not a CPU worker pool.

The full API and semantics are in `src/strategy/README.md`. Architecture, experiments, verification and limitations are in `docs/v4-report.md` and `output/ir-source-workbench-v4-report.pdf`.

## Build and verify

With Node 22 or newer:

```sh
npm run verify
node scripts/strategy-demo.mjs
```

The first command builds strict TypeScript and both workbench bundles, runs all Node tests, and generates authored-source experiments. The second records plan-edit, selection, fallback, rejection and fixed-point experiments. The archive includes the pinned installed development dependencies for Linux x64. On another platform run `npm ci` first. `npm run build:source` rebuilds the standalone HTML; `npm test` runs tests against compiled `dist` files.

Optional browser verification, with local Python Playwright and Chromium:

```sh
python scripts/check-strategy-browser.py
```

Set `CHROMIUM` if your executable is elsewhere. The suite checks real browser execution, layout, downloads, offline behavior, editing and errors. **The release environment blocked browser launch and local-file preview. V4's browser suite is provided but was not executed successfully there.** Automated UI interaction tests execute the actual handlers and real compiler with explicit DOM, canvas and worker-transport test doubles. They do not establish pixel layout or real-browser compatibility. Historical v3 screenshots and browser evidence are labeled under `output/history/v3/`.

The Node build/test path has no Python dependency. Regenerate the PDF with `python scripts/render-v4-report.py` when ReportLab and the documented fonts are installed.

## Example coverage

| Example | Domain behavior | Strategy behavior |
| --- | --- | --- |
| Building and pavilion | Two unrelated authored scene compositions using the same compiler | Parallel projections, per-definition traversal, backend conditionals, LOD alternatives, applicability fallback, constrained selection |
| CAD bracket | Authored sketch, extrusion, upright and symmetric through-bores | Explicit lowering/solving/tessellation, demanded analysis, watertightness verification |
| Four-bar linkage | Authored bodies, ports, joints, driver and solver settings | Numerical/analytic fork, per-candidate verification, cost or accuracy selection |
| Mechanical door | Composes authored CAD, mechanism and scene programs | Nested domain strategies and explicit dependency substitutions for selected outputs |
| Mesh cleanup lab | Removes unused vertices and welds exact duplicates without changing triangle geometry | Bounded fixed-point repetition, per-iteration pass/cache links, analysis and verification |

## Source map

| Directory | Responsibility |
| --- | --- |
| `src/programs/` | Five authored object programs |
| `src/languages/` | Persistent domain builders and validation |
| `src/strategy/` | IR, registry, validation, editing, serialization and interpreter |
| `src/pipelines/strategy.ts` | Domain plan generators and compiler adapter |
| `src/strategy-examples/cleanup.ts` | Real repeated mesh-cleanup algorithm and plan |
| `src/pipelines/` | Domain pass implementations and task construction |
| `src/core/` | Immutable artifacts, dependency cache, run records and queries |
| `src/math/`, `src/geometry/`, `src/scene/` | Mathematical, geometric and scene algorithms |
| `src/source-workbench/` | Source editor, strategy editor/inspector and YAML data parser |
| `src/workbench/` | Pass inspector, graph and geometry views, source browser |
| `tests/`, `scripts/` | Reproducible checks, experiments, build and report tooling |

The old parameter-driven examples remain under `src/domains/` and `src/examples/` as regressions. Source-first compilation uses new pipeline registrations and Strategy IR. `docs/README-v3.md` records the previous release.

## Scope and practical limits

V4 implements Strategy IR. Semantic pass contracts, a property-preservation analysis manager and generic domain-IR rewriting are subsequent components. Strategies invoke registered algorithms. Runtime invariant checks are evidence, not formal proofs.

CAD remains the bounded analytic L-bracket recognizer. Physics is prescribed planar four-bar kinematics, without dynamics or contact. Scene reduction supports canonical cylinder rings and retains incompatible meshes. Cleanup is exact topology repair, not a general mesh optimizer. The door exports local collision boxes but is not collision-certified.

Object-source evaluation executes trusted local TypeScript in a worker with an eight-second timeout and restricted imports. It is not a secure sandbox for hostile code. Browser edits receive syntax/transpile and runtime validation; the disk build performs strict TypeScript checking.

The runtime retains successful immutable artifacts after a rejected alternative. It does not roll back arbitrary host effects. Pass-cache capacity is bounded; history and artifact/trace storage are not. Trace exports preserve strategy evidence; importing a warm compiler cache is outside this release.
