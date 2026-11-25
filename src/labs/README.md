# Four native representations exercising layer three

These examples are executable TypeScript programs. They compose the existing
Strategy IR, semantic acceptance manager, compiler invocation database, and the
new generic IR manipulation layer. `runIRLab()` is the same entry point used by
the workbench and by the integration tests; the visible matches, revisions,
contracts, cache explanations, and source files are execution evidence.

## Public entry points

```ts
import {
  IR_LAB_DOMAINS,
  defaultIRLabSource,
  getIRLabAdapter,
  runIRLab,
  planIRLab,
} from './src/ir-examples/index.js';

const result = await runIRLab('meshes', {
  source: defaultIRLabSource('meshes'),
  meshTolerance: 0.35,
  warm: true,
});
```

| API | Behavior |
| --- | --- |
| `IR_LAB_DOMAINS` | Four domain descriptors with actual authored source paths. |
| `defaultIRLabSource(domain)` | A fresh native source value for that domain. |
| `getIRLabAdapter(domain)` | The versioned logical adapter, including validation, reconstruction, serialization, and visualization. |
| `planIRLab(domain, tolerance?, boundaryCount?)` | Serializable Strategy IR, including real mesh alternatives and objective constraints. |
| `runIRLab(domain, options?)` | Execute a complete local compiler and return immutable, serializable evidence. |

`IRLabResult` includes the exact input and selected output artifacts, every
intermediate transaction artifact, both projected graphs, adapter descriptor,
query results, declarative patterns and their match evidence, rewrite steps,
changes, correspondence, semantic checks, compiler database, and Strategy IR
execution. `sourcePaths` points to the actual source files included in the
workbench source catalog.

`warm: true` performs two complete compiler runs using the same compiler and
semantic manager. The second run reuses real cached algorithm outputs and runs
their acceptance policies again. The original rewrite trace retains its original
invocation ID. It is not presented as a transformation that executed a second
time.

## Native storage and adapter boundaries

| Domain | Native representation | Logical relationships | Transformation |
| --- | --- | --- | --- |
| Expressions | A keyed arena of operation records and one output symbol. | Root containment, output binding, ordered operand dependencies. | Common subexpression elimination and `x + x → 2 × x`. |
| Scenes | Separate definition and instance tables. | Scene containment and instance-to-definition bindings. | Merge duplicate definitions and redirect instance references. |
| Meshes | Packed `[id, x, y, z]` vertex tuples, a keyed triangle table, and an ordered contour. | Mesh containment, ordered face-corner dependencies, boundary bindings. | Retain or reduce a convex fan through entity and relationship edits. |
| Constraints | Sparse coefficient maps, variable records, equations, and a solver selector. | System containment and equation-to-variable dependencies carrying coefficients. | Remove scaled duplicate rows and select component-wise solving. |

Adapters translate a logical edit back into the native format. They do not
replace these formats with a universal AST. The generic edit transaction verifies
that reconstruction preserves the complete projected graph; the domain validator
then checks the native representation. Domain semantic contracts make the final
acceptance decision.

Every relationship has a declared category. Reference redirection affects
dependency and binding edges by default. It does not silently redirect root
containment. Relationship IDs for bindings and operand slots remain stable when
their target changes, so changing a reference is recorded as an updated
relationship rather than an unrelated deletion and insertion.

## Expressions

`expressions.ts` owns the arena format, validation, iterative evaluation, exact
polynomial analysis, and adapter. `rules.ts` supplies two generic rewrite rules:

1. Match two distinct entities with equal content. For operation entities, the
   generic matcher includes the operation name and ordered operand IDs. Retain
   the lexicographically first identity, redirect references, remove the
   duplicate, and record a many-to-one correspondence.
2. Match `capture('sum', op('add', capture('term'), sameAs('term')))`. Retain the
   sum identity while replacing its operation with multiplication, create or
   reuse a constant two, and reconnect its ordered operands.

The scheduler saturates these rules within an explicit application budget. The
default program executes three accepted edits: one duplicate square is merged,
and two repeated additions become multiplications. Its polynomial is
`2*x*x + 2*y`, and the displayed sample `x=3, y=4` evaluates to `26`. The number
of operations remains seven because introducing a shared constant offsets the
removed duplicate. The example makes no unsupported claim of an overall
operation-count improvement.

Semantic equivalence is exact polynomial equality over the integer coefficient
subset. Coefficients use `BigInt` during analysis. Input constants and final
reported coefficients must fit safe JavaScript integers. Intermediate
coefficients are bounded to 256 bits; the analyzer allows at most 100,000
coefficient operations, 10,000 terms in a polynomial, and degree 256. Budget
exhaustion is an explicit failure, never a successful partial result. Arena
validation and evaluation use iterative postorder traversal; a 9,000-operation
chain is covered by a regression test.

The contract also records numerical samples. Exact polynomial equality is not
a proof that all IEEE-754 evaluation orders have identical rounding. A test
deliberately distinguishes a polynomial result of two from a rounded numerical
result of one for a large intermediate sum. This example's optimization contract
is symbolic integer-polynomial semantics.

