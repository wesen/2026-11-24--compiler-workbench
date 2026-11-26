IRWB-020-G is ready for review. This commit contains only documentation; implementation is pending review.

- [Ticket](ttmp/2026/11/26/IRWB-020-G--stage-1-tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/index.md)
- [Design](ttmp/2026/11/26/IRWB-020-G--stage-1-tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/design-doc/01-tix-stage-1-design.md)
- [Diary](ttmp/2026/11/26/IRWB-020-G--stage-1-tix-language-tensor-ir-evaluators-meaning-contract-and-checked-passes/reference/01-diary.md)

**Proposed framework changes:** Add `applyPassSync` for synchronous native rewrites, sharing artifact, correspondence, and write checks with `applyPass`. Add a synchronous verifier for pure invariant postconditions. Exact and tolerance comparisons stay in the tensor domain; the existing async API stays unchanged.

`docmgr doctor` passed. Commit: `33f6e87543a61ea36d56f798edc4cdd2e9bdc9c5`.
