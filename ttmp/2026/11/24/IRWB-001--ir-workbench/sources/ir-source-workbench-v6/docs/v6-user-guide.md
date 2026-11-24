# IR Workbench: a user's guide to reusable compilers

**Version 0.6.0 · TypeScript 5.9.3 · 24 November 2026**

Programs, compilation strategies, semantic contracts, and inspectable chains of intermediate representations.

This guide is for developers who want to understand, use and extend the complete framework. Start with Chapters 1 and 2 for the architecture and a first result. Follow Chapter 3 for concrete experiments. Chapters 4 through 7 explain the reusable APIs and their guarantees. Chapter 8 is the workbench manual; Chapters 9 and 10 cover extension, troubleshooting and terminology. Chapter 11 records verification and reproduction.

The five executable TypeScript tutorials under `src/guide/` are companions to the text. Focused code fragments in chapters assume the surrounding imports and definitions described there; the tutorial files are complete runnable programs.

## Contents

- [1. What this framework is for](#1-what-this-framework-is-for)
- [2. Get a useful result in ten minutes](#2-get-a-useful-result-in-ten-minutes)
- [3. Four complete transformation walkthroughs](#3-four-complete-transformation-walkthroughs)
- [4. Inspecting and transforming native IRs](#4-inspecting-and-transforming-native-irs)
- [5. Programming compilation strategies](#5-programming-compilation-strategies)
- [6. Specifying semantic contracts](#6-specifying-semantic-contracts)
- [7. Understand execution, caches and explanations](#7-understand-execution-caches-and-explanations)
- [8. Use the workbench as a compiler debugger](#8-use-the-workbench-as-a-compiler-debugger)
- [9. Add a representation and build your own compiler](#9-add-a-representation-and-build-your-own-compiler)
- [10. Reference map, troubleshooting and terminology](#10-reference-map-troubleshooting-and-terminology)
- [11. Verification, reproducibility and delivery](#11-verification-reproducibility-and-delivery)

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

## 3. Four complete transformation walkthroughs

The four IR laboratories let you follow a complete transformation from authored
input to accepted output. Each keeps a different native representation. The
same generic machinery supplies queries, pattern matching, transactional edits,
and entity correspondence; domain code supplies the meaning of a successful
transformation.

Start in **IR manipulation lab** and select a domain. Use **Edit native input**
for its YAML data and **Example & compiler code** for the TypeScript that defines
the adapter, rules, contracts, and orchestration. These are different views of
the actual program: editing the input changes its native data, while the source
browser shows how the compiler processes that data.

In **IR explorer**, select a transformation from the compact left sidebar. The
right panel provides **Entities**, **Query**, **Pattern & match**, **Changes &
origin**, **Native IR**, and **Implementation**. The revision strip identifies
each recorded transition. Mesh alternatives remain separate branches. A row
marked `guard-rejected` is an attempted match, not a committed revision.

The companion `src/guide/04-domain-tour.ts` executes and checks the examples in
this chapter, including changed inputs and an authored CAD bracket. Its output
provides a reproducible reference for the expected values below.

### 3.1 Expressions: identify an object, rewrite it, and preserve its meaning

Choose **Symbolic expressions**. The native input is a keyed operation arena:
`nodes` maps stable identifiers to operation records, and `root` identifies the
output. The adapter projects a program root, operation entities, containment
relationships, an output binding, and ordered operand dependencies. Its
`operation()` capability tells the matcher which entities are arithmetic
operations and in what order their operands occur.

The default arena contains two copies of `x*x`, named `square` and `squareCopy`.
It also contains `double = y+y`, `pair = square+squareCopy`, and
`sum = pair+double`. Before any optimization, this means `2*x*x + 2*y`.

Select the input revision and open **Pattern & match**. The common-subexpression
pattern binds two distinct entities with equal content. For an operation, equal
content includes the operation name and ordered operand identifiers. Two
multiplications with different inputs cannot be merged merely because both
have kind `expression.mul`.

Follow the accepted CSE step in **Changes & origin**. The rule keeps `square`,
redirects references from `squareCopy`, removes the duplicate, and records that
both original identities correspond to the retained operation. In **Entities**,
selecting `squareCopy` on the before side highlights `square` on the after side.
This correspondence is evidence supplied by the transformation. It is not
inferred from two similar labels in the visualization.

Two further accepted edits use the repeated-operand pattern:

```ts
pattern(
  capture('sum', op('add', capture('term'), sameAs('term'))),
);
```

The second operand must refer to the exact entity captured by the first. The
rule retains the sum entity's identity, changes its operation to multiplication,
creates or reuses a constant two, and reconnects its operand slots. CSE has made
`pair` eligible for this rule by redirecting both of its operands to `square`.
The default run therefore accepts one CSE edit and two algebraic edits.

The final arena still has seven operations: removing the duplicate and adding
the shared constant offset each other. The demonstrated result is a checked
normalization, not a claimed reduction in every possible cost metric. Its
polynomial remains `2*x*x + 2*y`, and the displayed environment `x=3, y=4`
evaluates to `26`.

Now change the native `double` operation to use distinct operands:

```yaml
double:
  op: add
  args:
    - x
    - y
```

Compile the edited input. The `double` operation remains an addition; its
operands no longer satisfy `sameAs`. The duplicate-square optimization still
applies. The new program means `2*x*x + x + y` and evaluates to `25` in the same
environment. That change in meaning belongs to your source edit. The compiler
checks preservation between the new input and its new optimized output, not
between two different user programs.

Open the corresponding compiler invocation and its contract evidence. Before
acceptance, the checker computes canonical polynomials using exact `BigInt`
coefficient arithmetic. The input and candidate must agree. Numerical samples
are additional recorded evidence. The supported meaning is integer-polynomial
semantics; the checker does not establish identical IEEE-754 rounding for all
evaluation orders. Input constants and final reported coefficients must be safe
integers. Explicit limits bound intermediate coefficients, polynomial degree,
term count, and expansion work.

For a longer provenance route, open **Entity lineage**, choose `squareCopy` in
the original source revision, and target the compiler result. The route follows
the checked edits and the explicit correspondence into the compiler output
artifact. The final task has a different artifact ID from the working arena;
that boundary is recorded rather than concealed.

**Inspect the implementation:** `src/ir-examples/expressions.ts`, the
`expressionCSE` and `expressionDouble` rules in `rules.ts`, and
`expressionEquivalent` in `contracts.ts`.

### 3.2 Scenes: share definitions while preserving independent instances

Choose **Scene sharing**. This native format uses separate `assets` and
`objects` tables. An asset stores its shape and dimensions. An object stores a
name, an asset reference, and a placement. The adapter exposes definitions and
instances as different entity kinds and represents the reference as a typed
`uses` binding.

The initial scene has three definitions: `column-a`, `column-b`, and `beam`.
The columns are equal boxes of size `[1, 3, 1]`. Three instances place the left
column, right column, and lintel independently. Equal geometry does not imply
equal placement, so deduplicating the entire instance would be incorrect.

Select the sharing step. In **Pattern & match**, inspect the two definition
captures and the equality evidence. The rule retains the lexicographically
first definition identity, redirects `uses` bindings, removes the duplicate
definition, and records a many-to-one correspondence. A reverse-order match
can appear as guard-rejected; the guard prevents applying the same merge in
both directions.

After the accepted edit, the scene has two definitions and three instances.
`right-column` now uses `column-a`. Its translation stays `[2, 1.5, 0]`.
`left-column` stays at `[-2, 1.5, 0]`. The lintel still uses the beam. Inspect
the updated binding in **Changes & origin**: redirecting a reference preserves
the relationship's identity, so the diff records an update rather than
inventing an unrelated relationship.

Use **Query** on the after revision to ask for predecessors of `column-a`
through `uses`. The result contains the two column instances. Compare that
with a containment query: containment describes membership in the scene,
whereas the binding explains which definition supplies an instance's geometry.
The distinction makes reference redirection precise.

To exercise the match boundary, change only `column-b`'s size:

```yaml
key: column-b
shape: box
size:
  - 1.2
  - 3
  - 1
```

Compile again. There are now three retained definitions. The two columns are
different shapes, so the equality condition fails. The framework does not merge
them because their names look related or because sharing would reduce storage.
The executable tour verifies this edited-input case.

The semantic contract expands every named instance into its shape, dimensions,
and translation, then compares those expanded placements before and after the
transformation. That establishes the relevant property for this example:
sharing must not alter the scene's placed boxes. It does not claim preservation
of features that this vocabulary does not represent, such as skeletal
animation, arbitrary shaders, or physical material behavior.

Use **Entity lineage** to trace `column-b` into the final result. Its origin
relation points to the surviving definition, while the instance entities keep
their own identities. Following the inverse relation answers which definitions
contributed to the shared result. Inverse correspondence describes history; it
does not recreate the removed table row or undo the transformation.

**Inspect the implementation:** `src/ir-examples/scenes.ts`, `sceneSharing` in
`rules.ts`, and `placementsEquivalent` in `contracts.ts`.

### 3.3 Meshes: construct alternatives, check them, and select under a bound

Choose **Mesh alternatives** and leave **Mesh error bound** at `0.35`. The
native mesh uses packed `[id, x, y, z]` points, a keyed triangle table, and an
ordered boundary. The default is a planar unit octagon triangulated around an
origin vertex named `center`. Its eight boundary edges produce eight triangles.

The strategy constructs two real candidates. One retains the original fan.
The other retains every second boundary vertex, replaces the triangles, and
produces a four-triangle fan. These are separate compiler invocations and
separate output artifacts. In **Strategy trace**, inspect the fork and then
the `chooseBest` node. In **IR explorer**, inspect each candidate's own before
and after revisions; do not read the two candidates as successive edits to one
another.

The reduced candidate is built through the generic editing API. The
transformation removes old faces, disconnects boundary slots, removes discarded
vertices, inserts replacement faces, and connects ordered corner and boundary
relationships. Correspondence records retriangulated faces and removed
vertices. **Changes & origin** therefore contains an actual edit history,
not a triangle-count annotation attached to an unchanged mesh.

The contract first checks that the source is a simple, strictly convex planar
fan. It verifies oriented fan triangles and global half-plane membership for
the contour: every other boundary vertex must lie on the interior side of each
edge. This rejects self-intersecting stars that can pass a test based only on
local turns. The candidate must retain that topology and use unchanged source
coordinates for retained vertices.

Candidate construction and candidate selection use different bounds. Each
construction is checked against a conservative allowance derived from the
source radius, recorded as approximately `2.0` for the unit example. Selection
then applies your tighter requested contour bound and minimizes triangle count.
A candidate can therefore be a valid, checked approximation while being
infeasible for the current optimization request.

| Requested bound | Selected triangles | Contour error |
| --- | ---: | ---: |
| `0.35` | 4 | `0.29289321881345254` |
| `0.10` | 8 | `0` |

Change the UI bound to `0.10` and run again. Both candidates are still
constructed and semantically accepted under their construction allowance.
The strategy marks the reduced candidate infeasible because its measured error
exceeds `0.10`; the original candidate wins. This avoids turning ordinary
optimization infeasibility into a failed compiler invocation. A structurally
invalid mesh or a violated construction contract remains a genuine failure.

Inspect the selection evidence to answer “why was this mesh chosen?” It records
the triangle objective, the error constraint, candidate metrics, feasibility,
and the winner. Inspect the reduced pass to answer the different question
“what did the algorithm change?” Its entity and relationship edits remain
available even when the selector chooses the original mesh.

For a query exercise, choose an output face and request a dependency subgraph.
Its `corner` relationships lead to the three vertices that define the
triangle. The mesh root's containment and ordered boundary bindings have
different roles. Querying dependencies does not accidentally traverse the
whole scene merely because all entities have a common container.

Edited inputs also change the available strategy. Halving is offered only when
the boundary count is even and at least six. A valid five-sided fan retains its
original candidate and displays the actual count in its label. Geometry still
has to satisfy the fan precondition. The contour checker is bounded to 512
boundary vertices. Its distance calculation applies to the retained-subset,
nested convex planar model; it is not a general 3D mesh distance or
decimation algorithm.

**Inspect the implementation:** `src/ir-examples/meshes.ts`, `planIRLab` in
`lab.ts`, and the mesh property, approximation invariant, and triangle-count
objective in `contracts.ts`.

### 3.4 Constraints: remove redundancy and change the solving algorithm

Choose **Constraint systems**. The native representation has variable records,
sparse coefficient maps, right-hand sides, and a solver selector. Its adapter
projects equations and variables as different kinds. Each nonzero coefficient
becomes a typed `term` dependency carrying that coefficient.

The default system contains two independent variable groups:

```text
x + y = 4       u + v = 6
x - y = 2       u - v = 2
2*x + 2*y = 8
```

The fifth equation repeats the first group's sum constraint at a different
scale. The duplicate pattern binds two distinct equations and invokes the
registered predicate `ir-lab.constraint.same-normalized-row@1`. The predicate
compares the complete normalized coefficient map and right-hand side.
Matching only `rhs: 4`, or only the names of the variables, would be unsound.

Follow **Redundant equation removal**. The rule keeps one stable equation
identity, removes the other, and records their correspondence. Four equations
remain. In this fixture the lexicographic retention rule keeps `duplicate-xy`
and removes `sum-xy`; the retained label is not a promise that its original
source equation was the preferred spelling. The checked mathematical content
determines whether removal is allowed.

Next select **Solver substitution**. The edit updates the native system's
solver field from `dense` to `components`. The implementation actually builds
variable connectivity from the sparse equations and solves independent
components separately. It produces two reduced matrices for `['u', 'v']` and
`['x', 'y']`, rather than renaming a dense solve in the UI.

| Quantity | Default accepted result |
| --- | --- |
| Equations | 5 before, 4 after |
| Components | `['u', 'v']`, `['x', 'y']` |
| Solution | `u=4`, `v=2`, `x=3`, `y=1` |
| Maximum relative residual | `0` in this fixture |

Use **Query** to inspect an equation's dependencies. The two referenced
variables and coefficient-bearing edges explain its contribution to the
component graph. Open the contract evidence to compare reduced row spaces,
dense and component solutions, and residuals for the original equations. The
same solution vector alone would not be enough evidence for a general
constraint rewrite; the checked row-space comparison supplies another
domain-specific condition.

Now edit `duplicate-xy` so its right-hand side is `9`, leaving coefficients
`x: 2` and `y: 2`. This contradicts `x+y=4`. Compilation is rejected because
the source fails the unique, consistent solution precondition. The interface
shows the failure and does not display an old successful output as the new
result. You can select a retained history entry or restore the example input
to continue inspecting a successful run.

This solver uses numerical elimination. It checks finite intermediates and
outputs, rejects inconsistent or underdetermined systems, and verifies every
original equation's residual. Supported sizes are at most 128 variables and
512 equations. Pivot detection uses `1e-10`; row-space and solution comparisons
use `1e-9`. Relative residuals must be at most `1e-9`, with the documented
equation-scale normalization. These concrete checks do not constitute a
formal proof for arbitrary real coefficients, nonlinear constraints, or a
physical simulation over time.

**Inspect the implementation:** `src/ir-examples/constraints.ts`, the registered
predicate and redundancy rule in `rules.ts`, and `solutionEquivalent` in
`contracts.ts`.

### 3.5 Connect the laboratories to the original CAD, game, and physics models

Return to the authored examples to see the same architectural boundaries in
larger pipelines. Their TypeScript modules in `src/programs/` construct
immutable object-language programs. Ordinary host-language loops and imports
run during authoring; later compiler passes consume the resulting IR rather
than recovering those loops from TypeScript source text.

**CAD bracket.** Open `bracket.ts` and follow profile constraints through the
residual DAG, numeric tape, solved profile, feature history, analytic bracket,
tessellation, and mesh checks. Change `bore = 0.012` to `bore = 0.016` to
exercise geometry-dependent recompilation. The current default source produces
334 vertices and 672 triangles in one watertight component, verified by the
executable tour. This is a supported drilled-bracket construction, not a general
solid-modeling kernel. Its larger pipeline illustrates why artifacts need
different schemas and why preservation must be stated for a particular pass.

**Game building.** Open `building.ts`. Its authored loop creates named
occurrences from reusable definitions. Change `floors = 2` to `floors = 3`, or
change a material color, and inspect which projections keep their revisions
and which downstream tasks execute. The scene-sharing lab isolates the
definition-versus-instance distinction used here. The mesh lab isolates
constrained candidate selection; the building's concrete LOD algorithm is
specialized cylinder-ring reduction with its own geometric checks.

**Four-bar linkage.** Open `linkage.ts` and follow bodies, ports, joints, and the
prescribed drive into residual expressions and a numeric tape. Change the drive
sample count from `65` to `33` to see sample-dependent work. The pipeline
compares numerical and recognized closed-form candidates using checked motion
metrics. The constraint lab teaches the separation between equation meaning,
solver choice, and verification. Its linear component solver does not replace
the linkage's nonlinear mechanism algorithms.

**Mechanical door.** Open `door.ts` and its imports. The current authored model
imports the bracket and linkage programs, uses the linkage's ground length for
the scene span, and attaches scene occurrences to recorded mechanism body
poses. The composition root supplies CAD geometry and motion imports to the
scene compiler. A bore edit affects imported geometry; a sample-count edit
affects motion. Trace those paths separately. The historical original report
also describes a legacy CAD-port-derived mechanism example; its particular
ground-span dependency should not be assumed for this current authored model.

### 3.6 Reproduce the tour and inspect cache reuse honestly

Run the companion after compiling the workspace:

```sh
npm run build
node dist/guide/04-domain-tour.js
```

It prints compact verified results for nine scenarios, including the edited
expression and scene, both mesh bounds, a rejected contradictory system, and
the authored CAD bracket. An assertion failure stops the program.

For interactive cache inspection, enable **Run twice for cache**. Each lab
execution creates its own compiler; this option runs that same compiler twice
inside the selected experiment. It does not imply a shared cache across every
separate click or domain. The second run records two cache hits for expressions
and scenes, and three for meshes and constraints. The corresponding semantic
acceptance executions still run again.

In **Compiler passes**, inspect a cached invocation's explanation and its
`originInvocation`. Follow a transformation's **Inspect compiler invocation**
link to see the invocation that actually performed the edit. When that origin
belongs to the first run, the workbench explicitly identifies it. Cached
reuse retains the original edit evidence instead of fabricating new
transformation steps. This lets you distinguish three concrete questions:
which revision was reused, why the computational cache accepted it, and why
the current semantic policy accepted its use.

## 4. Inspecting and transforming native IRs

The third layer gives algorithms a common way to observe and edit representations. A scene optimizer can find repeated definitions, an expression optimizer can recognize repeated operands, and a constraint optimizer can follow variable dependencies using the same inspection and transaction machinery. Their native data structures and semantic checks remain separate.

This chapter builds a real transformation of `(x + 0) + 0` into `x`. The complete, executable tutorial is `src/guide/02-ir-manipulation.ts`. From the workspace root, run:

```sh
npm run build
node dist/guide/02-ir-manipulation.js
```

The tutorial asserts its results. It finds two matches, commits two checked rewrites, retains three revisions, and traces the original output to `x`. Its inverse trace identifies `first`, `second`, and `x` as contributors to the final entity. It also demonstrates a prepared draft that never publishes and rejected stale references. The implementation sources for this chapter are `src/ir/`, the expression adapter in `src/ir-examples/expressions.ts`, and the executable tutorial itself.

### 4.1 Keep native storage behind an adapter

The tutorial's native expression value is a keyed arena:

```ts
const source: ExpressionProgram = {
  root: 'second',
  nodes: {
    x: { op: 'variable', name: 'x' },
    zero: { op: 'constant', value: 0 },
    first: { op: 'add', args: ['x', 'zero'] },
    second: { op: 'add', args: ['first', 'zero'] }
  }
};
```

It contains ordinary operation records and operand IDs. The expression adapter projects these into logical entities and typed relationships when the generic layer needs them. Scenes use definition and instance tables; meshes use packed coordinate and face arrays; constraints use sparse coefficients. Those representations do not have to adopt the expression arena's layout.

An `IREntity` has `id`, `kind`, and `attributes`. An `IRRelation` has a stable `id`, a domain-specific `kind`, a shared `category`, `from` and `to` IDs, and optional `order` and `attributes`. `IRGraph` groups entities, relationships, and roots. This graph is the common inspection/edit projection. It is not automatically a valid standalone native program.

`IRAdapter<T>` identifies its own `id` and `version`, the native `kind` and `schemaVersion`, a description, and a `relationKinds` mapping. Its callback interface is:

| Adapter callback | Result and responsibility |
| --- | --- |
| `entities(value: T): Iterable<IREntity>` | Enumerate logical entities. |
| `resolve(value: T, entity: string): IREntity \| undefined` | Agree with enumeration for every existing ID. |
| `relations(value: T): Iterable<IRRelation>` | Enumerate typed edges with existing endpoints. |
| `describe(value: T, entity: string): EntityDescription` | Supply a human-readable label and optional detail/statistics. |
| `roots?(value: T): readonly string[]` | Specify roots; otherwise derive containment roots. |
| `validate?(value: unknown): void` | Reject malformed native data. |
| `rebuild?(base: T, graph: IRGraph): T` | Translate the edited projection back into native storage. |
| `operation?(value: T, entity: string): Operation \| undefined` | Expose an operation name and ordered operand IDs. |
| `serialize?(value: T): string` | Encode the native representation. |
| `deserialize?(text: string): T` | Decode it; must accompany `serialize`. |
| `visualize?(value: T, selection: readonly string[]): IRVisualization` | Return a portable visualization kind and data. |

`defineAdapter` snapshots metadata and callback identities. Projecting or opening an artifact rejects duplicate logical IDs, undeclared relationship types, dangling endpoints, invalid roots, and disagreement between resolution and enumeration. A rewritable adapter must supply both `rebuild` and `validate`. Rebuilding must reproduce the complete edited entity/relationship projection; silently discarding an unsupported edit is an error. Native roots are derived from the rebuilt value and included in the resulting difference.

Capabilities describe what these methods actually provide. Every adapter supports `Traversable`, `Queryable`, and `Diffable`. Optional methods add `Verifiable`, `Rewritable`, `Serializable`, `Visualizable`, and `Operations`. Adapter callbacks are synchronous; entity and relationship enumeration may use synchronous iterators. A class-based implementation should be wrapped in a plain adapter definition with own callback properties.

| Construction and registration API | Return type |
| --- | --- |
| `defineAdapter<T>(definition: IRAdapter<T>)` | `IRAdapter<T>` |
| `describeAdapter(adapter: IRAdapter<any>)` | `AdapterDescriptor` |
| `createIRArtifact<T>(adapter: IRAdapter<T>, id: string, value: T)` | `Artifact<T>` |
| `validateIRArtifact<T>(adapter: IRAdapter<T>, artifact: Artifact<T>)` | `Artifact<T>` |
| `deserializeIR<T>(adapter: IRAdapter<T>, id: string, text: string)` | `Artifact<T>` |
| `openIR<T>(artifact: Artifact<T>, adapter: IRAdapter<T>, store?: IRStore)` | `IRView<T>` |
| `AdapterRegistry.register<T>(definition: IRAdapter<T>)` | `IRAdapter<T>` |
| `AdapterRegistry.get<T>(id: string, version: string)` | `IRAdapter<T>` |
| `AdapterRegistry.describe()` | `readonly AdapterDescriptor[]` |

Changing a registered adapter under the same version tuple is rejected. Identical registrations can be reused. Artifact creation captures finite immutable data and computes content and revision hashes; opening an artifact verifies those hashes instead of trusting supplied strings.

### 4.2 Query a revision, and choose the right relationships

Open the arena with a shared revision store:

```ts
const store = new IRStore();
const artifact = createIRArtifact(
  expressionAdapter, 'guide.expression', source
);
const before = openIR(artifact, expressionAdapter, store);
const output = before.ref('second');
```

`output` is `{artifact, revision, entity}`. A local string such as `'second'` is convenient inside one bound view. A qualified reference is necessary when recording evidence or moving between views: the same entity ID in another revision is not interchangeable. The view carries its `artifact`, `adapter`, `descriptor`, and `capabilities`. Old views stay readable after a commit. `oldView.at(committedArtifact)` obtains a new view through the same adapter and store; it cannot silently retain an unpublished candidate.

Relationship categories answer different questions:

| Category | Example question |
| --- | --- |
| `containment` | Which objects structurally belong to this program or scene? |
| `dependency` | Which operands or variables does this entity use? |
| `binding` | Which shared definition does this occurrence reference? |
| `adjacency` | Which mesh entities are neighbors? |
| `provenance` | Which explicitly modeled origin relationship is present? |

The expression adapter's program contains all arena nodes, while `operand` edges describe nested computation. Therefore, `children(program)` lists membership; `dependencies(sum)` follows computation. Treating both relations as one undifferentiated graph would change the meaning of an inner-first transformation.

The following tables use `Target = EntityTarget`, `Targets = readonly EntityTarget[]`, `Names = readonly string[]`, and `Attributes = Readonly<Record<string, unknown>>` as typography abbreviations, not additional exported types. `Direction` abbreviates `'incoming' | 'outgoing' | 'both'`; `Order` abbreviates `'pre' | 'post' | 'breadth'`.

| `IRView<T>` observation method | Return type |
| --- | --- |
| `ref(target: Target)` | `IRRef` |
| `entities()` | `readonly IRRef[]` |
| `resolve(target: Target)` | `IREntity` |
| `describe(target: Target)` | `EntityDescription` |
| `relations(target?: Target, direction?: Direction)` | `readonly IRRelation[]` |
| `operation(target: Target)` | `Operation \| undefined` |
| `graph()` | `IRGraph` |
| `find(predicate: (entity: IREntity, ref: IRRef) => boolean)` | `readonly IRRef[]` |
| `serialize()` | `string` |
| `visualize(selection?: Targets)` | `IRVisualization` |

`relations()` without a target returns all edges. With a target, its default direction is `both`. Unsupported serialization or visualization fails explicitly. `find` requires a synchronous Boolean predicate; frozen entities cannot be edited through its arguments.

| Navigation method | Return type and scope |
| --- | --- |
| `walk(options?: WalkOptions)` | `readonly WalkVisit[]`; cycle-safe traversal. |
| `children(target: Target)` | `readonly IRRef[]`; outgoing containment. |
| `parents(target: Target)` | `readonly IRRef[]`; incoming containment. |
| `successors(target: Target, relation?: string \| Names)` | `readonly IRRef[]`; outgoing selected kinds, or all kinds when omitted. |
| `predecessors(target: Target, relation?: string \| Names)` | `readonly IRRef[]`; reverse selected kinds. |
| `ancestors(target: Target, options?: {maxNodes?: number})` | `readonly IRRef[]`; transitive containment parents. |
| `dependencies(target: Target, options?: DependencyOptions)` | `readonly IRRef[]`; dependency and binding closure by default. |
| `subgraph(selection: Targets, options?: SubgraphOptions)` | `IRSubgraph`; selected logical projection. |

`WalkOptions` contains `order`, `roots`, `relations`, `direction`, `maxNodes`, and `maxDepth`. Defaults are pre-order, outgoing containment, and node/depth limits of 10,000. Without explicit roots, disconnected components are included. `DependencyOptions` adds `transitive` - default `true` - and selected `relations`/`maxNodes`. `SubgraphOptions.closure` is `'none'`, `'dependencies'`, or `'connected'`; the default is the induced selection without closure. Its optional relation filter determines included edges.

These traversal methods also have exported function forms with the view as their first argument. Exhausting a bound throws `IRBudgetError`; a partial traversal is not returned as a complete answer.

### 4.3 Match structures and inspect the evidence

The tutorial recognizes an addition whose second operand is the constant zero:

```ts
const addZero = pattern(capture('sum', op(
  'add', capture('term'),
  entity('expression.constant', { value: 0 })
)));
const found = matchAll(addZero, before, {
  order: 'post', relations: ['operand']
});
```

The two roots are `first` and `second`, in that order. Each match binds `sum` and `term` to exact revision references. `op` checks operation name, arity, and ordered operands through the adapter; it does not inspect arbitrary native field names.

| Pattern constructor | Return type |
| --- | --- |
| `entity(kind?: string, attributes?: Attributes)` | `NodePattern` |
| `op(name: string, ...operands: NodePattern[])` | `NodePattern` |
| `capture(name: string, inner?: NodePattern)` | `NodePattern` |
| `sameAs(name: string)` | `NodePattern` |
| `pattern(nodes: NodePattern \| Readonly<Record<string, NodePattern>>)` | `PatternBuilder` |
| `distinct(...names: string[])` | `PatternCondition` |
| `equalContent(...names: string[])` | `PatternCondition` |
| `relation(kind: string, from: string, to: string)` | `PatternCondition` |
| `where(predicate: VersionRef, params?: unknown)` | `PatternCondition` |
| `new PatternBuilder(descriptor: PatternDescriptor)` | `PatternBuilder` |
| `PatternBuilder.where(condition: PatternCondition)` | New `PatternBuilder` |
| `PatternBuilder.toJSON()` | `PatternDescriptor` |
| `describePattern(input: PatternInput)` | `PatternDescriptor` |

`entity` tests the supplied attribute subset; each supplied nested value is compared completely. `sameAs` means the same entity identity, including when used as a forward equality constraint on a declared capture. Different names may bind the same entity until `distinct` forbids it.

`equalContent` compares kind, complete attributes, and - when available - operation name and ordered operand IDs. It ignores the entity's own ID and incoming edges. It does not recursively prove equivalent subgraphs or equivalent geometry. For stronger domain meaning, register a versioned predicate, then reference it with `where({id, version}, params)`. The constraint example does this to compare normalized sparse equations.

| Query API | Return type |
| --- | --- |
| `match(input: PatternInput, view: IRReader<any>, options?: MatchOptions)` | `PatternMatch \| undefined` |
| `matchAll(input: PatternInput, view: IRReader<any>, options?: MatchOptions)` | `readonly PatternMatch[]` |
| `explainMatch(found: PatternMatch)` | `MatchExplanation` |
| `explainMatch(input: PatternInput, view: IRReader<any>, target?: Target, options?: MatchOptions)` | `MatchExplanation` |
| `searchPattern(view: IRReader<any>, input: PatternInput, options?: MatchOptions, firstOnly?: boolean)` | `PatternSearch` |
| `orderedCandidates(view: IRReader<any>, order?: Order, relations?: Names)` | `readonly IRRef[]` |

`match`, `matchAll`, and the query form of `explainMatch` also accept view-first argument order. `IRView` satisfies `IRReader`. A builder's `descriptor` is finite data, so serialized patterns can be restored and queried independently of their construction code.

`MatchOptions` supplies exact candidate `roots`, traversal `order`, `relations`, `registry`, `maxSteps`, and `maxMatches`. In a graph pattern, capture names are assigned in lexical order; its first capture determines the root. Later captures can search the whole representation. Defaults allow 100,000 matching steps and 10,000 matches. `matchAll` either completes or throws `PatternBudgetError`, whose `partial` results are explicitly incomplete. `match` can stop earlier because its contract asks for only one result.

Every `PatternMatch` includes `artifact`, `root`, `bindings`, `pattern`, `evidence`, `steps`, and a stable `key`. Evidence records which kind, attribute, arity, equality, or predicate checks passed. Failure explanations retain a candidate's mismatch evidence; they are diagnostic traces rather than formal proofs of impossibility.

| `PatternPredicateRegistry` method | Return type |
| --- | --- |
| `register<T, P>(definition: PatternPredicateDefinition<T, P>)` | `this` |
| `get(reference: VersionRef)` | `PatternPredicateDefinition<any, any>` |
| `descriptors()` | `readonly PatternPredicateDescriptor[]` |
| `snapshot()` | `PatternPredicateRegistry` |

A predicate definition has `id`, `version`, `description`, and `test({view, bindings}, params)`, returning a Boolean or `{pass, reason}`. Queries snapshot registry callbacks. Async predicates are rejected, and callback exceptions remain errors; they do not quietly mean “no match.”

### 4.4 Express the change, then let the transaction publish it

The replacement redirects consumers of the addition to its surviving operand, removes the addition, and records both entities as contributors:

```ts
const eliminateAddZero = rewrite<ExpressionProgram>({
  id: 'guide.eliminate-add-zero', version: '1', match: addZero,
  description: 'Replace x + 0 in the integer polynomial fragment',
  replace(found, edit) {
    const { sum, term } = found.bindings;
    edit.redirectReferences(sum, term, {
      relations: ['operand', 'result']
    });
    edit.remove(sum);
    edit.correspond([term, sum], term, 'eliminated-add-zero');
  },
  preserves: [{ id: 'guide.same-polynomial', version: '1' }]
});
```

The correspondence call after removal is valid: its source IDs resolve against the immutable base, while target IDs resolve against the draft. A merge can therefore name a removed source without pretending that it still exists in the output.

`view.beginEdit(options?: EditOptions<T>): IREdit<T>` is the direct transaction entry point. `EditOptions` has `label` and optional `verify`. Its mutation API is:

| Edit signature | Behavior |
| --- | --- |
| `insert(entity: IREntity): IRRef` | Insert a unique ID. Its returned handle is draft-local. |
| `replace(target: Target, entity: IREntity): void` | Preserve ID; replace kind/attributes. |
| `update(target: Target, attributes: Attributes): void` | Shallow merge attributes. |
| `remove(target: Target): void` | Remove the entity and incident edges, without cascading other entities. |
| `connect(from: Target, relation: string \| RelationSpec, to: Target): string` | Add a typed edge and return its ID. |
| `disconnect(relationId: string): void` | Remove one exact edge. |
| `disconnect(from: Target, kind: string, to: Target): void` | Remove matching endpoint edges. |
| `redirectReferences(from: Target, to: Target, options?: RedirectOptions): void` | Redirect selected edges; default is incoming dependency/binding. |
| `correspond(from: Target \| Targets, to: Target \| Targets, relation?: string): void` | Record origin association, including empty endpoints. |

`RelationSpec` contains required `kind` and optional `id`, `order`, and `attributes`. Supply an ID compatible with native reconstruction when the adapter derives IDs from structural roles. `RedirectOptions` selects `relations` and `direction`; containment and adjacency are not redirected implicitly. An inserted handle carries the base revision but is usable only inside its draft. Obtain a normal output reference from the committed view.

| Transaction lifecycle method | Return type and effect |
| --- | --- |
| `preview()` | `IRGraph`; immutable draft projection. |
| `prepare()` | `TransformationResult<T>`; seal, rebuild, validate, compute changes/correspondence, without publishing. |
| `commit()` | `Promise<TransformationResult<T>>`; verify and atomically publish. |
| `rollback(reason?: string)` | `void`; discard an uncommitted draft. |
| `view.at(artifact: Artifact<T>)` | `IRView<T>` over an already retained revision. |

`TransformationResult` contains `artifact`, `changes`, `correspondence`, and `diagnostics`. Preparation verifies the complete requested projection against the rebuilt native value. Commit checks the current head again after awaited verification, so a second writer cannot be overwritten by a slow first writer. A generation counter also detects an intervening no-op commit or an A→B→A content cycle. These guarantees apply to writers sharing the same in-memory `IRStore`.

The semantic gate has this exact shape:

```ts
verify(
  candidate: TransformationResult<T>,
  before: Artifact<T>
): EditAcceptance | Promise<EditAcceptance>
```

Its acceptance object has synchronous `commit(): void` and `rollback(reason?: string): void`. Checks may await; final acceptance/publication does not. The semantic manager's prepared transformation implements this protocol. If verification throws before returning an acceptance, the verifier must discard any staging it created; after receiving an acceptance, the edit transaction owns commit/rollback.

The tutorial gate compares `expressionPolynomial(candidate.artifact.value)` with `expressionPolynomial(before.value)` and records acceptance only inside `commit`. This is an actual equality check for the bounded integer-coefficient fragment, distinct from a `preserves` declaration and from checking a few numeric samples. It does not claim a general floating-point equivalence theorem or a formal proof certificate.

Rewrite callbacks receive a narrower `RewriteEdit`: mutation methods, `base`, `state`, and `preview`, with no lifecycle methods. Their mutation lease expires when the replacement settles, before verification. Guards, predicates, and replacements receive a frozen `IRReader` without `beginEdit` or `at`. These boundaries prevent accidental early publication. Registered TypeScript remains trusted code; closures holding unrelated application resources are outside this capability boundary.

### 4.5 Choose a schedule and interpret its stopping condition

Local rewriting and scheduling are separate. The tutorial uses:

```ts
const optimized = await innermost(before, eliminateAddZero, {
  relations: ['operand'], budget: 8, verify
});
```

This first eliminates `first`, re-matches the changed arena, and eliminates `second`. Both steps preserve the checked polynomial. Selecting `operand` matters: program containment is flat, whereas the computation is nested.

| Operator | Implemented scheduling semantics |
| --- | --- |
| `applyOnce` | Commit the first eligible changing match; skip rejected guards and no-ops. |
| `applyAll` | Snapshot the starting match frontier, then revalidate surviving binding tuples after each edit. Introduced matches are outside that sweep. |
| `topDown` | One initial pre-order sweep; at most one accepted replacement per surviving root. |
| `bottomUp` | The corresponding single post-order sweep. |
| `innermost` | Normalize one rule in post-order; restart matching after each accepted change. |
| `outermost` | Normalize one rule in pre-order; restart after each accepted change. |
| `saturate` | Normalize prioritized directed rules; restart at the first rule after a change. |

For the first six names, the overloads are identical:

```ts
operator<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>)
  : RewriteSchedule<T>
operator<T>(view: IRView<T>, rule: RewriteRule<T>,
  options?: RewriteOptions<T>): Promise<RewriteResult<T>>
operator<T>(rule: RewriteRule<T>, view: IRView<T>,
  options?: RewriteOptions<T>): Promise<RewriteResult<T>>
```

For `saturate`, replace the single `rule` parameter with `rules: readonly RewriteRule<T>[]`. A reusable schedule has `descriptor` and `run(view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>`. The descriptor records the mode, rule references, budgets, and selected relationship names.

All schedules default to containment order. Explicit `relations` derive starting roots from zero incoming selected edges, then include disconnected and cyclic components deterministically. No-op replacements cannot drive an infinite loop. Normalizing schedules detect repeated content before publishing the repeating candidate and retain the last unique accepted revision. This is bounded directed rewriting, without an e-graph or equality-saturation search.

`RewriteOptions` includes `budget`, `registry`, `relations`, `verify`, synchronous `classifyRejection(error): boolean`, and `signal: AbortSignal`. Numeric `budget` sets `maxApplications`. The object form provides:

| Budget field | Default |
| --- | --- |
| `maxApplications` | 100 accepted changes |
| `maxAttempts` | 1,000 attempted matches |
| `maxMatchSteps` | 1,000,000 shared matching steps |
| `maxMatches` | 10,000 matches per query |

The first three permit zero; `maxMatches` must be positive. Reaching a limit is not evidence of convergence. At the application limit, the engine may still establish that no changing candidate remains; otherwise it returns `budget` with the uncommitted candidate when available.

`RewriteResult` reports `status`, `reason`, `applications`, `attempts`, `matchSteps`, immutable `steps`, and the final artifact/view. Outcomes distinguish `applied`, `converged`, `no-match`, `rejected`, `budget`, `cycle`, and `cancelled`. Unexpected failures throw `RewriteExecutionError` with the partial `result` and cause; false guards, `RewriteRejected`, or an explicit classifier identify expected rejection.

Each accepted step is a separate transaction. Earlier accepted steps remain if a later one fails. A step's provisional `result` can also appear on rejection, cycle, or budget records: **only step status `applied` means publication**. Preservation metadata is `unverified` or `host-accepted`; consult the host's actual semantic evidence for what was checked. Persist a schedule result without its live `view`.

| Rule and execution API | Return type |
| --- | --- |
| `rewrite<T>(definition: RewriteDefinition<T>)` | `RewriteRule<T>` |
| `RewriteRegistry.register<T>(rule: RewriteRule<T>)` | `this` |
| `RewriteRegistry.get<T>(ref: VersionRef)` | `RewriteRule<T>` |
| `RewriteRegistry.descriptors()` | `readonly RewriteDescriptor[]` |
| `RewriteRegistry.snapshot()` | `RewriteRegistry` |
| `executeRewrites<T>(view: IRView<T>, rules: readonly RewriteRule<T>[], mode: RewriteMode, options?: RewriteOptions<T>)` | `Promise<RewriteResult<T>>` |
| `readIR<T>(view: IRReader<T>)` | `IRReader<T>` |

A rule definition has `id`, optional `version`/`description`, `match`, optional synchronous `guard(match, reader)`, `replace(match, edit, reader)`, and optional `preserves: readonly VersionRef[]`. Replacements may be awaited; guards return a Boolean or `{accept, reason?}`. Registry versions cannot be redefined.

### 4.6 Compare revisions and follow origins

Differences answer what changed. Correspondence answers what an entity became or which entities contributed to it. These are separate questions: merging a definition removes an ID, redirects several bindings, and associates multiple source definitions with one survivor.

`diff` compares logical entity content, relationships, and roots, even across different adapters. It does not infer semantic equivalence. `affectedEntities` includes changed entity references, changed edge endpoints, and changed roots, qualified by their before/after revisions. The transaction's operation log records requested edits; its calculated difference records their actual effect.

| Difference API | Return type |
| --- | --- |
| `diff(before: IRView<any>, after: IRView<any>)` | `ChangeSet` |
| `diffGraphs(before: IRGraph, after: IRGraph, from: RevisionRef, to: RevisionRef, operations?: readonly EditOperation[])` | `ChangeSet` |
| `affectedEntities(changes: ChangeSet)` | `readonly IRRef[]` |

An `EntityCorrespondence` names exact source and target revisions, their complete entity universes, and entries `{from: string[], to: string[], relation: string}`. Every source and target must be accounted for. An empty source represents creation; an empty target represents removal. Empty-to-empty entries are invalid.

A grouped entry denotes a Cartesian relation. Thus `[a,b] → [c,d]` means all four associations, not just `a→c` and `b→d`. Use separate entries for the latter. The tutorial's `[term,sum] → [term]` is a many-to-one relation; a face split would use one-to-many. Ordinary relational composition joins through an intermediate entity:

```text
(a, c) belongs to S composed with R
exactly when some b has (a, b) in R and (b, c) in S.
```

Creation and deletion witnesses supplement that ordinary relation. Composition retains their surviving endpoints; an entity created and subsequently deleted has no endpoint to report. Intermediate artifact ID, revision, and complete entity universe must agree. Equal-looking IDs in a different revision are insufficient.

| Correspondence API | Return type |
| --- | --- |
| `makeCorrespondence(from: RevisionRef, to: RevisionRef, sourceEntities: Names, targetEntities: Names, explicit?: readonly CorrespondenceEntry[])` | `EntityCorrespondence` |
| `validateCorrespondence(input: EntityCorrespondence)` | `EntityCorrespondence` |
| `composeCorrespondence(first: EntityCorrespondence, second: EntityCorrespondence, options?: {maxPairs?: number})` | `EntityCorrespondence` |
| `invertCorrespondence(input: EntityCorrespondence)` | `EntityCorrespondence` |
| `traceEntity(start: IRRef, throughRevisions: readonly EntityCorrespondence[], options?: {maxRefs?: number})` | `EntityTrace` |

`makeCorrespondence` fills unmentioned retained IDs, additions, and removals. An explicitly reassigned origin can leave a surviving target with an `unmapped-origin` witness; explicit association does not magically preserve identity. Composition and tracing default to 100,000 pairs/references and fail explicitly on exhaustion.

The tutorial collects only applied results and follows their chain:

```ts
const chain = committed.map(result => result.correspondence);
const composed = composeCorrespondence(chain[0], chain[1]);
const traced = traceEntity(before.ref('second'), chain);
const origins = traceEntity(after.ref('x'), [
  invertCorrespondence(composed)
]);
```

`traced.current` contains `x`. `origins.current` contains `first`, `second`, and the original `x`. Inversion recovers historical associations; it cannot reconstruct discarded native data or execute an undo. Tracing retains branching and removal evidence at each step. For competing compiler branches, first select a contiguous recorded path; unrelated branch correspondences are not one chain.

Finally, an origin relation does not prove a preservation claim. Transferring an analysis across revisions still requires the semantic layer's justification. Likewise, an entity with no descendant may have been intentionally eliminated, not lost by a broken visualization.

### 4.7 Lower-level reference and practical boundaries

The revision store exposes history and head inspection, not a public publication bypass:

| `IRStore` API | Return type |
| --- | --- |
| `retain<T>(artifact: Artifact<T>)` | `Artifact<T>`; seed a lineage or retrieve an exact retained revision. |
| `get<T>(ref: RevisionRef)` | `Artifact<T>` |
| `head<T>(id: string)` | `Artifact<T>` |
| `revisions(id: string)` | `readonly Artifact[]` |
| `generation(id: string)` | `number` |
| `assertHead(base: Artifact, generation?: number)` | `void`; reject stale ownership. |

An existing lineage cannot acquire an arbitrary new revision through `retain`; new revisions enter through edit transactions. Storage is process-local and in memory. Export traces and source for persistence; distributed publication, recovery, and persistent indexing are separate extensions.

Adapter authors and infrastructure extensions also have these projection helpers:

| Helper signature | Return type |
| --- | --- |
| `project<T>(adapter: IRAdapter<T>, value: T)` | `IRGraph` |
| `validateEntity(entity: IREntity)` | `IREntity` |
| `validateGraph(adapter: IRAdapter<any>, input: IRGraph)` | `IRGraph` |
| `compareRelations(a: IRRelation, b: IRRelation)` | `number` |
| `relationFilter(view: IRView<any>, kinds?: Names)` | `Set<string> \| undefined` |
| `revisionRef(artifact: {id: string; revision: string})` | `RevisionRef` |
| `sameRevision(a: RevisionRef, b: RevisionRef)` | `boolean` |
| `refKey(ref: IRRef)` | `string` |
| `compareText(a: string, b: string)` | `number` |

The barrel also exports these validation utilities from `src/ir/common.ts`:

| Utility signature | Return/assertion |
| --- | --- |
| `nonempty(value: unknown)` | `value is string` |
| `requireText(value: unknown, label: string)` | `asserts value is string` |
| `requireRecord(value: unknown, label: string)` | `asserts value is Record<string, unknown>` |
| `limit(value: number \| undefined, fallback: number, name: string, allowZero?: boolean)` | `number` |
| `synchronous<T>(value: T, label: string)` | `T` |
| `syncFunction(fn: Function, label: string)` | `void` |

Domain clients normally use adapter/view APIs, which already apply these checks. Error types distinguish `IRError`, `IRBudgetError`, `PatternBudgetError`, `RewriteRejected`, and `RewriteExecutionError`.

When adding a representation, first make enumeration, resolution, native validation, and reconstruction agree. Then choose meaningful named relationships, author a small rule, inspect its actual change set and origins, and attach the domain check that makes publication acceptable. The tutorial demonstrates that progression with executable assertions; `tests/ir-foundation.test.mjs` and `tests/ir-rewriting.test.mjs` cover the failure cases that the happy-path walkthrough intentionally does not trigger as unhandled errors.

## 5. Programming compilation strategies

A compilation strategy describes **which algorithms to run, how to compose their
results, and how to choose among alternatives**. It is itself an immutable,
inspectable program. Keep three different programs distinct when designing a
compiler:

| Program | Example | Owner |
| --- | --- | --- |
| Object program | A scene, expression, mesh, or constraint system | Domain language |
| Compilation strategy | Build alternatives, check bounds, select a candidate | Strategy IR |
| Algorithm implementation | Redirect references or simplify a polygon fan | Versioned callback |

Changing a scene definition changes the object program. Changing the allowed
mesh error changes strategy policy. Fixing the simplifier changes its
implementation and requires a new algorithm version. These changes have
different identities and different debugging evidence.

The Strategy IR does not prescribe a universal artifact representation or own a
compiler cache. A registered algorithm may invoke a compiler task, query semantic
analysis, or run a generic rewrite schedule. Its return value becomes strategy
data. The existing `src/ir-examples/lab.ts` connects all these layers; the runnable
guide example below also shows how to compose the reusable layers without a
compiler runtime host.

### 5.1 Plans and versioned algorithms

Import the public strategy API from `src/strategy/index.ts`. A `StrategyPlan`
contains `formatVersion: 1`, an `id`, a `root` node, optional `description`, and
optional `requirements`. Every node has a unique `id`; references to executable
code contain an algorithm `id` and exact `version`.

`algorithm(id, version = '1')` constructs a reference. It does not register code.
`new AlgorithmRegistry().register(definition)` installs a callback with
`id`, `version`, `kind`, `description`, and `run(ctx, input, args)`. The six kinds
are `transform`, `analysis`, `predicate`, `selector`, `invariant`, and `metrics`.
An `apply` node requires a transform; using an analysis reference there is a
validation error.

The registry provides `get(ref, kind?)`, `has(ref, kind?)`, `list()`, and
`snapshot()`. Registering the same ID/version twice is rejected. Execution takes
a registry snapshot, so later registration cannot change an in-flight plan.
Versioning remains an application responsibility: the registry does not derive
an implementation version from a function's source text.

`plan(id, root, description?, requirements?)` validates and freezes a plan.
The optional `requirements` pin additional algorithms used transitively by a
host integration. This is useful when a plan directly references a composite
algorithm whose implementation depends on other registered capabilities.

### 5.2 The thirteen strategy operators

The following are the actual builder calls. They return data nodes; evaluation
happens through `execute` or `executeOrThrow`.

| Builder | Operational meaning |
| --- | --- |
| `apply(id, algorithmRef, options?)` | Call a transform with resolved input and arguments; return its result. |
| `sequence(id, ...steps)` | Feed each result to the next child; return the last result. An empty sequence is an identity. |
| `parallel(id, steps, options?)` | Run children against the same input in isolated binding frames; return results in declared order. |
| `fork(id, branches, options?)` | Run named alternatives and return a `strategy.candidates` value, retaining expected rejections. |

`fork` takes entries shaped as `{name, strategy}`. It differs from `parallel`
because a recoverable rejection is recorded as a rejected candidate rather than
discarding the entire candidate set. An unexpected implementation failure still
fails the fork.

| Builder | Operational meaning |
| --- | --- |
| `chooseBest(id, candidates, objective, options?)` | Evaluate a candidate-producing child, filter by metric constraints, and return the best feasible value. |
| `conditional(id, predicate, then, otherwise, options?)` | Require a Boolean predicate result, execute one branch, and record the other as skipped. |
| `attempt(id, body, fallback, options?)` | Run a fallback only for an explicit recoverable rejection matching the optional code list. |

The `objective` is `{metric, direction: 'min' | 'max'}`. Constraints are
`{metric, op, value}`, with `op` one of `<=`, `>=`, `<`, `>`, or `==`.
`chooseBest` obtains a finite numerical metric map from its `metrics` algorithm,
or from the candidate value's `metrics` field. Missing or nonfinite metrics are
errors. Equal objective values are resolved by candidate name in code-unit
lexicographic order. `decisionAs` can bind the complete selection evidence,
including rejected and infeasible alternatives.

| Builder | Operational meaning |
| --- | --- |
| `repeatUntilStable(id, body, options)` | Repeat until adjacent identities agree; diagnose cycles and exhausted iteration limits. |
| `forEach(id, body, options)` | Select a bounded array of items, run the body for each, and preserve result order. |

`repeatUntilStable` requires `maxIterations`; its optional `identity` is an
analysis algorithm. The default treats an artifact's kind, schema version, and
revision as its semantic identity, so changing only its logical artifact name
does not prevent convergence. Other values use their complete finite-data
content. A repeated nonadjacent identity is a cycle, not a fixed point.

`forEach` requires `maxItems`. Supply either a `selector` algorithm or an `items`
template; the current value is the default when neither supplies another array.
The body receives the item as its current value and also exposes item/index
references. `concurrency` bounds local scheduling.

| Builder | Operational meaning |
| --- | --- |
| `require(id, analysis, as, options?)` | Compute an analysis, bind its value under `as`, and preserve the current value. |
| `verify(id, invariant, options?)` | Check a Boolean or `{ok, reason?, evidence?}` result; preserve the current value on success. |
| `checkpoint(id, name, data?, options?)` | Record resolved evidence without changing the current value. |
| `scope(id, name, body, options?)` | Give nested execution a named boundary and isolate its bindings. |

To avoid confusion with other meanings of `require`, the guide imports the
strategy builder as `requireAnalysis`. It is unrelated to JavaScript module
loading and distinct from the semantic context's property requirement method.

Where accepted by a builder, common options are `label` and `bind`. Call options
are `input` and `args`; otherwise the algorithm receives the current value and
an empty argument object. `parallel` and `fork` accept local `concurrency`;
`attempt` accepts `codes`; `verify` accepts a rejection `code`. The `sequence`
builder takes only an ID and variadic children, not an options object.

### 5.3 Value references and binding scope

Templates recursively contain ordinary finite values plus explicit references.
`ref(source, path?, name?)` supports these sources:

| Source | Value available at that point |
| --- | --- |
| `input` | The original execution input |
| `current` | The value entering the current node |
| `binding` | A named visible binding; use `binding(name, path?)` |
| `item`, `index` | The current `forEach` item and its zero-based index |
| `iteration` | The current one-based repeat iteration |

For example, `ref('input', ['source'])` selects a field of the original input;
`binding('baseline', ['triangles'])` selects an earlier analysis result. Paths
must name existing own properties. An absent path fails explicitly instead of
silently supplying `undefined`.

Sequential siblings share bindings created in their sequence's local frame.
Parallel branches, fork alternatives, scopes, and iteration bodies receive
isolated frames. A binding inside a nested composite does not leak outward;
bind the composite's result if the parent needs it. Validation checks reference
availability and scope before execution.

Use `literal(value)` when domain data legitimately contains `$ref` or `$literal`
keys. Without that wrapper, the template evaluator interprets those keys as
template syntax. Functions, cyclic objects, accessors, and nonfinite numbers do
not belong in plans or algorithm results.

### 5.4 Validate, edit, and persist a strategy

`validate(value, registry?)` returns `{valid, issues}`. Each issue identifies its
path, code, message, and applicable node ID. `assertValid` throws a
`PlanValidationError`. Validation covers structure, unique node IDs, bounded
operators, reference scope, and, with a registry, exact algorithm availability
and kind. `execute` performs this check before running callbacks.

The editing API operates on complete immutable plans:

| API | Result |
| --- | --- |
| `walk(plan, visitor?)` | Preorder visits containing node, parent, path, depth, and slot |
| `childNodes(node)` | Direct children with their structural slot names |
| `find(plan, idOrPredicate)` | The first matching node, or `undefined` |
| `replace(plan, id, node)` | A validated plan with the selected node replaced |
| `insertBefore` / `insertAfter` | Insert a sibling in a sequence, or create a fresh sequence wrapper |
| `remove(plan, id)` | Remove an optional collection child; reject removal of a root or required slot |
| `diff(before, after)` | Added, removed, changed, and moved node records |

Each edit preserves the previous plan and validates the resulting one. To remove
the behavior in a required slot, explicitly replace it with `sequence(id)`;
leaving a missing branch is invalid.

`serialize(plan, pretty = true)` produces canonical JSON interchange, while
`deserialize(text, registry?)` parses, validates, and freezes it. The workbench
renders and edits the same data as highlighted YAML. YAML presentation does not
change the strategy model or introduce executable functions into the plan.

### 5.5 Execution, budgets, and failure classification

`execute(plan, registry, input, options?)` returns an immutable
`StrategyExecution`, including the plan snapshot/revision, registered versions,
input, status, successful value or error, node execution records, and events.
Algorithm/runtime failures become trace statuses; invalid plans or options can
throw before execution begins. `executeOrThrow` additionally throws a
`StrategyExecutionError` for a non-successful execution, retaining the trace in
its `execution` field.

Options include `id`, `signal`, `maxSteps`, `maxDepth`, `maxConcurrency`, and
`onEvent`. Defaults are 100,000 node visits, depth 256, and concurrency 8.
Visits include skipped nodes. Operator-specific iteration/item limits apply in
addition to these global budgets. Concurrency is bounded asynchronous
scheduling, not automatic worker-thread parallelism. Cancellation is cooperative;
long-running algorithms must observe `ctx.signal`.

The algorithm context also supplies `record(label, data)`,
`link({taskId, invocationId?, cache?, artifact?})`, and
`reject(code, message, evidence?)`. Links connect strategy decisions to actual
compiler invocations. Contexts close when their callback returns.

Only `StrategyRejected` is an expected rejection. `ctx.reject` creates it;
failed strategy verification creates one as well. `attempt` never converts an
ordinary thrown bug into a successful fallback. A fork retains expected
rejections but propagates unexpected failures, and waits for already-started
sibling work before finishing. An observer exception is recorded as diagnostic
evidence and disables that observer; it does not rewrite the compilation result.

### 5.6 Walkthrough: a strategy with checked rewrites

Run the complete, strictly compiled example from the workspace root:

```sh
npm run build
node dist/guide/03-strategy-contracts.js
```

The source is `src/guide/03-strategy-contracts.ts`. The excerpts here are from
that file; its imports, registered callbacks, and helper definitions are part of
the runnable example. Its strategy counts arithmetic operations, normalizes an
expression, recounts, checks input/output equivalence, and records the comparison:

```ts
const original = plan('guide.checked-normalization', sequence('pipeline',
  requireAnalysis('count.before', algorithm('guide.cost'), 'before'),
  apply('normalize', algorithm('guide.normalize')),
  requireAnalysis('count.after', algorithm('guide.cost'), 'after'),
  verify('equivalence', algorithm('guide.equivalent'), {
    args: { before: ref('input') }
  }),
  checkpoint('cost.report', 'Arithmetic cost', {
    before: binding('before'), after: binding('after')
  })
));
```

The normalization callback uses the generic IR adapter and rewrite engine:

```ts
const result = await saturate(
  openIR(before, expressionAdapter),
  [expressionCSE, expressionDouble],
  { budget: 32, verify: acceptEdit }
);
```

Strategy scheduling and rewrite scheduling are different levels: the strategy
invokes one normalization algorithm; that algorithm schedules individual
matches and edits. `acceptEdit` checks each candidate before publication. Section
6 explains this boundary.

The example inserts a revision checkpoint with `insertAfter`, verifies the old
plan remains unchanged, serializes/deserializes the edited plan, and executes
it. Its assertions establish these results:

| Measurement | Verified result |
| --- | --- |
| Plan nodes before / after editing | 6 / 7 |
| Arithmetic operations before / after normalization | 5 / 4 |
| Applied rewrites / accepted edit contracts | 3 / 3 |
| Repeated analysis query | Same valid analysis record reused |
| Invalid follow-up edit | Rejected as `postcondition`; original revision retained |

The expression checker compares canonical polynomials with safe-integer
coefficients and records numerical samples. This is the declared semantics of
the example; it is not a claim that arbitrary floating-point expressions permit
the same algebraic substitutions.

Implementation references: `src/strategy/builders.ts`, `ir.ts`, `registry.ts`,
`validation.ts`, `editing.ts`, `serialization.ts`, and `interpreter.ts`.

## 6. Specifying semantic contracts

A transformation's type says what shape it consumes and produces. Its semantic
contract says **when it is applicable and what must be established before its
result is accepted**. Valid syntax alone does not establish geometric fidelity,
equivalent equations, or preservation of expression meaning.

The semantic module is independent of Strategy IR and generic IR storage.
Import it from `src/contracts/index.ts`. A strategy can call it directly; a
compiler can attach it to pass acceptance; an IR edit can defer publication until
it approves a candidate. Each integration uses the same definitions and evidence.

### 6.1 The eight definition APIs

Every definition has an `id`, `version`, and `description`. Factories freeze
definitions; callbacks remain explicitly supplied application code.

| Definition | Purpose and essential fields |
| --- | --- |
| `defineIR<T>` | An artifact kind/schema, with `validate(value)` |
| `defineType<T>` | A scalar or finite-data port type, with a runtime validator |
| `defineAnalysis<S,R>` | A computation with IR `input`, scalar `output`, `run`, optional effects and transfer rule |
| `defineProperty<S>` | A proposition about one `subject` IR, backed by a checking analysis |

| Definition | Purpose and essential fields |
| --- | --- |
| `defineInvariant<P>` | A relation over named typed `inputs`, implemented by `check` |
| `defineObjective<S>` | A numerical analysis and direction `min` or `max` |
| `defineEffect<T>` | Exact resource access: `resource`, `access`, and scalar `type` |
| `defineTransformation<I,O>` | Named ports, obligations, effects, cache policy, correspondence, and optional `run` |

An IR port receives an `Artifact<T>`; a scalar port receives `T` directly.
`PortValues<P>` captures that distinction in TypeScript, while runtime validation
also rejects missing or unexpected port names. Built-in scalar definitions
include `Integer`, `FiniteNumber`, `JsonValue`, and `Check`. The last represents
`{ok: boolean, reason?, evidence?}`.

`createArtifact(ir, id, value)` validates, copies, freezes, and hashes a value.
`validateArtifact(ir, artifact)` checks its kind/schema, payload, and hashes.
Supplying the expected kind next to changed data and an old revision is not
sufficient to pass validation.

`ContractRegistry.register` recursively registers referenced definitions.
Re-registering the same definition object is harmless; redefining its exact
ID/version with another object is rejected. `get`, `has`, and `list` provide
lookup and finite descriptors. `AnalysisManager` registers definitions as they
are used, so manual registration is optional for ordinary calls.

### 6.2 Named ports and transformation obligations

The included expression contract consumes `{input: ExpressionIR}` and produces
`{output: ExpressionIR}`. It requires a valid source, preserves validity, checks
the relation between old and new expressions, and requires an entity map. Its
important clauses are:

```ts
requires: [{
  property: expressionValid,
  subject: { from: 'inputs', port: 'input' }
}],
preserves: [{
  property: expressionValid,
  from: 'input', to: 'output', mode: 'check'
}],
ensures: [{
  invariant: expressionEquivalent,
  bindings: {
    before: { from: 'inputs', port: 'input' },
    after: { from: 'outputs', port: 'output' }
  }
}],
correspondence: [{
  id: 'entities', from: 'input', to: 'output',
  relation: 'generic-ir-edit'
}]
```

This is a declaration excerpt from `src/ir-examples/contracts.ts`, not a separate
program. The checker implementations in that file give the clauses their
meaning.

| Clause | What the manager does |
| --- | --- |
| `requires` | Check inputs when the semantic transaction begins; `execute` does this before its body. |
| `ensures` | Check output properties or input/output invariants before acceptance. |
| `establishes` | Check and record a newly established guarantee, with its own evidence phase. |
| `preserves` | Check the source property, then recheck or authorize transfer to a named output. |
| `correspondence` | Require named mappings with exact input/output revisions and any required relation. |
| `effects` | Authorize declared access through the resource port. |
| `cache` | Choose `pure`, `tracked`, or `never` body reuse policy. |

`ensures` and `establishes` both run real checks; their distinction expresses the
contract author's intent and remains visible in evidence. Neither creates a
true fact by assertion. `preserves` with `mode: 'check'` evaluates the target
property. With `mode: 'transfer'`, it requires a named correspondence and an
executable transfer verifier on the analysis definition.

A condition either applies a property to `{from, port}` or binds every named
invariant input to such a selector. Factories reject incompatible port kinds or
versions, missing invariant bindings, and preconditions that reference outputs.
For a relation such as “error from the original mesh is within tolerance,” use
an invariant binding both artifacts and the scalar tolerance.

### 6.3 Analysis, properties, and objectives

Create `new AnalysisManager(registry?, resourcePort?)` for a compilation session
or another deliberate lifetime. It owns reusable analysis results, facts,
executions, and evidence; it does not mutate an artifact's payload.

| Query | Result |
| --- | --- |
| `analyse(definition, artifact, params?)` | `AnalysisRecord<R>` with value, exact subject, dependencies, and validity |
| `hasAnalysis(definition, artifact, params?)` | Whether reusable evidence currently exists |
| `check(property, artifact)` | A `PropertyFact`, including a recorded false result |
| `checkInvariant(definition, namedInputs)` | Checked relational evidence |
| `evaluateObjective(objective, artifact)` | Numerical value, direction, and supporting analysis record |
| `properties(artifact)` | Revision-specific facts with current validity |
| `explainProperty(property, artifact)` | Availability, checker identity, evidence, and invalidation explanation |

A false `check` result is inspectable information. A contract requirement or
`ctx.require(property, artifact)` turns failure to establish a needed property
into rejection. Analysis parameters participate in identity; omitted parameters
default to `null`.

Inside a checker or body, `ContractContext.analysis` returns the typed **value**;
the manager's `analyse` returns the **record**. The context also provides `check`,
`require`, `checkInvariant`, `properties`, `explainProperty`, `readResource`,
`writeResource`, and `record`. Context calls track dependencies automatically.
Await asynchronous calls; escaping a context or starting work that finishes
after its owner closes is not a supported lifetime model.

An objective definition does not choose an optimization candidate. Its numerical
analysis supplies a measurement. A Strategy IR `metrics` callback can call
`evaluateObjective`, then expose that number under the metric name used by
`chooseBest`. This bridge keeps semantic measurement independent of search
policy.

### 6.4 Evidence, invalidation, and checked transfer

Evidence belongs to exact artifact IDs/revisions, kind/schema versions, and
definition versions. Analysis reuse also depends on parameters, transitive
analysis/property records, resource revisions, and invalidation epochs. A
matching payload alone does not authorize copying arbitrary facts between
different subjects.

| Assurance | Meaning |
| --- | --- |
| `declared` | An assertion was recorded; it cannot satisfy a requirement. |
| `checked` | The registered checker ran, or its still-valid exact evidence was reused. |
| `transferred` | A registered transfer verifier authorized an existing result for another revision. |
| `proof` | A property-specific external certificate verifier accepted supplied evidence. |

`declare(property, artifact, reason)` deliberately records unverified evidence;
it is not a way to bypass a checker. `recordProof(property, artifact, certificate)`
requires the property's `proofVerifier`. The framework records that external
trust boundary and contains no theorem prover.

`invalidate(analysisOrProperty, artifact, reason?)` advances an epoch and makes
dependent evidence unavailable. Invalidation also prevents a computation that
was already in flight from publishing a stale result. `snapshot()` returns
immutable manifests, histories, executions, and events with validity evaluated
at snapshot time.

To reuse a result across changed representations, first obtain a valid source
analysis, then call `preserve(analysis, from, to, correspondence, params?)`.
The analysis must define `transfer: {id, version, verify}`. Its verifier receives
the two artifacts, source record, and mapping; it must justify preserving the
**analysis value**, not merely observe that some entities have matching IDs.
Transferred evidence depends on the source record and the verifier's own
dependencies. Source invalidation therefore invalidates the transfer too.

Semantic correspondence uses `{id, from, to, relation, entities?, evidence}`.
The generic IR correspondence layer additionally provides total entity
universes, composition, inversion, and tracing. The guide's bridge converts that
structural mapping into a semantic correspondence; the polynomial invariant
separately checks meaning. Mapping data is not semantic proof.

### 6.5 Computational caching and semantic rechecking

`manager.execute(definition, inputs, options?)` runs a transformation's optional
`run(ctx, inputs)` body, which returns `{outputs, correspondence?}`. It can reuse
a cached body, then verifies current obligations. The default accepts the result
before returning. `cache: 'pure'` forbids declared resource effects;
`tracked` permits declared reads; writes require `never`.

Body dependencies and guarantee dependencies serve different purposes. If a
profile read changed the computed geometry, the body must run again. If only a
postcondition's permitted bound changed, the old geometry may be computationally
reusable but fail today's acceptance check. `execution.bodyDependencies` and
`bodyCacheable` expose this distinction.

An external compiler should check `manager.canReuseDependencies` and import a
reused body's complete manifest through `transaction.importBodyDependencies`.
Importing it retains resource permissions, revision stamps, and dependency links
for subsequent warm runs. The supplied pass integration does this at the
compiler's acceptance boundary; a cache hit never skips current contracts.

Fact-set introspection can depend on missing information as well as present
facts. Computations using `properties` or `explainProperty` conservatively
disable caching where that absence cannot be represented by ordinary dependency
edges. This prevents an apparently unchanged dependency list from hiding a
newly established fact.

### 6.6 Revisioned effects and atomic staged writes

An effect names one resource, access mode, and value type. The runnable guide
constructs an in-memory port and an exact read capability:

```ts
const resources = new MemoryResources({
  'guide:factor': 2, 'guide:accepted': 0
});
const effectManager = new AnalysisManager(undefined, resources);
const readFactor = defineEffect({
  id: 'guide.factor.read', version: '1', description: 'Scaling factor',
  resource: 'guide:factor', access: 'read', type: Integer
});
```

Its resource-driven scaling transformation declares that effect and
`cache: 'tracked'`. Repeating the same request reuses its body. Changing the
factor from 2 to 3 changes the resource revision, forces recomputation, and
produces a different output revision. These are asserted results in the guide
program, not simulated cache counters.

Permissions are checked transitively: calling a read-capable analysis does not
grant its enclosing transformation undeclared resource access. Cached analysis
reuse checks permissions too. Analyses and invariants may read but cannot
declare write effects.

Writes through `ctx.writeResource` are staged. Later reads in the transaction
see them; preconditions inspect the original state and postconditions can
inspect the staged state. Commit checks original physical revisions and applies
all writes atomically. In the guide, a rejected negative result leaves an export
counter at zero; the next accepted result increments it to one.

`ResourcePort` requires synchronous reads and an atomic synchronous
`commit(writes, expectedRevisions)`. `MemoryResources` supplies `read`, `set`,
`commit`, and `snapshot`. A custom host must provide the promised atomicity;
returning a Promise from commit is rejected. These capabilities govern the
explicit resource port. They cannot sandbox arbitrary callback code that writes
files or changes global state outside that port.

### 6.7 Coordinating semantic acceptance with IR publication

For an existing algorithm, begin a semantic transaction before exposing its
result. `beginTransformation(contract, inputs, options?)` checks requirements
and returns `inputs`, `context`, `execution`, `verify`, `rollback`, `fail`,
`settle`, and `importBodyDependencies`.

`await transaction.verify(outputs, correspondences?, {cached?})` validates the
candidate and returns a prepared object with `outputs`, `execution`, synchronous
`commit()`, `rollback(reason?)`, and `fail(error)`. Verification seals the body
context. Output facts and resource writes remain provisional until commit.

The guide passes prepared acceptance directly to the IR transaction:

```ts
async function acceptEdit(
  result: TransformationResult<ExpressionProgram>,
  before: Artifact<ExpressionProgram>
): Promise<EditAcceptance> {
  const transaction = await manager.beginTransformation(
    expressionContract, { input: before }
  );
  return transaction.verify(
    { output: result.artifact }, [correspondence(result)]
  );
}
```

The generic edit engine validates the native result, checks its exact base
revision, invokes this gate, and commits acceptance at its final publication
boundary. The helper must return the prepared object; calling a convenience
method that already commits would move semantic acceptance ahead of IR
publication.

This edit hook runs after candidate construction: it gates publication, not the
work already spent building a private draft. If a precondition must prevent an
expensive or effectful kernel from starting, begin the semantic transaction
before that kernel and return its prepared acceptance afterward. The compiler
pass integration uses such a pre-body policy hook. An already computed result
can be rejected, but its computation cannot be retroactively prevented.

`verifyTransformation(before, after, contract, correspondence?, options?)`
checks an already computed result and commits by default. Both it and `execute`
support `deferCommit: true`. In that mode the caller owns final acceptance;
the current `execute` implementation does not automatically populate its body
cache when the caller later commits the deferred object.

On failure, `rollback` discards provisional state; `fail` preserves the original
classification; `settle()` drains started semantic work for an asynchronous host
failure path. Discarded analysis/fact records remain in history as invalid
evidence. They cannot authorize later reuse. A successfully accepted transaction
cannot subsequently be relabelled failed or rolled back.

The guide deliberately changes an introduced multiplier from 2 to 3. Native
structure still validates, but polynomial equivalence fails. The edit reports
`postcondition`, retains the prior revision and multiplier, and leaves a rejected
semantic execution available for inspection.

### 6.8 Debugging across the boundaries

Follow identities and evidence in this order:

1. Find the strategy node and its execution status. Check which branch ran,
   which candidate won, and whether failure was expected rejection or a bug.
2. Follow its invocation link. Distinguish the original computation from a warm
   cache hit; inspect the dependency manifest and exact output revision.
3. Read the semantic execution's phases, definitions, subject revisions,
   assurance, and checker evidence. A declared claim is insufficient.
4. For a rewrite, inspect the pattern bindings, guard decision, transaction
   diff, and correspondence. A provisional candidate may be inspectable even
   though it was never committed.
5. If evidence was reused, follow its analysis/property/resource dependencies
   and invalidation reason. Fix the responsible definition or dependency;
   weakening a contract would change the accepted semantics.

Implementation references: `src/contracts/types.ts`, `definitions.ts`,
`registry.ts`, `analysis-manager.ts`, and `effects.ts`; the complete tested
composition is `src/guide/03-strategy-contracts.ts`.

## 7. Understand execution, caches and explanations

The incremental runtime is deliberately smaller than the languages built on top of it. It accepts registered representation kinds and passes, runs tasks against immutable input snapshots, and records what each invocation observed. It does not decide which mesh simplification is desirable or which equation rewrite is valid. Strategies and semantic policies make those decisions through explicit ports.

### 7.1 The smallest useful compiler

`src/guide/01-runtime.ts` registers a scalar kind, a pass that reads one source key, and a pass that adds two required artifacts. The core pattern is small:

```ts
const left = task('guide/left', 'guide.read', {
  key: 'guide.left'
});
const right = task('guide/right', 'guide.read', {
  key: 'guide.right'
});
const sum = task('guide/sum', 'guide.add', { left, right });

compiler.setInputs({ 'guide.left': 3, 'guide.right': 4 });
const cold = await compiler.run('Cold sum', run =>
  run.require<Scalar>(sum)
);
const warm = await compiler.run('Warm sum', run =>
  run.require<Scalar>(sum)
);
```

The pass registration supplies a version and output kind. The task supplies a logical ID, the pass ID, and finite serializable parameters. Keeping these separate allows the same registered algorithm to execute at many logical tasks. The same logical task cannot acquire two conflicting parameterizations inside one run.

`Compiler.run` returns both the callback's value and the completed `CompilationRun`. If the callback returns an artifact, the result's `value` is that artifact, whose own `value` contains the native payload. Keeping the run object is useful: it scopes queries to exactly the compilation you are debugging.

The runtime captures source input state and registrations for each run. A pass reads source data with `context.read(key)` and requests other tasks with `await context.require(task)`. These calls become dependency records. Reading an unrelated global variable instead creates a hidden dependency that the cache cannot discover. Trusted pass implementations must make their relevant inputs explicit.

### 7.2 Why a cache entry is reusable

The cache records the task request, algorithm version, output kind/schema, actual input reads, required tasks and their output revisions, plus replayable algorithm observations. Reuse checks those dimensions rather than assuming that a task name identifies a timeless value. A pass version change, changed parameter, changed read input or changed required artifact can each explain a miss.

A required task may need to run before the parent can decide whether its cached result is still usable. If the child recomputes but produces the same native revision, a parent that depends only on that revision can still reuse its result. Conversely, a visually similar model with different native content is a different revision. The cache follows declared observations, not visual similarity or semantic guesses.

In the scalar tutorial, the unchanged second run reuses all three tasks. Changing only `guide.left` causes its source pass and the addition to execute. The right source task stays cached. The final native value changes from `7` to `14`. The printed explanation includes the dependency responsible for the addition's miss, and the run comparison shows which task outputs actually changed.

The cache is process-local and bounded by the compiler's configured entry limit. Eviction is a supported explanation for recomputation. Replaying a full trace also requires a cache entry that retained a full trace; a summary-only entry cannot invent missing checkpoints. Cache-disabled runs and noncacheable passes are distinguished from cache misses.

### 7.3 Reuse and acceptance are separate decisions

An artifact can be reusable as a computation and unacceptable under a current condition. The semantic pass-policy boundary handles this distinction. The policy runs around both fresh execution and output reuse. Its `before` hook prepares input checks; `reuse` may reject a candidate cache entry when an extension's computation dependencies changed; `after` checks a provisional output; `committed` synchronously accepts staged policy state before the artifact becomes visible; `failed` performs cleanup and retains failure evidence.

The distinction between `reuse` and `after` matters. If the body used a resource whose revision changed, the old computation is stale and should be recomputed. If a current acceptance threshold changed, the old geometry may still be reusable but fail its present acceptance check. Merely putting every resource read into a general cache key obscures this difference.

The earlier contract lab includes both cases. Its live volume limit can reject cached geometry without rerunning the geometry algorithm. Its resource-derived geometry uses a resource value in the algorithm body; changing that value forces recomputation. A transformation with a write effect is explicitly noncacheable, because reusing its output would not perform the newly requested write.

The four v6 labs also apply semantic acceptance at two useful boundaries. Each generic edit is verified before its local revision is committed. The outer compiler pass validates the artifact it publishes under its own task ID. On a warm run, no new edit trace is fabricated: the actual earlier edits stay attached to their originating invocation, while the current pass has new acceptance records. Analyses used by those checks may themselves be reused when their exact dependencies still match.

### 7.4 A practical debugging sequence

Suppose you ask, "Which object was cached when we optimized for this error bound, and why?" Begin with the selected output and the exact run. Inspect its strategy choice to identify the actual candidate and objective/constraint values. Follow the linked task to the compiler invocation. Read its cache status, origin invocation and dependency changes. Then inspect the semantic checks that accepted it for this run.

If the question concerns a particular entity, switch from artifact-level execution to entity-level correspondence. Select the definition, face or equation in the exact revision and trace its origins. Open the rule and matcher evidence that created, merged or removed it. Finally inspect the native before/after values and the actual operation log. This connects intent, execution and structural consequence without inferring one from another.

The same sequence is available programmatically:

```ts
const explanation = changed.run.why('guide/sum');
const cache = changed.run.explainCache('guide/sum');
const dependencies = changed.run.dependencies('guide/sum');
const comparison = changed.run.compare(warm.run);
```

These query methods read captured records. They do not execute passes or recompute a semantic check while you are looking at history. A question that needs a new analysis should call the analysis manager explicitly and record the resulting evidence separately.

### 7.5 Runtime API reference

The public protocol is defined in `src/core/types.ts`, execution in `runtime.ts`, records in `records.ts`, and inspection in `query.ts`. The following signatures use `T` for a native value and `P` for finite task parameters.

| API | Purpose and important behavior |
| --- | --- |
| `task(id, pass, params)` | Construct a task request; the run checks consistent logical task identity |
| `new Compiler({maxCacheEntries?})` | Create registrations, retained artifacts, run history and bounded computation cache |
| `registerKind(kind)` | Register a versioned native schema with validator and optional description/structure |
| `register(pass)` | Register a versioned pass with output kind, role, cache policy and implementation |
| `replacePass(pass)` | Replace a registered algorithm using the versioning rules; do not silently redefine an old version |
| `setInput(key,value)`, `setInputs(record)` | Capture finite source data for subsequent runs |
| `getInputs()` | Read an immutable source-state snapshot |
| `run(label,action,options?)` | Run and finish an async compilation callback, returning its value and run |
| `beginRun(label,options?)` | Obtain an explicitly managed run; the caller must finish it correctly |
| `evict(taskId?)` | Remove computation cache entries for a task or the whole cache |
| `snapshot()` | Capture portable runs, registrations, artifacts, invocations and derivations |
| `artifact(ref)`, `passDescriptors()` | Retrieve retained exact artifacts and registered algorithm metadata |

Run options include `cache` and trace level `summary` or `full`. A full trace retains checkpoints; both modes retain the execution/dependency information required by the runtime. `CompilationRun.require<T>(task)` requests a root or dependency and returns an artifact. Repeated compatible requests in a run share the pending/completed work. Cyclic task dependencies fail explicitly.

| Run or pass API | Purpose |
| --- | --- |
| `run.id`, `run.record` | Exact run identity and captured status |
| `run.require<T>(task)` | Resolve a task within this run's immutable snapshot |
| `run.artifact(refOrTaskId)` | Retrieve an artifact actually available in this run |
| `run.invocation(taskId)` | Inspect that task's recorded invocation in this run |
| `run.recordExtension(namespace, value)` | Attach one finite execution-layer record before run closure |
| `run.finish()`, `run.finishAsync()` | Close an explicitly managed run; async closure drains outstanding work |
| `context.read<T>(key)` | Read and record a source dependency |
| `context.require<T>(task)` | Request and record a task dependency; await every request |
| `context.decision(record)`, `diagnostic(record)` | Record algorithm choices or diagnostics with finite evidence |
| `context.metric(name, value, unit?)` | Record a finite numeric metric |
| `context.checkpoint(label, data)` | Retain detailed intermediate evidence in full-trace mode |
| `context.derive(source, mapping?)` | Record provenance from a previously required artifact |

Pass and policy contexts have bounded lifetimes. Holding a context and using it after its callback returns is rejected. Returning while required tasks are still outstanding is also rejected and drained. A failed required task remains a failed invocation even if surrounding JavaScript catches the exception; a compiler run cannot quietly turn that history into a clean successful run. Expected optimization rejection belongs in the strategy or rewrite rejection protocol.

`setPassPolicy(passId, policy)` and `removePassPolicy(passId)` attach acceptance behavior outside active runs. A policy has an exact ID/version and optional `before`, `reuse`, `after`, `committed`, `failed` hooks and cache override. Its observations are separate from replayable algorithm observations. `committed` is synchronous because it lies inside the publication boundary.

### 7.6 Query API reference

`compiler.query` reads all captured history. `run.query` reads the same portable record model with a run filter. `new Queries(snapshot, runId?)` can inspect an exported snapshot without a running compiler.

| Query | What it returns |
| --- | --- |
| `invocations(target?)` | Matching invocations, optionally for an artifact/reference/task ID |
| `artifact(target)` | The matching exact artifact when retained |
| `why(target)` | Invocation, origin invocation, source inputs, derivations and ancestral decisions |
| `explainCache(target)` | Cache status, reason, dependency changes, key and origin identity |
| `history(target)` | All invocations of the logical task across captured runs |
| `alternatives(target)` | Recorded alternative-selection decisions in its requested ancestry |
| `dependencies(target)` | Actual input/task dependencies of its invocation ancestry |
| `sourceInputs(target)` | Recorded source reads supporting that ancestry |
| `lineage(entityRef)` | Backward runtime derivation edges for an exact entity/reference |
| `compare(beforeRun,afterRun)` | Source changes, task changes, execution statuses and cache explanations |
| `diff(before,after)` | Native data differences at stable JSON-style paths |

There are intentionally two levels of diff and dependency API. `Queries.diff` compares retained native payloads; `ir.diff` compares adapter-projected entities, relationships and roots. `Queries.dependencies` follows computed-value dependencies; `IRView.dependencies` follows semantic edges inside one representation. Choose the one that answers your question.

The older runtime provenance API represents edges and whole-artifact relationships. The generic layer's correspondence is a total relation with explicit insertion/removal witnesses and grouped Cartesian meaning. The v6 composition root expands real source-target pairs when bridging to runtime edges; it retains empty-endpoint witnesses in the complete correspondence evidence. Treating an empty list as a wildcard ancestor would lose the distinction between deletion and derivation.

### 7.7 Failure evidence is part of the result

A failed compilation is still useful evidence. Invocation records retain error diagnostics and failed task requests; Strategy IR retains the branch or node that failed; the semantic manager retains failed or rejected verification without authorizing those facts; rewrite traces can retain a provisional candidate without publishing it.

The important question is which boundary accepted a value. A prepared edit is not a retained revision. A checked candidate is not necessarily the selected alternative. A selected artifact has not necessarily passed a later export policy. A fact recorded as a declaration has not become a dynamically checked or externally verified fact. The workbench keeps these statuses explicit so a failure does not make a previous successful result look like the new result.

## 8. Use the workbench as a compiler debugger

Open `output/source-workbench.html`. The delivered file starts in **IR manipulation lab**. It contains the compiled compiler, the original TypeScript evaluator, the source catalog and the UI; the application makes no network request. The existing seven source, strategy and contract examples remain accessible from the main navigation.

### Four useful starting points

| Domain | What to inspect first |
| --- | --- |
| Symbolic expressions | The CSE step merges two multiplication nodes. Follow its redirected operand and correspondence; then inspect the repeated-operand pattern used by the algebraic rules. |
| Scene sharing | Select the definition-sharing step, select the removed definition, and see the retained definition and unchanged named instance bindings. |
| Mesh alternatives | Compare the original and reduced candidates. Set the error bound to `0.1`, rerun, and inspect the strategy decision that keeps the original eight triangles. |
| Constraint systems | Inspect a sparse equation's dependency edges, the scaled duplicate removal, and the subsequent change from one dense solve to two component solves. |

The transformation sidebar is compact. The right-hand detail view is scoped to the selected step. Revision tiles above it are separate recorded edges; two mesh candidates can share the same input. A displayed uncommitted candidate is explicitly labelled and is never substituted for the accepted output.

### Find the actual code

**Example & compiler code** opens the real source embedded by the build. The domain module contains the authored native example, schema validator, adapter and domain algorithms. `src/ir-examples/rules.ts` defines the transformations; `lab.ts` builds the Strategy IR, registers compiler passes and attaches semantic gates. `contracts.ts` defines the checks.

The source browser also includes the generic matcher, scheduler, edit transaction, correspondence utilities, semantic manager, strategy interpreter, compiler runtime and tests. A selected rewrite's **Implementation** tab navigates to its indexed literal definition where one exists. Dynamically constructed definitions fall back to their containing source file rather than inventing a line location.

The v6 native input editor is distinct from this source browser: it edits data consumed by compiled TypeScript. The original five model-program editors still support editable TypeScript source. To change a v6 adapter or rule implementation, edit its source file in the downloaded workspace and rebuild.

### Explore entities and typed relationships

Select an entity in either revision's graph or entity list. The opposite revision highlights only entities connected through the recorded correspondence. A merge may select several origins; a split may select several descendants. Deleted entities can have no descendant. Entity IDs are qualified by the artifact ID and content revision.

The graph preview is bounded and labels its display cap. The entity list and queries remain available for the complete representation. Containment, binding and dependency edges have separate meanings; a query does not silently treat them as interchangeable.

**Query** runs the real adapter-backed API on the selected exact before or after revision. Available operations include walk, children, parents, ancestors, typed successors/predecessors, dependencies, subgraph, find and resolve. Choose the appropriate relationship, traversal order, transitive mode or entity filter. Budget exhaustion is an error indicating an incomplete query, not an apparently successful truncated answer.

**Pattern & match** displays the rule's declarative pattern, recorded matches and matching evidence. Edit highlighted YAML and run it against the selected revision. The same versioned domain predicate registry used by the compiler is supplied for domain-specific conditions. Unknown predicates, malformed patterns and missing capabilities fail explicitly. Captures refer to entity identity; `equalContent` is a shallow structural comparison, and stronger domain equality uses a registered predicate.

### Inspect revisions, changes and origins

**Changes & origin** shows inserted, removed and updated entities and edges, the operation log, correspondence groups and diagnostics. These records come from actual validated transactions. A replacement that failed, exhausted a budget or would close a rewrite cycle can retain its candidate for diagnosis; that status is displayed separately from committed edits.

Lineage inspection follows exact recorded revision edges. Choose a source revision, entity and target revision. Forward tracing answers where it went; inverse tracing answers where it came from. Mesh alternatives remain branches. The route selector uses a bounded recorded path and reports the chosen path, rather than treating every retained correspondence as one linear history.

**Native IR** shows the underlying representation as highlighted YAML. Expression arenas, scene tables, packed mesh coordinates and sparse equation coefficients keep different native formats. The logical entity graph is an inspection/edit projection, not a replacement storage model.

### Follow compiler execution and cache reuse

**Compiler passes** opens the original compact invocation sidebar and right-hand details, including cache reasons, observations, provenance, actual pass source and semantic contracts. **Strategy trace** shows the planned nodes, actual dynamic records, candidate metrics, selection evidence and links to invocations.

Enable **Run twice for cache** and compile. The second run reuses eligible native compiler outputs while the semantic policy runs fresh checks. Actual edit traces continue to identify the original invocation that performed the work; they are not fabricated again for the cached run. Following an edit to its compiler invocation opens that originating run. The final compiler result links to the selected run's invocation.

For each mesh candidate, distinguish its construction contract's supported geometric scope and bound from the user's selection threshold. The strategy chooses the smallest feasible candidate under the user threshold. At `0.35`, the default four-triangle candidate is feasible; at `0.1`, it is retained for inspection but excluded from selection.

### Edit and preserve work

**Edit native input** offers highlighted YAML for the selected domain. Each domain retains its own draft. **Compile edited input** captures the exact text, validates the native schema, runs the pipeline and creates a new immutable history entry. Rejected input shows an error and clears the active result view; a previous success remains accessible through history.

**Restore example input** restores the built-in native example. **Restore selected run input** restores the source and controls of a retained successful run. Export the lab trace as YAML to retain source artifacts, adapter descriptions, strategy and compiler records, semantic checks, matching evidence and changes. The workbench's source browser exports source text where supported; the complete workspace includes all source independently.

Browser drafts and caches are in memory and restart when the file reloads. Export work before closing the page. Rebuilding from the workspace uses `npm run build:source`; reproducing all evidence uses `npm run verify:release`.

### Verification boundary

The automated UI tests exercise the real examples, real matching/query APIs, source bytes, selection correspondence, history, invalid input, warm runs and lineage navigation using explicit DOM/Canvas/Worker doubles. The optional `scripts/check-ir-browser.py` covers a real browser environment when available. It was not run successfully in the restricted authoring environment, so rendered desktop/mobile layout and browser compatibility remain unverified here.

## 9. Add a representation and build your own compiler

Start with a representation's meaning and native data, then implement the capabilities its algorithms need. The framework does not impose the examples' expression, mesh or scene layouts.

### 9.1 A complete small adapter

`src/guide/05-custom-adapter.ts` introduces a native sphere catalog. Its payload is a keyed table of radii, not a generic graph. The validator accepts finite positive radii and rejects unsupported fields. Each sphere becomes a logical `guide.sphere` entity; this representation has no relationships.

```ts
interface SphereSet {
  spheres: Record<string, { radius: number }>;
}

const before = createIRArtifact(sphereAdapter, 'guide/spheres', {
  spheres: { wheel: { radius: 1 }, handle: { radius: 0.25 } }
});
const view = openIR(before, sphereAdapter);
const edit = view.beginEdit();
edit.update('wheel', { radius: 2 });
const result = await edit.commit();
```

The adapter enumerates and resolves entities, describes them, validates native values and rebuilds the native table from a logical draft. This supports navigation, matching, editing, diffs and correspondence. Its descriptor omits serialization, visualization and expression operations; requesting an unsupported optional capability fails explicitly.

The tutorial checks the immutable original radius `1`, the new radius `2`, a large-sphere query, and rejection of a negative-radius edit. These establish structural validity. Increasing a collision proxy's radius generally changes semantics; applications requiring equivalence must attach an appropriate domain contract. A valid edit alone does not establish an optimization.

Run it after building:

```sh
node dist/guide/05-custom-adapter.js
```

### 9.2 Design the logical projection carefully

Choose stable entity IDs that represent the identities you want to follow. Use ordered relation fields when operand or corner order matters. Give relationship kinds precise domain names, then classify them by their structural or semantic role. A triangle corner references a vertex; a scene instance binds to a definition. Neither relationship becomes containment simply because both can be drawn as arrows.

Consider how an edit will round-trip. If a binding's relation ID includes its target, redirecting that target may require changing the relation's identity too. The v6 adapters use source/position-based IDs for ordered operands and bindings so reference redirection preserves an edge's identity. An adapter that reconstructs different IDs or silently discards an edited relationship will fail the transaction's projection check.

Expose the data the generic algorithms need in entity attributes or typed relationships. Do not hide an important transformable property in unrelated mutable state. The native value and its logical projection are immutable snapshots; adapter code is a versioned interpretation of that snapshot. `defineAdapter` accepts plain records with own callbacks. Wrap methods from an existing class explicitly rather than relying on inherited methods that are not part of the captured definition.

A subgraph is an inspection view, not necessarily a valid native artifact. Selecting one triangle may omit the root metadata, boundary or other constraints required by your native validator. Reusing `subgraph` does not require weakening those invariants or teaching the generic engine your whole schema.

### 9.3 Introduce semantics before claiming optimization

Define a native IR type and its runtime validator. Then define the analyses needed to observe it, properties needed for eligibility, and relational invariants needed to compare before and after. Decide which observations are exact within a restricted algebra and which are numerical estimates with explicit tolerances.

For a new geometric lowering, a useful contract might preserve occurrence identity and material assignment while allowing bounded coordinate change. These are separate obligations. A matching entity count does not establish shape preservation; an output that validates structurally does not establish a geometric error bound. Express the obligations in the contract and retain the evidence produced by the actual checks.

Use `requires` for input eligibility, `ensures` for output or relational conditions, and `preserves` for facts that need to remain valid. Where analysis transfer is valuable, implement and version its justification. Start with rechecking when a sound transfer rule is not yet clear. Evidence-free transfer would reduce the cost of a check by discarding the property you wanted to establish.

If a checker is too expensive for a particular input, return an explicit failure or budget diagnostic. The polynomial checker illustrates this: it has finite expansion, degree and coefficient bounds. The mesh checker illustrates another boundary: it verifies the convex planar fan assumptions required by its error calculation. These checks make the abstraction useful because the successful result has a defined interpretation.

### 9.4 Keep the compilation strategy replaceable

Register transformations and analyses as versioned algorithms, then construct a strategy from their references. Put candidate generation, objective evaluation and selection in different operations when you want to experiment with the policy. The mesh lab can change the selection threshold while retaining inspectable candidates because those responsibilities are distinct.

An algorithm callback is executable TypeScript; a strategy plan is finite data referring to callbacks through a registry. Serialize and inspect the plan, pin its referenced versions, validate it, then execute it. Use the existing plan editing APIs to insert verification, replace one alternative or remove a branch. If a branch is removed, later selection must operate on the candidates actually evaluated in that execution rather than resurrecting a remembered result.

Local rewriting has its own scheduling choices. Use a single sweep when you want to touch a known frontier once; use normalization when newly created matches should be revisited. Select the intended relation hierarchy explicitly when containment is not the operand graph. Keep a changing-candidate budget and inspect `budget` or `cycle` as distinct outcomes from convergence.

### 9.5 Wire the runtime at a composition root

A domain module should export validators, algorithms and registration functions through narrow ports. It should not import a particular workbench or ask a global compiler for hidden state. The composition root owns the decision to register domain passes, attach semantic policies, construct tasks and bridge Strategy IR algorithms to runtime requests.

The current source compiler does this in `src/pipelines/project.ts`. It connects CAD, scene and mechanism pipelines through explicit import adapters. The v6 labs do it in `src/ir-examples/lab.ts`. Those are deliberately application-specific modules: they know which layer to call and which exact artifact or task identity to use. The generic packages remain independently reusable.

The module boundaries are enforced by ordinary explicit imports rather than a plugin installation system. When extracting a package, copy its small protocol dependencies or preserve them as a shared core package. The IR package needs the core artifact/data protocol; it does not need domain checkers, Strategy IR or a browser. The contracts package needs typed artifact data and a resource interface; it does not need this workbench. The strategy interpreter needs registered algorithms, not a particular mesh type.

### 9.6 Preserve evidence as a design feature

For every transformation, retain enough information to answer a concrete question: what was matched, which guard passed, what was changed, which checker accepted it, and what origin relation connects the exact revisions? If a record cannot answer any useful question, it may be noise. If the answer depends on recomputing against today's source, it is not reliable historical evidence.

Keep input/output snapshots, finite rule and plan descriptors, algorithm versions, correspondence, objective values and dependency manifests. Distinguish a current run's policy evidence from observations replayed with a cached computation. The supplied workbench follows recorded links instead of reconstructing a plausible history from the final model.

The framework uses immutable finite JSON data for these records. Functions, accessors, sparse arrays, cycles and nonfinite numbers are rejected at the persistence boundary. Trusted executable implementations live in versioned registries and source files, not inside serialized strategies or artifacts. That separation also makes the evidence suitable for exported YAML and standalone HTML inspection.

### 9.7 Choose the right scope for further engineering

The existing store and caches are in memory. They provide exact revision history and local atomic publication; they do not provide crash recovery or distributed commit. Exported traces preserve evidence, while restoring a live compiler session would need a defined persistence protocol for registries, resources and versioned dependencies.

The logical graph projection is intentionally simple and finite. Large meshes or millions of entities may need indexed queries, streaming descriptions or specialized edit backends. A visualization preview is bounded separately from a query: its labelled display cap does not imply that a query can silently truncate its result. Keep those interfaces distinct when scaling the implementation.

The semantic effect interface governs accesses made through that interface. It does not sandbox arbitrary JavaScript or detect all external activity in a callback. Read-only and mutation-only capabilities prevent accidental misuse of the supplied view or draft; trusted code can still hold unrelated references. Deploying untrusted compiler plugins requires an additional execution boundary, outside this project's scope.

Add persistence, scale or isolation guarantees when applications need them, preserving existing operation semantics.

## 10. Reference map, troubleshooting and terminology

### 10.1 Where to look first

| Need | Authoritative source or artifact |
| --- | --- |
| Runtime tasks, artifacts and pass policy protocol | `src/core/types.ts` and `src/core/runtime.ts` |
| Cache and history query implementation | `src/core/query.ts` and `src/core/records.ts` |
| Strategy builders, schemas and interpreter | `src/strategy/` |
| Semantic definitions and analysis manager | `src/contracts/` |
| Generic native manipulation API | `src/ir/index.ts` and adjacent modules |
| Four domain implementations and integration | `src/ir-examples/` |
| Original authored example programs | `src/programs/` |
| Current source compiler composition | `src/pipelines/project.ts` |
| Runnable guide examples | `src/guide/` and emitted `dist/guide/` |
| Standalone workbench | `output/source-workbench.html` |
| Reproducible lab and guide evidence | `output/v6-ir-verification.json` and `output/v6-guide-verification.json` |
| Regression evidence and archive inventory | `output/v6-verification.json` and `WORKSPACE-MANIFEST.json` |

`dist/` declarations give full signatures, optional fields and overloads; this guide explains semantics and limits. Consult tests when extending interfaces: failures often clarify guarantees better than successes.

### 10.2 A compact vocabulary

An **artifact** is an immutable native value identified by logical ID, kind, schema and content revision. An adapter exposes stable **entities** within it. A **reference** names an artifact, revision and entity. A **task** requests a versioned pass with explicit parameters; an **invocation** records one execution or reuse in a run.

A **strategy** describes compilation control; a **pass** or registered algorithm performs a computation. A **pattern** selects candidate structure. A **rewrite rule** combines matching, eligibility and edits; its **schedule** chooses matches and order. A **transaction** owns a draft and publication.

A **property** is a proposition about one artifact revision; an **analysis** computes a value or evidence with tracked dependencies. An **invariant** relates typed inputs, including before and after. A **contract** specifies eligibility, output obligations, preservation, effects and correspondence. An **objective** measures preference; feasibility limits selection.

**Correspondence** associates entities across exact revisions, including creation, deletion, splitting and merging; **provenance** explains origins from those records. Neither proves equivalence. **Convergence** means completed search found no eligible changing rewrite under the chosen rules and schedule. **Budget exhaustion** and **cycle detection** do not establish convergence.

An **acceptance gate** checks provisional results before publication. **Declared**, **checked**, **transferred** and externally verified **proof** are distinct assurance labels. The examples use executable checks; the framework has no internal general theorem prover.

### 10.3 Troubleshoot by the boundary that failed

| Symptom | What to inspect |
| --- | --- |
| A query rejects an entity reference | Check artifact ID, revision and entity; do not substitute a current entity with the same local name |
| Native reconstruction is rejected | Compare draft and reconstructed entities/relations; inspect ordered IDs and unsupported attributes |
| An edit is stale | Another commit changed the head generation, even if content later returned to the same hash; start from a current view |
| A rule matches but does not apply | Read guard, no-op, semantic rejection, budget and cycle evidence separately |
| Inner/outer order seems wrong | Check the selected relation hierarchy; flat program containment is different from expression operands |
| A valid candidate is not selected | Read the strategy's objective and feasibility constraints, not only its construction contract |
| A cached output is rejected | Inspect the current acceptance checks and resource revisions; cached computation is not current authorization |
| An analysis unexpectedly recomputes | Check exact input revision, definition version, parameters, invalidation epochs and transitive dependencies |
| A pass is not cached | Inspect disabled/miss status, required task failures, input changes, versions and trace level |
| A failed edit appears in the inspector | Check its candidate status; retained diagnostic evidence does not imply publication |

Preserve unexpected errors and causes. Guards or explicit rejection types express deliberate negative outcomes; programming errors and malformed representations fail execution. This distinction enables fallback without hiding defects.

## 11. Verification, reproducibility and delivery

The guide describes an executable release. The source files, examples and API implementations are the primary references; the checked-in tests and generated evidence state what was actually exercised. A successful test is evidence for its stated case and invariants, not a claim of correctness for every possible domain input.

### 11.1 Release verification

The complete strict TypeScript build and all **371 automated tests** pass. This includes the 269 earlier runtime, strategy, contract, domain and workbench tests, plus 102 new tests for generic manipulation, its domain integrations, the v6 UI and independent review findings. No test is skipped.

| New verification group | Tests | Main risks exercised |
| --- | --- | --- |
| Representation foundation | 22 | Typed navigation, native reconstruction, revision hashes, stale/ABA edits, semantic commit races, diffs and correspondence |
| Patterns and rewriting | 34 | Binding isolation, exact matching, all schedules, relation order, shared budgets, cycles, cancellation and scoped authority |
| Native domain laboratories | 31 | Real transformations, native round trips, checker assumptions, customized input, cache reuse and negative semantic cases |
| V6 workbench integration | 12 | Actual compiler/query/matcher execution, source navigation, history, warm origins, branches and lineage |
| Independent review regressions | 3 | Reentrant cancellation, inherited adapter callback loss, and incorrect wildcard provenance at the runtime bridge |

The reproducible release command also runs the sixteen authored-source scenarios, twenty Strategy IR scenarios, thirty-three semantic-contract scenarios, five IR experiment scenarios and all five guide tutorials. The contract experiment includes deliberate negative cases: twenty-four successful runs and nine expected failures. An expected rejection is recorded as such and checked; it is not silently counted as a successful compilation.

The v6 experiments retain four full warm-run traces and a tighter mesh-bound comparison. The guide tutorials have assertions against their real results, including a changed source input, custom rewrite, rejected algebraic edit, resource invalidation and rollback, customized domain inputs, the authored CAD bracket, and a newly registered adapter.

### 11.2 What the checks establish

The foundation tests exercise transaction lifecycle and competing edits, not just a happy-path graph update. A stale draft is rejected even after the head returns to identical content. A verification callback that awaits cannot publish over a newer head. Reentrant cancellation at the synchronous publication boundary cannot report success and then be ignored. Async acceptance callbacks are rejected by the protocol.

The rewrite tests distinguish a frontier sweep from normalization, verify order using actual expression operand edges, and test that callbacks cannot commit before the scheduler checks its budget. Failed, budget-limited and cycle-closing candidates remain diagnostic evidence without advancing the retained revision. Prior accepted edits remain visible when a later step fails; the entire schedule is not falsely represented as one atomic transaction.

The domain tests check the assumptions needed by their mathematics. Polynomial analysis uses bounded exact integer arithmetic. Mesh eligibility checks global convexity, so a self-crossing star does not pass merely because consecutive turns have the same sign. Constraint solves check finite intermediates and residuals against the original equations. These are targeted guarantees within the declared input families.

The UI tests run the real compilers, adapters, matchers, contracts and correspondence utilities through explicit DOM, Canvas and Worker transport doubles. They verify exact source bytes, query execution, live registered predicates, failed-input behavior, and the difference between a warm cache invocation and the earlier invocation that actually performed a rewrite.

### 11.3 What has not been verified here

The authoring environment did not provide permitted browser execution for this release. The earlier restriction was not retried or bypassed. The optional `scripts/check-ir-browser.py` is included for a browser-capable environment, but rendered desktop/mobile layout, browser compatibility and live Web Worker behavior are not claimed as visually verified for v6. A historical screenshot or browser result from an earlier release is not evidence for this one.

The document itself is generated as a searchable PDF, rendered and visually checked for page layout. That PDF review is separate from running the interactive application in a browser. The document's tables and code remain text, rather than screenshots of source.

These tests also do not establish universal CAD geometry, arbitrary nonlinear physics, unbounded polynomial normalization, formally proved equivalence, persistent crash recovery or distributed effect atomicity. The implementation and this guide describe the supported semantics and the relevant trust boundaries explicitly.

### 11.4 Reproduce and retain the result

Run `npm run verify:release` from the extracted project. It builds the application, runs the regressions and emits the experiment/tutorial records. The release log is `output/v6-release-validation.log`; the compact verification ledger is `output/v6-verification.json`. Each experiment family has its own detailed records under `output/`.

The complete ZIP includes the project source, installed build dependencies, compiled outputs, declarations, tests, scripts, guide sources, final guide and evidence. The package script verifies the archive CRC, exact file set, byte lengths and SHA-256 entries against `WORKSPACE-MANIFEST.json`. The manifest excludes its own digest and reproducible Python bytecode caches.

The standalone HTML is also delivered separately, as are this guide's Markdown and PDF. The chapter sources and PDF generator remain in the workspace so the document can evolve with the code. Earlier published releases remain intact. Browser drafts and live caches are ephemeral; export edited input, plans and traces when you want to retain an interactive session's work.

To rebuild the guide, use Python 3 with the optional packages in `requirements-docs.txt`, then run the two commands below. The renderer uses DejaVu fonts when installed and otherwise falls back to standard PDF fonts. The delivered PDF already embeds its fonts. Neither Python nor these packages are needed to run the compiler or open the delivered HTML.

```sh
python3 scripts/assemble-guide.py
python3 scripts/render-user-guide.py
```
