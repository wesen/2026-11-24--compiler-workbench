# IR Workbench

A standalone TypeScript implementation of reusable, observable compiler pipelines, exercised by CAD geometry, game assets, planar mechanisms, and an animated mechanical door. This is a new implementation; jig supplied conceptual motivation only.

## Open the delivered result

Open `output/index.html` directly in a modern desktop browser. It contains its data, application code, styles, mesh previews, and local compiler. No network connection or server is required.

Choose a recorded run, inspect a task, and use its IR, cache, decisions, graphs, comparison, inputs, and query panels. Meshes support orbit, zoom, and surface picking. Linkage and door animations display verified discrete samples. The Inputs panel can compile edited JSON values in the browser. Its first live compilation starts a fresh in-memory cache; subsequent live compilations share that cache until the page is reloaded.

The generated `output/report.md` and `output/report.pdf` give the detailed design, algorithms, evidence, and limits. `output/trace.json` is the complete recorded compilation database. The workspace archive includes source, installed build tools, precompiled JavaScript, test evidence, reports, and generated assets.

## Run locally

Node.js 22 or later is required for command-line execution. The compiler and examples have **no third-party runtime dependencies**. The delivered workspace contains precompiled `dist/` output.

```bash
node dist/examples/run.js
node scripts/serve.mjs
```

The first command regenerates the twelve-scenario demonstration and workbench. The second optionally serves `output/` at `http://127.0.0.1:4173`; direct opening also works.

To build or modify TypeScript, use the included development dependencies on the matching platform, or reinstall from the lockfile:

```bash
npm ci
npm run verify
```

`verify` performs a strict TypeScript build, runs every test, saves machine-readable verification evidence, and regenerates the example outputs. TypeScript, esbuild, and Node type declarations are development dependencies only. The archived esbuild binary matches the Linux x64 build environment; use `npm ci` to install the correct binary on another platform. Precompiled Node and browser artifacts remain portable.

### Try a different configuration

```bash
node dist/examples/run.js --set cad.holeDiameter=0.018 --out output/custom-hole
node dist/examples/run.js --set game.objective=quality --out output/quality
node dist/examples/run.js --set door.height=2.1 --out output/taller-door
node dist/examples/run.js --inputs my-inputs.json --out output/my-run
```

Configuration files contain a flat JSON object of named inputs. Only keys declared by `defaultInputs()` are accepted. Custom mode records a baseline and a custom run, so the workbench can compare them. Invalid inputs produce failed invocations and an inspectable trace, with a nonzero command exit status. Assets in a failed custom run remain explicitly the last successful outputs; the failed run has no successful replacement artifact.

## What is implemented

| Component | Responsibility |
| --- | --- |
| `src/core/` | Immutable artifacts, portable content hashes, registries, dependency tracking, bounded caching, orchestration, strategies, trace database, queries |
| `src/math/` | Shared scalar expression DAG, residual programs, optimized numeric tapes, forward AD, damped QR least squares |
| `src/geometry/` | Indexed meshes, transforms, topology/area/volume analysis, bounded analytic bracket representation and tessellation |
| `src/scene/` | Shared definitions, rigid occurrences, materials, scene package validation |
| `src/assembly/` | Named attachment ports, rigid bodies, revolute joints |
| `src/adapters/` | Explicit recognition/lowering from assembly ports to the physics constraint graph |
| `src/domains/` | CAD, procedural building, linkage, and the composing door example |
| `src/examples/` | Application composition, scenario runner, portable output generation |
| `src/workbench/` | Read-only trace/query projections, extensible IR views, local source editing and recompilation |

The reusable core has no imports from any domain. The math layer has no CAD or physics imports. Geometry knows no scene, game, or mechanism policies. Both the game asset and mechanical door consume the same scene package interface.

## Example API

