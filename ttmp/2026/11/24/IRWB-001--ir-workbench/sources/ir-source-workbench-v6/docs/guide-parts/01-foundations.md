## 1. What this framework is for

A compiler turns one useful description of a problem into another. A source language and machine code are one instance of that idea. A CAD sketch and a mesh are another; a system of physical constraints and a numerical evaluation tape are another. Each representation makes some operations easier and some properties more explicit.

IR Workbench explores how to build these systems without growing one inseparable compiler for each application. The framework separates decisions about the order of work, the meaning of transformations, the mechanics of editing representations, and the bookkeeping of execution. It then exercises those interfaces with actual geometry, scene, expression and constraint computations.

You can use it at three levels. As a reader, open the offline workbench and trace a transformation back to its source. As a compiler developer, write passes and reusable rules, attach checks, and experiment with a compilation strategy. As a framework developer, add an adapter or analysis provider and test whether the existing machinery still applies without knowing your domain.

The implementation is TypeScript. The archive contains the source and build dependencies, generated JavaScript and declarations, tests, the standalone workbench, executable tutorials, and reproducible evidence. This guide describes version 0.6.0. The earlier implementation report attached to the conversation describes version 0.1.0; its historical measurements and browser checks are not treated as verification of this version.

### 1.1 Begin with meaningful representations

A representation deserves its own interface when it gives a concept a useful meaning. A mesh describes vertices and indexed faces; a scene describes definitions and their occurrences; a residual program describes equations to evaluate. Numbering them IR 1, IR 2 and IR 3 tells you their position in one pipeline but does not explain what they are or where they can be reused.

The original examples already demonstrate this distinction. A CAD sketch and a mechanism can both lower into the mathematical residual/tape machinery. A game model and a mechanical door can both use scene definitions and occurrences. Geometry analysis can consume an indexed mesh without knowing which frontend produced it. The shared boundary is a meaningful representation with a validator and algorithms, rather than a pipeline position.

An artifact is one immutable value in one representation. Its identity has several parts: a logical artifact ID, its native kind and schema version, a content hash, and a revision hash. A task asks a versioned pass to produce such a value. Different tasks may produce identical native content, so their revision hashes can agree while their logical artifact IDs remain distinct. Entity references therefore include all three of artifact ID, revision and local entity ID.

That precision is central to inspection. Selecting `column-a` is ambiguous without saying which scene and which revision contains it. A statement that a mesh is valid is ambiguous without saying which mesh revision and which checker established it. A cache hit is ambiguous without saying which invocation originally computed the value and which dependencies justified reuse.

### 1.2 Four cooperating responsibilities

| Component | Main question | Main interface |
| --- | --- | --- |
| Strategy IR | Which work should run, in what order, with which alternatives? | Serializable strategy plan and versioned algorithm registry |
| Semantic contracts | What must be true for an operation to be accepted? | Typed ports, properties, analyses, invariants and effects |
| IR manipulation | How can an algorithm inspect and change this representation? | Adapter, exact revision view, pattern and edit transaction |
| Incremental runtime | What was requested, computed, reused or rejected, and why? | Passes, tasks, artifacts, dependency records and queries |

The strategy layer does not need to understand triangles to compare two evaluated alternatives. A contract does need to understand the geometric meaning of an error bound. The generic rewrite engine does not need to know how a mesh stores its coordinates. A mesh adapter does need to rebuild those coordinates and indices after a logical edit. The runtime needs the resulting artifacts and dependency observations; it does not implement any of these domain semantics.

The layers can also be used separately. A standalone `AnalysisManager` can verify a transformation without running a compiler. An `IRView` can inspect an immutable artifact without a Strategy IR. A strategy algorithm can call a different backend instead of this runtime. The examples use a composition root to connect these reusable pieces explicitly.

### 1.3 Three kinds of source code

It helps to separate three programs you can inspect in the workbench. The domain program says what is being modeled: a bracket, a building, an expression or a constraint system. The compilation strategy says how to process it: run passes, generate candidates, repeat a cleanup, choose a feasible result. A transformation implementation says how an individual algorithm works: merge definitions, redirect references, solve a system or simplify a supported mesh.

Changing a mesh tolerance changes a decision made by the strategy. Changing a property checker changes what the compiler can accept. Changing a rewrite changes the construction of a candidate. These are different changes and should be visible at different interfaces.

For the original authored-model examples, the workbench includes an editable TypeScript source evaluator. For the four v6 IR labs, the compiler implementation is compiled into the HTML and the native input is editable YAML. The source browser shows the actual TypeScript behind that lab. To edit its adapter or algorithm, change the downloaded workspace source and rebuild. Both workflows retain an explicit relationship between the displayed data and the code that produced it.

### 1.4 Keep the graphs distinct

The word graph appears often, but the graphs serve different purposes. The task execution graph records which invocation requested another task, including failed requests. The value dependency graph records exact input values and artifact revisions that support a computed output. The structure of an individual IR describes its entities and typed relationships. Provenance connects entities across representations or revisions.

Strategy IR adds a control structure, and its execution trace expands that structure into actual branches and iterations. These records explain related things, but one should not be substituted for another. A containment edge does not prove a computational dependency. A provenance link does not prove semantic equivalence. A strategy branch in the plan does not prove that the branch ran or that its result was selected.

