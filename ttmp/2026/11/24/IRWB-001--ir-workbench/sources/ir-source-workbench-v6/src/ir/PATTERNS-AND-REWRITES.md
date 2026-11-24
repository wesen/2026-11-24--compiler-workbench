# Patterns and directed rewrites

This module finds structures in an immutable, adapter-backed IR view and applies local changes through that view's transactional editing interface. Domain adapters keep their native storage. The matcher reads their logical entity, relationship, and optional operation projections.

## Pattern API

```ts
import {
  entity, op, capture, sameAs, pattern, distinct, equalContent,
  relation, where, match, matchAll, explainMatch,
  PatternPredicateRegistry
} from './patterns.js';

const doubled = pattern(
  op('add', capture('term'), sameAs('term'))
);

const duplicates = pattern({
  keep: entity('scene.definition'),
  drop: entity('scene.definition')
})
  .where(distinct('keep', 'drop'))
  .where(equalContent('keep', 'drop'));

const matches = matchAll(duplicates, sceneView);
const explanation = explainMatch(matches[0]);
```

| API | Exact meaning |
| --- | --- |
| `entity(kind?, attributes?)` | Match the requested entity kind and an attribute subset. Each supplied attribute value is compared as complete canonical finite data. Nested objects are not partial patterns. |
| `op(name, ...operands)` | Match an adapter operation with exactly that name, arity, and ordered operand pattern list. Requires the `Operations` capability. |
| `capture(name, inner?)` | Bind the current entity under a name, optionally checking another pattern. Repeated bindings of the same name require the same entity. |
| `sameAs(name)` | Require identical entity identity within this exact revision, not numerical or structural equivalence. Forward references work as equality constraints when that name is declared elsewhere in the complete pattern. |
| `pattern(node)` | Wrap a node pattern so it can have conditions and a serializable descriptor. |
| `pattern({a, b, ...})` | Search combinations of named node patterns. Different names may bind the same entity unless constrained with `distinct`. |
| `distinct(...names)` | Require pairwise different entity identities. |
| `equalContent(...names)` | Compare kind and complete attributes, plus operation name and ordered operand identities when operation projections exist. Ignores the entity's own ID and incoming edges. This is shallow logical content equality, not recursive graph equivalence. |
| `relation(kind, from, to)` | Require at least one directed relationship with the adapter-declared name between two captures. Containment, adjacency, dependency, and binding names remain distinct. |
| `where({id, version}, params?)` | Invoke a registered synchronous semantic predicate using immutable parameters and read-only IR observation capabilities. |
| `match(pattern, view, options?)` | Find the first complete match. View-first order is also accepted. |
| `matchAll(pattern, view, options?)` | Enumerate all complete matches, or throw an explicit budget error if enumeration cannot finish. |
| `explainMatch(match)` | Return recorded evidence for that exact match and revision. |
| `explainMatch(pattern, view, target?, options?)` | Explain a successful match or a candidate failure. A failed unrestricted query retains the last candidate's mismatch evidence; it is not a theorem prover. |

`PatternBuilder.descriptor` and `toJSON()` produce plain finite data; restoring the descriptor from JSON is sufficient to rerun a query. Factories snapshot their inputs. Capture names, including names such as `__proto__`, remain ordinary data keys.

### Domain predicates

Numerical equivalence, geometric tolerances, equation normalization, and attribute compatibility belong to the domain. Register those tests separately from the serializable pattern:

```ts
const registry = new PatternPredicateRegistry().register({
  id: 'example.threshold', version: '1',
  description: 'Compare a captured attribute with a requested threshold',
  test({ view, bindings }, params: { minimum: number }) {
    return {
      pass: Number(view.resolve(bindings.item).attributes.weight) >= params.minimum,
      reason: 'Compared the captured weight with the requested minimum'
    };
  }
});

const heavy = pattern(capture('item', entity('scene.definition')))
  .where(where({ id: 'example.threshold', version: '1' }, { minimum: 10 }));

const found = matchAll(heavy, sceneView, { registry });
```

The registry snapshots callback identities for each query. IDs and versions form a tuple, so delimiters inside either string cannot collide. Registering an already occupied version fails. A callback exception is an algorithm error; it is never converted into a false match. Native async functions, generator callbacks, and returned thenables are rejected for predicates and guards; rejected promises are drained to avoid unhandled rejection leaks.

### Query order, evidence, and budgets

Candidate order follows containment traversal (`pre`, `post`, or `breadth`), followed by any disconnected entities. Set `relations: ['operand']`, for example, to order an expression query by its semantic operand dependencies. For explicitly selected relationships, traversal starts at entities with no incoming selected edges, then covers disconnected and cyclic components deterministically. `roots` instead supplies an exact candidate-root selection. For a graph pattern, captures are assigned in lexical name order and its first named capture is the candidate root; later capture candidates come from the whole representation. Search is deterministic and duplicate binding tuples are eliminated.

Every match contains its pattern descriptor, root, exact artifact/revision, named `bindings`, evidence, a stable content-derived `key`, and the cumulative matching steps used when the match was discovered. Evidence records kind, attribute, operation, arity, capture, identity, relation, content, and registered predicate checks. `searchPattern` also returns total query work, including rejected candidates.

Defaults are 100,000 matching steps and 10,000 matches per query. `maxSteps` and `maxMatches` must be positive safe integers. An incomplete `matchAll` throws `PatternBudgetError`; its `partial` matches are explicitly incomplete evidence. A first-match query may finish within the same budget because it does not enumerate later matches. Pattern structure itself is bounded to 1,000 nodes, depth 100, and 100 graph capture nodes.