## Scene sharing

`scenes.ts` owns box definitions and independently translated instances. The
generic graph pattern matches distinct definitions with identical shape and
dimension attributes. The rewrite redirects `uses` bindings and removes one
definition. The default scene goes from three definitions to two while retaining
three instances.

The semantic checker expands each named instance into its shape, dimensions,
and translation. These expanded placements must be identical before and after.
Definition identity may change; instance identity and placement may not. Native
table ordering is retained when possible, so a no-op transaction preserves its
native revision. An edited source whose first definition is removed by sharing
is explicitly tested; final queries resolve a surviving definition rather than
using a stale ID.

## Mesh alternatives

`meshes.ts` owns a deliberately bounded geometric model: simple, strictly
convex planar triangle fans around an origin vertex named `center`. Validation
checks the native references. The semantic precondition additionally checks
positive fan orientation, one triangle for each boundary edge, and a global
half-plane condition for every contour edge. The latter rejects self-intersecting
stars that can pass a test based only on local turns. The convexity checker has
an explicit limit of 512 boundary vertices.

The real mesh strategy constructs an unchanged candidate and, when halving is
legal, a reduced candidate. Construction uses generic `remove`, `insert`,
`connect`, `disconnect`, and `correspond` operations. The reduced fan replaces
triangles, removes discarded contour vertices, and records face and vertex
lineage. A five-sided source exposes only its legal unchanged alternative;
labels and candidate counts are derived from the edited source.

Each candidate is checked against a conservative construction allowance derived
from the source radius. Strategy selection then applies the user's tighter
`meshTolerance` constraint and minimizes the semantic triangle-count objective.
This distinction lets the compiler retain evidence for a valid candidate that
is infeasible under the current optimization objective, without treating a
failed compiler invocation as a recoverable strategy alternative.

For the default unit octagon:

| User contour bound | Selected triangles | Measured contour error |
| --- | ---: | ---: |
| `0.35` | 4 | `0.29289321881345254` |
| `0.10` | 8 | `0` |

The distance routine requires convex planar fans whose retained contour
vertices have unchanged coordinates. It measures the polygon contour distance
using source vertices against retained contour segments within this nested
convex model. It is not a general distance algorithm for arbitrary 3D meshes.
Unrelated, translated, self-intersecting, or nonconvex contours are rejected.

## Constraint systems

`constraints.ts` owns sparse linear equations. A registered versioned pattern
predicate normalizes the complete coefficient map and right-hand side; equal
right-hand sides alone cannot justify merging equations. The rewrite removes a
scaled duplicate and records its correspondence to the retained equation.

The next compiler pass changes the native solver selector through a generic
transaction. The solver actually decomposes the variable dependency graph and
performs separate eliminations for the resulting connected components. The
default system goes from five equations to four and from one dense solve to two
component solves. Both produce `x=3`, `y=1`, `u=4`, `v=2`.

The semantic contract compares reduced row spaces and computed solution values.
The solver checks every original equation's residual, requires finite
intermediates and outputs, and rejects inconsistent or underdetermined systems.
Its supported scope is at most 128 variables and 512 equations with a unique
solution. Pivot and zero detection use `1e-10`; row-space and solution comparison
use `1e-9`. Residuals are normalized by the maximum of one, the absolute right
hand side, and the sum of the absolute equation products, and must be at most
`1e-9`. These are numerical checks, not an exact rational-arithmetic theorem
prover. Normalization overflow is rejected explicitly.

## Exact revision and acceptance evidence

Each edit first passes its native adapter's round-trip validation. Its
`EditOptions.verify` callback asks `AnalysisManager.verifyTransformation()` for
a prepared semantic transaction. The IR revision is published only when the
prepared semantic acceptance can commit. Every compiler source and transform
pass also has an acceptance policy, including cache hits.

A compiler output has its task's artifact ID. A sequence of generic edits keeps
the working artifact's logical ID while advancing its revision. The lab records
an identity correspondence between the final working revision and the compiler
output revision; it never silently changes an entity reference's artifact ID.
All intermediate artifacts are retained in `result.artifacts`. Mesh candidate
correspondences branch from a shared source, so the entire correspondence array
is not one linear chain. Compose or trace only an exact contiguous path.

## Verification and reproduction

```sh
npm run build:source
node --test tests/ir-examples.test.mjs
node scripts/ir-demo.mjs
```

The example suite contains 31 tests covering native round trips, real compiler
and strategy integration, semantic gates, exact rewrite evidence, customized
source values, geometry rejection, solver residuals, budgets, intermediate
arithmetic, and warm-cache acceptance. Every domain has a negative test that
changes its meaning and checks that the transaction fails without publishing a
new revision.

The demo writes complete portable traces for all four domains, plus a tighter
mesh-bound scenario, under `output/v6-ir-*.json`. These artifacts are generated
from the implementation rather than hand-authored to resemble a successful run.
