# IR Workbench v6

A self-contained TypeScript compiler framework with three implemented layers: **Strategy IR**, **semantic pass contracts**, and **generic IR manipulation**.

V6 adds representation adapters, exact-revision entity queries, declarative patterns, bounded rewrite schedules, transactional edits, structural differences and many-to-many correspondence. Four executable examples keep their own native storage formats. Their actual source, transformation rules, strategy programs, compiler invocations and semantic evidence are embedded in the workbench.

## Open the workbench

Open `output/source-workbench.html`. The standalone file opens directly on **IR manipulation lab** and runs offline. Choose symbolic expressions, scene sharing, mesh alternatives or constraint systems. The compact transformation sidebar selects a real step; its exact before/after representations, entities, queries, pattern evidence and changes appear on the right.

**Example & compiler code** opens the actual TypeScript. **Edit native input** provides highlighted YAML that is validated and compiled. **Compiler passes** retains the existing pass/cache/contract inspector; **Strategy trace** shows the executable plan and its actual node executions. The original seven examples remain available through the existing workbench navigation.

The new lab executes compiled example TypeScript over editable native data. The original five authored-model editors continue to evaluate editable TypeScript source. Editing native data does not silently edit a compiler implementation.

See [the v6 workbench guide](docs/v6-workbench.md) and [the complete user guide](docs/v6-user-guide.md).

## Build and verify

Node.js 22 or newer is required. Installed build dependencies from this Linux workspace are included in the complete archive. On another platform, run `npm ci` for the matching bundler binary.

```sh
npm run build:source
npm test
npm run verify:release
```

`verify:release` builds the standalone workbench, runs the complete test suite and executes the source, strategy, semantic-contract and IR experiments plus all five guide tutorials. `npm run demo:ir` runs the four new domains and the tighter mesh-bound scenario; `npm run demo:guide` runs the tutorials. Evidence is written under `output/`.

The compiler/domain runtime has no third-party runtime-library dependency. The offline source editor embeds the TypeScript compiler during the build; esbuild is a build tool. Python is used for report generation and optional browser checks.

## Reusable modules

| Directory | Responsibility |
| --- | --- |
| `src/core/` | Immutable artifacts, incremental task execution, dependencies, cache explanations and pass policies |
| `src/strategy/` | Thirteen control operators, serializable plans, versioned algorithms, validation, editing and execution |
| `src/contracts/` | Typed definitions, analyses, properties, effects and transactional semantic acceptance |
| `src/ir/` | Adapters, readers, traversal, patterns, rewriting, native edit transactions, differences and correspondence |
| `src/ir-examples/` | Four native representations, domain-owned semantics, rules and three-layer compiler integration |
| `src/guide/` | Five complete executable tutorials accompanying the user guide |
| `src/programs/` | Authored building, pavilion, CAD bracket, linkage and mechanical-door TypeScript |
| `src/contract-examples/`, `src/strategy-examples/` | The earlier contract and geometry-cleanup laboratories |
| `src/pipelines/` | Earlier domain lowerings and their compiler/strategy integration |
| `src/source-workbench/`, `src/workbench/` | Source editing, YAML, inspection, visualization and evidence navigation |
| `tests/`, `scripts/` | Automated checks, reproducible experiments, build, PDF and complete-workspace packaging |

The runtime does not import any of the three higher layers. Generic IR manipulation imports the core data protocol and utility functions; it imports no domain, semantic checker or strategy interpreter. The application composition root connects the layers through explicit interfaces.

## Start using the IR APIs

```ts
import { createIRArtifact, openIR } from './src/ir/index.js';
import { expressionAdapter, exampleExpression }
  from './src/ir-examples/expressions.js';

const artifact = createIRArtifact(
  expressionAdapter, 'example', exampleExpression()
);
const ir = openIR(artifact, expressionAdapter);
const dependencies = ir.dependencies('sum');
const edit = ir.beginEdit();
edit.update('x', { name: 'position' });
const candidate = await edit.commit();
```

This example performs structurally validated editing. To accept a semantics-preserving optimization, supply `beginEdit({ verify })` or a rewrite schedule's `verify` gate backed by a domain contract. The real examples do so for every edit and again at the compiler's output publication boundary. Merely listing a property in a rewrite's `preserves` field does not prove it.

For the complete API and lifecycle, see [IR module documentation](src/ir/README.md) and [domain examples](src/ir-examples/README.md).

## Reports, evidence and scope

- [V6 complete user guide](docs/v6-user-guide.md)
- [V6 PDF user guide](output/ir-workbench-v6-user-guide.pdf)
- [V6 workbench guide](docs/v6-workbench.md)
- [V6 reproducible experiment evidence](output/v6-ir-verification.json)
- [V6 tutorial evidence](output/v6-guide-verification.json)
- [V6 verification ledger](output/v6-verification.json)
- [V5 semantic contract report](docs/v5-report.md)
- [V4 Strategy IR report](docs/v4-report.md)

The v6 experiments deliberately cover integer-polynomial expressions, translated box instances, convex planar fan meshes and uniquely solvable linear constraints. Their validators and checkers enforce that scope. This is a reusable implementation for those supported representations, not a universal CAD kernel, general physics solver, e-graph engine or theorem prover.

Browser automation was unavailable in the authoring environment. UI tests execute the real compiler and inspector with explicit DOM, Canvas and Worker transport doubles. Optional browser scripts are included; browser rendering and compatibility are not claimed as verified. No prior-release screenshot is presented as v6 visual evidence.

The archive includes source, installed build dependencies, compiled output, tests, scripts, reports and evidence. `WORKSPACE-MANIFEST.json` records every archived file's byte count and SHA-256 except the manifest itself. Earlier published releases remain separate immutable deliverables.

To regenerate the guide, install the optional Python dependencies in `requirements-docs.txt`, then run `python3 scripts/assemble-guide.py` and `python3 scripts/render-user-guide.py`. Chapter sources live under `docs/guide-parts/`; the compiler and delivered HTML do not require Python.
