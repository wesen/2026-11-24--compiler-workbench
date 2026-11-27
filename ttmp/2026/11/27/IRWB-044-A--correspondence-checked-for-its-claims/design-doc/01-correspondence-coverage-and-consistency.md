---
Title: Correspondence coverage and consistency
Ticket: IRWB-044-A
Status: active
---

# Correspondence coverage and consistency

The supported domain is correspondence requirements between IR ports that expose entity lists. Coverage is `partial` (at least one nonempty group when either universe is nonempty), `source`, `target`, or `both`; source and target mean every entity on that side occurs in a group. Empty universes need no groups. The default is `partial`, which permits the existing F35 merge mapping. The simpler default of `both` would reject that honest mapping. Existing requirements without an explicit setting declare `partial`, including the four lab transformations and Tix CUDA lowering.

For each group, an empty target asserts deletion and an empty source asserts insertion. Reject either assertion for an ID present in both revisions: the structural diff calls such an entity unchanged or updated. Groups with entities on both sides express a semantic relationship and need not preserve IDs; the diff cannot disprove merges or splits. Entity lists form a minimal projection for the framework structural diff: it determines insertion, removal, and survival without requiring a domain adapter. Comparing only list membership directly would yield the same result, but using the diff keeps the rule aligned with its vocabulary. Cross-representation IDs may coincide accidentally, so apply this consistency rule only when both ports have the same IR type identity and version.

No attempt is made to prove semantic relationships or infer correspondence from changes. Types without entity lists retain existing membership behavior; coverage uses the declared lists.