```ts
import { createProject, compileProject } from './src/examples/project.js';

const compiler = createProject();
const first = await compileProject(compiler, 'baseline');

compiler.setInput('cad.holeDiameter', 0.016);
const edited = await compileProject(compiler, 'larger mounting holes');

edited.run.explainCache('cad/mesh');
edited.run.why('door/package');
edited.run.alternatives('game/package');
edited.run.dependencies('door/package');
edited.run.history('cad/mesh');
edited.run.compare(first.run);
```

Source imports use `.js` extensions for TypeScript NodeNext output; use `dist/` when running directly in Node.

Passes read external configuration only through `ctx.read`, and upstream IRs through `ctx.require`. Pass implementations must be deterministic for their declared version, parameters, and tracked dependencies. JavaScript cannot enforce the absence of hidden mutable closure/global state; that is an explicit plugin-author contract. Never use a function's source text as a cache key.

## Extend without changing the compiler

1. Register an IR kind with a schema version and structural validator.
2. Register a versioned pass returning values of that kind.
3. Build named task requests with serializable parameters.
4. Use `read`, `require`, `derive`, `decision`, `metric`, and `diagnostic` to make dependencies and behavior inspectable.
5. Register an optional view provider by IR kind. Generic JSON, graph, cache, and query views already work.

`tests/extensibility.test.mjs` demonstrates a new analysis kind and the same analysis pass consuming both CAD and game meshes through the shared mesh interface.

## Supported examples and deliberate limits

- **CAD:** one analytic L-bracket family with two symmetric through bores. It has real watertight boundary geometry and stable semantic face names within that family. It is not a general Boolean/B-rep kernel.
- **Game:** a procedural building with shared module definitions and rigid occurrences. LOD reduction recognizes canonical cylinder rings, rebuilds actual meshes, and reports conservative geometric error bounds. It is not a general arbitrary-mesh simplifier. Compound masonry keeps coincident internal interfaces and is not Boolean-unioned.
- **Physics:** fully constrained planar four-bar kinematics, numerical and recognized closed-form alternatives, explicit branch and continuation, verified discrete samples. It does not simulate forces, inertia, impacts, friction, or contact.
- **Door:** CAD ports generate an assembly, which lowers through the existing physics chain; the resulting poses drive reusable scene geometry and conservative box colliders. Collision geometry is supplied, but no collision-response solver is claimed.
- **Runtime:** cache and trace storage are in memory. The trace is exportable JSON; cache entries are not persisted across process/page restarts. Asynchronous scheduling deduplicates tasks but does not move CPU work into worker threads.

All geometric quantities use meters, angles use radians, and sampled time uses seconds. Supported boundaries validate those conventions. There is no general dimensional-analysis type system or automatic unit conversion.

## Verification and reports

```bash
npm run check
npm test
npm run verify
python3 scripts/render-report.py
```

The report renderer uses Python's `reportlab`, `pypdf`, and Pillow; `requirements-report.txt` pins the extra report dependencies. It consumes the same Markdown that is delivered, so the PDF is a rendition of the complete report. Source-figure regeneration is included in `scripts/make-figures.py`. PDF creation is separate from the compiler's runtime and TypeScript build.

`validation/` contains the test log, test summary, browser checks, and archive recovery evidence. Timing data are measurements from one environment, not benchmark promises. Reproduction compares semantic artifact revisions while excluding invocation IDs and clocks.

The optional real-browser test uses a separately installed Playwright driver and Chromium:

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser-check.mjs
```

It checks the standalone file, desktop/mobile layouts, queries, animation, live recompilation, failed runs, trace export and absence of external requests. Driver and executable overrides are documented at the top of the test script.

To preserve and verify another complete workspace snapshot:

```bash
python3 scripts/archive-workspace.py --out ../workspace.zip
python3 scripts/check-archive.py ../workspace.zip
```

The archive includes every file under the project root, including installed tools, intermediate work and verification evidence. Its manifest records hashes and symbolic links. Recovery verifies every manifest entry, builds and tests using the restored local dependencies, regenerates all examples and compares baseline artifact revisions.
