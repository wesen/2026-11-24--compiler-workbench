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