The UI follows these distinctions. Compiler passes show actual invocations and their recorded routes. The IR explorer shows typed entity relationships. Lineage follows exact correspondence edges. Mesh alternatives appear as branches, each with its own before/after edge, rather than an invented linear sequence.

### 1.5 What is implemented, and what the scope means

All three proposed layers are implemented. Strategy IR has all thirteen planned control operators and executable plan editing. Semantic contracts have the eight definition APIs, revision-based analyses and facts, explicit preservation, effect tracking and staged acceptance. Generic IR manipulation has adapters, navigation, declarative patterns, seven rewrite schedules, transactional editing, diffs and correspondence composition.

The domain experiments deliberately cover smaller mathematical problems. The expression checker supports bounded integer-polynomial semantics. Scene sharing preserves translated box instances. The new mesh experiment works on convex planar triangle fans and a stated polygon-boundary error metric. The new constraint experiment handles uniquely solvable finite linear systems. The older CAD and mechanism examples have their own documented geometry and kinematic scope.

These limits are checked, not hidden behind an apparently universal API. The implementation contains no general CAD kernel, arbitrary dynamics engine, e-graph equality saturation, SSA framework or internal theorem prover. A successful experiment establishes that reusable interfaces can coordinate concrete algorithms within their declared domains; it does not establish that every compiler or physical model fits unchanged.

## 2. Get a useful result in ten minutes

### 2.1 Open the standalone workbench

Download and open the v6 HTML file in a browser that permits local JavaScript and workers. No server is needed for normal use. The file opens on the IR manipulation lab. Select **Symbolic expressions** and inspect the transformation list. The default run has three accepted edits: one common-subexpression merge and two algebraic rewrites.

Choose a step, then select an entity before the edit. The corresponding entity or entities after the edit are highlighted using the recorded relation. Open **Pattern & match** to see the exact captures that justified that candidate, **Changes & origin** to see what changed, and **Implementation** to see the rule's TypeScript.

Next select **Mesh alternatives**. With error bound `0.35`, the default octagonal fan can become four triangles. Set the bound to `0.1` and run again: the original eight triangles are selected. Open **Strategy trace** to see the alternatives and their measured error; open **Compiler passes** to see the tasks that actually constructed them.

Enable **Run twice for cache**. The second run reuses eligible compiler results, while semantic acceptance is checked for that invocation. The original transformation trace stays linked to the invocation that executed the edits. This is the quickest way to distinguish computation reuse from fresh verification.

### 2.2 Recover the complete development workspace

Extract the complete ZIP and open a terminal in its `ir-source-workbench` directory. The archive contains installed Linux build dependencies as a convenience, plus the lockfile. Node.js 22 or newer is required. On another platform, install the dependencies for that platform using the lockfile.

```sh
# When platform-specific dependencies need replacing:
npm ci

# Compile strict TypeScript and build the offline HTML:
npm run build:source

# Execute every regression and reproducible experiment:
npm run verify:release
```

The generated workbench is `output/source-workbench.html`. `dist/` contains JavaScript, declaration files and source maps. `src/` contains the authored TypeScript. `tests/` contains Node test modules. `output/` contains machine-readable traces and release evidence. The workspace manifest records the archived bytes independently of whether the workbench is open.

The framework's compiler/domain runtime has no external runtime-package dependency. The standalone source editor embeds the TypeScript compiler supplied during the build, so editing original model source works offline. TypeScript and esbuild are installed development dependencies; the finished HTML does not fetch them from a CDN. Python is needed only for regenerating documentation or running optional browser scripts.

### 2.3 Run the small tutorials

The guide includes executable TypeScript tutorials under `src/guide/`. Build once, then run the emitted files:

```sh
node dist/guide/01-runtime.js
node dist/guide/02-ir-manipulation.js
node dist/guide/03-strategy-contracts.js
node dist/guide/04-domain-tour.js
node dist/guide/05-custom-adapter.js
```

The first tutorial registers a finite scalar representation, a source-reading pass and an addition pass. It runs once, runs unchanged, then changes only the left source input. The result is `7`, `7`, then `14`; the right input remains cached. The tutorial prints the actual cache explanation and run comparison. This small case exposes the same dependency rules used by the larger geometry examples.

The remaining tutorials exercise native manipulation, strategy/contract composition, the four real domains, and adding a new native adapter. Their files are the authoritative runnable versions of the focused snippets in this guide. Run `node scripts/guide-demo.mjs` after a build to execute all five and save their evidence together.

### 2.4 Read source in a productive order

Start with a domain example, not the runtime internals. For the new labs, read the selected domain module under `src/ir-examples/`, then `rules.ts`, `contracts.ts`, and the `planIRLab` composition in `lab.ts`. Follow a specific entity through a specific recorded edit before reading the generic transaction engine.

For the original CAD, game and mechanism workflows, start in `src/programs/`. The program uses the supported domain language; `src/pipelines/project.ts` connects the frontends to their lowering passes and shared geometry, scene and mathematical components. The source browser preserves these files rather than showing pseudocode reconstructed from an artifact.

When you need the framework implementation, the package entry points are `src/core/index.ts`, `src/strategy/index.ts`, `src/contracts/index.ts` and `src/ir/index.ts`. Imports are explicit. There is no package publication or external service setup required to study or extend this workspace.
