# V4 acceptance checklist

This is the release checklist for the complete Strategy IR scope. The release report records the final results and evidence. Semantic pass contracts and a generic domain-IR rewrite engine remain separate future projects.

## Public surface

| Area | Required behavior |
| --- | --- |
| Data model | Immutable finite JSON; explicit schema version; stable plan and node identities; versioned algorithm references; serialized arguments and lexical data references |
| Operators | `apply`, `sequence`, `parallel`, `fork`, `chooseBest`, `conditional`, `repeatUntilStable`, `forEach`, `require`, `verify`, `checkpoint`, `attempt`, `scope` |
| Plan APIs | Traversal, lookup, replacement, insert before/after, removal, validation, structural diff, serialization/import, execution |
| Registry | Exact algorithm identity/version resolution; appropriate algorithm roles; immutable execution snapshot |
| Interpreter | Real control flow, lexical binding isolation, ordered concurrent results, bounded traversal/iteration, cancellation and error handling |
| Evidence | Planned node and dynamic execution identity; parent/child and branch/iteration/item context; terminal statuses; selection/rejection evidence; links to real task/invocation/cache records |

## Semantic checks

- Sequential data flow and dependencies are explicit; a named analysis can be consumed without replacing the current IR.
- Parallel work uses isolated environments and deterministic result ordering. Failure drains work already started.
- Fork retains successful and explicitly rejected candidates. Algorithm bugs are fatal.
- Selection checks finite required metrics, all constraints and deterministic tie breaking, and records why each alternative won or lost.
- Conditional executes one branch and identifies the skipped branch.
- Repeat compares semantic identity, detects cycles and enforces a mandatory bound.
- For-each validates the selected collection, enforces a bound, and exposes item/index context without leaking bindings between items.
- Attempt handles explicit rejection only, respects optional rejection-code filters, and starts fallback from the original lexical state. It does not claim to roll back host side effects.
- Scope isolates local names while returning its result. References cannot read inherited object properties.
- Imported plans reject malformed nodes, duplicate identities, invalid versions/roles, out-of-scope names, nonfinite/executable data and excessive nesting.
- Plan edits produce a new validated immutable plan. Invalid edits leave the old plan intact.
- Every terminal execution has a retained trace, including rejection, cancellation and algorithm failure.

## Integration checks

- All five authored examples use Strategy IR for their default source-first compilation.
- Scene and mechanism optimization choices are made by visible strategy operators.
- Plans schedule real compiler passes rather than hiding compilation inside one opaque operator.
- CAD and mechanism imports compose with the scene strategy.
- Final results preserve the expected geometry/motion behavior of v3.
- Warm compilation reuses pass results; source, policy and plan changes invalidate only their actual dependencies.
- Plan traces survive compiler snapshot export, including failed runs.
- The workbench distinguishes editable drafts from the exact plan and source that executed.
- The workbench can edit/import/export a plan, inspect dynamic executions and cache explanations, and open the real implementation source.
- YAML and TypeScript are highlighted. Pass and plan lists are compact. Desktop focus and mobile layouts remain usable.
- The standalone HTML works without external requests. The archive includes sources, installed dependencies, compiled outputs, tests, documentation and release evidence.
