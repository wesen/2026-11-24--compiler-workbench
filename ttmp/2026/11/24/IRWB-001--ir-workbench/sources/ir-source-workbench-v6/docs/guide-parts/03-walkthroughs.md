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
