# Using the v6 IR manipulation workbench

Open `output/source-workbench.html`. The delivered file starts in **IR manipulation lab**. It contains the compiled compiler, the original TypeScript evaluator, the source catalog and the UI; the application makes no network request. The existing seven source, strategy and contract examples remain accessible from the main navigation.

## Four useful starting points

| Domain | What to inspect first |
| --- | --- |
| Symbolic expressions | The CSE step merges two multiplication nodes. Follow its redirected operand and correspondence; then inspect the repeated-operand pattern used by the algebraic rules. |
| Scene sharing | Select the definition-sharing step, select the removed definition, and see the retained definition and unchanged named instance bindings. |
| Mesh alternatives | Compare the original and reduced candidates. Set the error bound to `0.1`, rerun, and inspect the strategy decision that keeps the original eight triangles. |
| Constraint systems | Inspect a sparse equation's dependency edges, the scaled duplicate removal, and the subsequent change from one dense solve to two component solves. |

The transformation sidebar is compact. The right-hand detail view is scoped to the selected step. Revision tiles above it are separate recorded edges; two mesh candidates can share the same input. A displayed uncommitted candidate is explicitly labelled and is never substituted for the accepted output.

## Find the actual code

**Example & compiler code** opens the real source embedded by the build. The domain module contains the authored native example, schema validator, adapter and domain algorithms. `src/ir-examples/rules.ts` defines the transformations; `lab.ts` builds the Strategy IR, registers compiler passes and attaches semantic gates. `contracts.ts` defines the checks.

The source browser also includes the generic matcher, scheduler, edit transaction, correspondence utilities, semantic manager, strategy interpreter, compiler runtime and tests. A selected rewrite's **Implementation** tab navigates to its indexed literal definition where one exists. Dynamically constructed definitions fall back to their containing source file rather than inventing a line location.

The v6 native input editor is distinct from this source browser: it edits data consumed by compiled TypeScript. The original five model-program editors still support editable TypeScript source. To change a v6 adapter or rule implementation, edit its source file in the downloaded workspace and rebuild.

## Explore entities and typed relationships

Select an entity in either revision's graph or entity list. The opposite revision highlights only entities connected through the recorded correspondence. A merge may select several origins; a split may select several descendants. Deleted entities can have no descendant. Entity IDs are qualified by the artifact ID and content revision.

The graph preview is bounded and labels its display cap. The entity list and queries remain available for the complete representation. Containment, binding and dependency edges have separate meanings; a query does not silently treat them as interchangeable.

**Query** runs the real adapter-backed API on the selected exact before or after revision. Available operations include walk, children, parents, ancestors, typed successors/predecessors, dependencies, subgraph, find and resolve. Choose the appropriate relationship, traversal order, transitive mode or entity filter. Budget exhaustion is an error indicating an incomplete query, not an apparently successful truncated answer.

**Pattern & match** displays the rule's declarative pattern, recorded matches and matching evidence. Edit highlighted YAML and run it against the selected revision. The same versioned domain predicate registry used by the compiler is supplied for domain-specific conditions. Unknown predicates, malformed patterns and missing capabilities fail explicitly. Captures refer to entity identity; `equalContent` is a shallow structural comparison, and stronger domain equality uses a registered predicate.

## Inspect revisions, changes and origins

**Changes & origin** shows inserted, removed and updated entities and edges, the operation log, correspondence groups and diagnostics. These records come from actual validated transactions. A replacement that failed, exhausted a budget or would close a rewrite cycle can retain its candidate for diagnosis; that status is displayed separately from committed edits.

Lineage inspection follows exact recorded revision edges. Choose a source revision, entity and target revision. Forward tracing answers where it went; inverse tracing answers where it came from. Mesh alternatives remain branches. The route selector uses a bounded recorded path and reports the chosen path, rather than treating every retained correspondence as one linear history.

**Native IR** shows the underlying representation as highlighted YAML. Expression arenas, scene tables, packed mesh coordinates and sparse equation coefficients keep different native formats. The logical entity graph is an inspection/edit projection, not a replacement storage model.

## Follow compiler execution and cache reuse

**Compiler passes** opens the original compact invocation sidebar and right-hand details, including cache reasons, observations, provenance, actual pass source and semantic contracts. **Strategy trace** shows the planned nodes, actual dynamic records, candidate metrics, selection evidence and links to invocations.

Enable **Run twice for cache** and compile. The second run reuses eligible native compiler outputs while the semantic policy runs fresh checks. Actual edit traces continue to identify the original invocation that performed the work; they are not fabricated again for the cached run. Following an edit to its compiler invocation opens that originating run. The final compiler result links to the selected run's invocation.

For each mesh candidate, distinguish its construction contract's supported geometric scope and bound from the user's selection threshold. The strategy chooses the smallest feasible candidate under the user threshold. At `0.35`, the default four-triangle candidate is feasible; at `0.1`, it is retained for inspection but excluded from selection.

## Edit and preserve work

**Edit native input** offers highlighted YAML for the selected domain. Each domain retains its own draft. **Compile edited input** captures the exact text, validates the native schema, runs the pipeline and creates a new immutable history entry. Rejected input shows an error and clears the active result view; a previous success remains accessible through history.

**Restore example input** restores the built-in native example. **Restore selected run input** restores the source and controls of a retained successful run. Export the lab trace as YAML to retain source artifacts, adapter descriptions, strategy and compiler records, semantic checks, matching evidence and changes. The workbench's source browser exports source text where supported; the complete workspace includes all source independently.

Browser drafts and caches are in memory and restart when the file reloads. Export work before closing the page. Rebuilding from the workspace uses `npm run build:source`; reproducing all evidence uses `npm run verify:release`.

## Verification boundary

The automated UI tests exercise the real examples, real matching/query APIs, source bytes, selection correspondence, history, invalid input, warm runs and lineage navigation using explicit DOM/Canvas/Worker doubles. The optional `scripts/check-ir-browser.py` covers a real browser environment when available. It was not run successfully in the restricted authoring environment, so rendered desktop/mobile layout and browser compatibility remain unverified here.
