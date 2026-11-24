# Inspecting the third layer in v6

The standalone HTML opens the **IR manipulation lab**. The seven existing source,
strategy and contract examples remain available in the main navigation.

## A useful route through the workbench

1. Select **Symbolic expressions**, **Scene sharing**, **Mesh alternatives**, or
   **Constraint systems**. Each selection executes the real TypeScript compiler,
   Strategy IR, semantic checks, and adapter-backed transformations.
2. In **IR explorer**, select a transformation from the compact left list.
   Each tile above the details is a recorded before/after edge. Tiles are not
   connected as a chain, because mesh alternatives branch from a common source.
3. Select an entity in either revision. The other revision highlights only its
   recorded correspondence targets. The details show its native attributes and
   typed containment, binding, dependency, adjacency or provenance relationships.
4. Use **Query** to run the public navigation APIs. Empty results remain visible.
   Invalid identities and exhausted budgets produce explicit errors.
5. Use **Pattern & match** to inspect the recorded declarative pattern, exact
   captured references, and matching evidence. Its editable YAML query calls the
   real matcher on either retained revision. The lab passes its versioned domain
   predicate registry to the generic inspector; the inspector imports no domain
   predicates itself.
6. **Changes & origin** shows the actual logical diff, edit operations and
   many-to-many entity correspondence. Rejected, budget-limited or cyclic rewrite
   candidates are explicitly labelled uncommitted. No candidate is presented as
   an accepted output merely because it has an inspectable provisional artifact.
7. **Entity lineage** follows an entity to a selected exact revision. A bounded
   breadth-first search selects one deterministic shortest revision route; the
   core `traceEntity` and `composeCorrespondence` APIs trace all resulting entities
   along that route. Alternative candidate revisions remain separate branches.
   Inverse correspondence reports historical origins; it does not undo edits.
8. **Compiler passes** retains the compact invocation sidebar, IR route,
   semantic contract evidence, cache explanation, and actual compiler source.
   **Strategy trace** shows the real plan and its recorded execution links.
9. **Example & compiler code** displays the original files embedded at build time,
   including domain adapters, authored rewrite rules, scheduling, transactions,
   contracts, strategy interpreter and runtime. Literal adapter and rewrite
   declarations are indexed by exact version and source range.

## Running experiments

**Edit native input** edits the representation's native data in highlighted YAML.
It is distinct from the actual TypeScript implementation shown in the source
browser. Each domain validates its own storage format. The four native formats
are not replaced by a common storage AST.

The mesh error-bound control changes the actual strategy's candidate selection.
**Run twice for cache** performs two compiler runs against one runtime and semantic
manager, so cache-hit labels come from actual invocation records. Draft input and
history are kept separately for each domain. Invalid new input hides the result
until the input is corrected or a retained successful run is selected.

A warm run retains the transformation evidence from its original executed run.
The transformation's **Inspect compiler invocation** link opens that exact
originating invocation and labels the distinction explicitly. **Inspect selected
run instead** switches to the current cache hit and its fresh semantic checks.
The final compiler result always links to the selected run's own invocation.

The workbench exports the complete finite lab record as YAML, and the native input
editor can download its current draft directly. The standalone HTML
has no remote service dependency; its content security policy disables network
connections. Local UI state is in memory, so export edits and traces when needed.

## Verification scope

`tests/ir-ui.test.mjs` runs real compilers, adapters, matchers, transactions,
contracts and lineage APIs through a DOM test double. It checks all four domains,
exact source visibility, unknown query identities, budget failures,
recorded and live matching, correspondence selection, inverse lineage, rejected
candidates, cache reuse, input/history state, and navigation back to the existing
source workbench. It does not establish actual browser rendering.

`scripts/check-ir-browser.py` is an optional real Playwright acceptance suite for
a local environment with Chromium installed. It was not run in the restricted
authoring environment. It records blocked browser launches explicitly and saves
desktop/mobile screenshots only after an actual successful browser run.