## Rewrite API

```ts
import { rewrite, saturate } from './rewrites.js';

const shareDefinitions = rewrite({
  id: 'scene.share-definitions', version: '1',
  match: duplicates,
  guard(found) {
    return {
      accept: found.bindings.keep.entity < found.bindings.drop.entity,
      reason: 'Keep the first stable definition identity'
    };
  },
  replace(found, edit) {
    const { keep, drop } = found.bindings;
    edit.redirectReferences(drop, keep, { relations: ['uses'] });
    edit.remove(drop);
    edit.correspond([keep, drop], keep, 'shared-definition');
  },
  preserves: [{ id: 'scene.appearance', version: '1' }]
});

const optimized = await saturate(sceneView, [shareDefinitions], {
  budget: 100,
  verify: semanticAcceptanceGate
});
```

The rule's match and declarations are finite, immutable data; its versioned guard and replacement are registered TypeScript implementations. `RewriteRegistry` provides explicit version lookup and descriptor inspection. A declaration in `preserves` does not verify itself. A step reports `unverified`, or `host-accepted` only after the supplied semantic gate accepts and commits it. The host's actual contract records explain which properties were checked and with what assurance.

The replacement receives a frozen `RewriteEdit` facade with `insert`, `replace`, `remove`, `update`, `connect`, `disconnect`, `redirectReferences`, `correspond`, and `preview`. It cannot prepare, commit, or roll back the transaction itself. Its mutation capability expires as soon as the callback settles, before asynchronous semantic verification begins. Guards, predicates, and replacements receive `IRReader`, which has observation methods but no `beginEdit` or revision-publication methods. These capability boundaries prevent accidental scheduler bypass; registered callbacks remain trusted executable code and may, of course, close over application-owned state.

### Schedule semantics

Each operator supports a direct call such as `await applyOnce(view, rule, options)` and a reusable form such as `applyOnce(rule, options).run(view)`. The reusable form exposes a plain schedule descriptor containing mode, pinned rule references, and budgets.

Scheduling defaults to containment. An IR can have flat program membership while representing nested operation dependencies with a different relationship. Select that relationship explicitly, for example `innermost(expressionView, doubleRule, { relations: ['operand'] })`. The option is also retained in the reusable schedule descriptor. The engine never silently treats all graph edges as structural containment.

| Schedule | Scope and order |
| --- | --- |
| `applyOnce` | Commit the first eligible changing match. Guard rejections and no-op matches are recorded and skipped. |
| `applyAll` | Snapshot the initial matching frontier, then revalidate each surviving binding tuple against the current revision before editing it. New matches introduced by the sweep are not added. |
| `topDown` | One initial pre-order sweep of containment or the explicitly selected relationships; at most one accepted replacement at each surviving root. Newly inserted roots are not visited. |
| `bottomUp` | The corresponding post-order sweep. |
| `innermost` | Normalize one rule in post-order, restarting matching after every accepted change. |
| `outermost` | Normalize one rule in pre-order, restarting after every accepted change. |
| `saturate` | Normalize a prioritized list of directed rules, restarting with the first rule after each change. It is not an e-graph or equality-saturation implementation. |

All schedules recompute bindings on the current revision. They never blindly apply an old match after a prior edit. A no-op is rolled back and cannot cause an infinite normalization loop. Normalizing schedules detect repeated native content before committing the repeated candidate, preserving the last unique accepted revision. The rejected candidate remains available as evidence.

`budget: 100` sets the maximum accepted applications. The object form also controls `maxAttempts` (default 1,000), shared `maxMatchSteps` (1,000,000), and `maxMatches` per query (10,000). The default accepted-application limit is 100. Application, attempt, and shared-step budgets may be zero. After exactly reaching an application limit, the scheduler may still determine that no eligible changing candidate remains; otherwise it reports `budget` and retains the uncommitted next candidate. This distinguishes a verified fixed point under the supplied rules and guards from an unfinished bounded search.

### Transaction and failure behavior

Each accepted rewrite is its own transaction. Native validation, complete edit projection checks, current-head comparison, and the optional semantic acceptance gate precede publication. If a later rewrite fails, earlier accepted steps remain valid and inspectable; an entire multi-step schedule is not an implicit all-or-nothing transaction.

`RewriteResult` contains the final view/artifact, input revision, mode, status, counts, reason, and immutable steps. Persist everything except the live `view`. Each step contains the exact matched revision, rule version, match evidence, before/after references, preservation declarations, and a `TransformationResult` with real changes and correspondence when one was prepared. **Only `status: 'applied'` means that step's result was published.** Rejected, cycle, and budget candidates may deliberately include provisional results for debugging.

Expected local rejection uses `RewriteRejected`, a false guard, or an explicit synchronous `classifyRejection` callback. Other failures throw `RewriteExecutionError`, carrying the partial `result` and original cause. `no-match`, `rejected`, `applied`, `converged`, `budget`, `cycle`, and `cancelled` are distinct ordinary outcomes. An abort before publication rolls back the pending edit and semantic acceptance. The scheduler rechecks current-head ownership after awaited verification through the underlying transaction protocol.

The regression tests in `tests/ir-rewriting.test.mjs` exercise exact capture semantics, failed-branch isolation, serialization, disconnected queries, predicate versioning, all seven schedule orders, explicitly selected operand dependencies in the real expression adapter, overlapping revalidation, introduced matches, directed cycles, every budget class, declared versus accepted preservation, semantic rollback, stale publication races, cancellation, callback authority, expired edit leases, and asynchronous protocol failures.
