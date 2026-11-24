# IR Workbench v5

A self-contained TypeScript compiler framework with executable **Strategy IR**, **semantic pass contracts**, and a source-first developer workbench.

The actual CAD, scene, mechanism and cleanup algorithms are included. The workbench shows the authored example code, editable compilation strategy, intermediate representations, compact invocation list, compiler implementations, and the evidence behind semantic acceptance and cache reuse.

## Open the workbench

Open `output/source-workbench.html`. It contains the compiler, TypeScript evaluator, worker code, source catalog and UI in one offline file. No server or network request is needed by the application. The five authored examples are editable; the cleanup and contract labs show their real implementation source and editable strategies.

Choose **Compiler passes**, select an invocation, then open **Contracts**. Its five views explain checks, analyses and properties, typed interfaces, effects and correspondence, and implementation source. **Focus passes** keeps the route, compact sidebar and details together. See [the workbench guide](docs/v5-workbench.md).

Browser automation was blocked in the authoring environment. The UI was exercised with its real compiler and evaluator through explicit DOM/Canvas/Worker transport test doubles. The optional real-browser suite is included; browser rendering and compatibility are not claimed as verified here.

## Rebuild and verify

Node.js 22 or newer is required. Installed build dependencies from this Linux workspace are included in the complete archive. On another platform, use `npm ci` to install the matching bundler binary from the lockfile.

```sh
npm run build:source
npm test
node scripts/source-demo.mjs
node scripts/strategy-demo.mjs
node scripts/contracts-demo.mjs
```

`npm run verify` builds the standalone workbench, runs all tests, and runs the authored-source experiment suite. `npm run verify:release` also runs the strategy and semantic-contract experiment suites. Results are written under `output/`.

The compiler and workbench have no third-party runtime dependency. TypeScript and esbuild are build tools. Python is only used for the PDF renderer and optional browser smoke scripts.

## Modules

| Directory | Responsibility |
| --- | --- |
| `src/core/` | Immutable artifacts, incremental execution, generic pass policy boundary, cache explanations and queries |
| `src/strategy/` | Thirteen control operators, versioned registry, validation, serialization, immutable editing and interpreter |
| `src/contracts/` | Typed definitions, properties, analyses, checked transfer, versioned effects and transactional verification |
| `src/contract-examples/` | Real pass contracts, independent domain checks and nine contract-lab scenarios |
| `src/programs/` | Actual authored building, pavilion, CAD bracket, linkage and mechanical-door TypeScript |
| `src/languages/`, `src/geometry/`, `src/math/`, `src/scene/`, `src/assembly/` | Domain languages, schemas and algorithms |
| `src/pipelines/` | Domain lowering and strategy-to-compiler integration |
| `src/strategy-examples/` | Fixed-point geometry cleanup implementation |
| `src/source-workbench/`, `src/workbench/` | Source evaluator, editor, strategy view, pass inspector, contract evidence and visualization |
| `tests/` | Runtime, strategy, semantic, domain, failure-path and UI regressions |

The compiler core imports neither Strategy IR nor semantic contracts. The contracts manager can verify a transformation independently of the compiler scheduler. Domain adapters connect those reusable components.

## Semantic contract APIs

`src/contracts/index.ts` exports `defineIR`, `defineType`, `defineProperty`, `defineAnalysis`, `defineTransformation`, `defineInvariant`, `defineObjective`, and `defineEffect`.

`AnalysisManager` supports analysis reuse and invalidation, property and relational invariant checks, objective evaluation, justified cross-revision preservation, and transformation verification/execution. A transformation declares named typed inputs and outputs, `requires`, `preserves`, `ensures`, `establishes`, `effects`, `cache`, and `correspondence`.

A declaration alone is not evidence. Checks refer to exact artifact revisions and checker versions. A transfer needs an executable justification. Effects use a versioned resource interface and staged atomic writes. The explicit external-certificate verifier channel is a trust boundary; this project contains no theorem prover and no JavaScript security sandbox.

The contract lab demonstrates verified cleanup; rejected input, output and preservation; undeclared resource access; acceptance checks against cached geometry; resource-dependent recomputation; committed writes; and discarded writes after failure.

## Reports and retained evidence

- [V5 implementation report](docs/v5-report.md)
- [V5 PDF report](output/ir-source-workbench-v5-report.pdf)
- [V5 workbench guide](docs/v5-workbench.md)
- [Domain contract integration notes](docs/contracts-integration.md)
- [V4 Strategy IR report](docs/v4-report.md)
- [V4 acceptance ledger](docs/v4-acceptance.md)

Historical evidence is labeled by release. The separate published v4 archive preserves the previous complete workspace. `WORKSPACE-MANIFEST.json` in this release records the size and SHA-256 of every archived workspace file except the manifest itself.

The generic representation-adapter, pattern and rewrite-editing layer described as item 3 remains a separate future component. The current strategies, semantic interfaces and correspondence records are ready to support it.
