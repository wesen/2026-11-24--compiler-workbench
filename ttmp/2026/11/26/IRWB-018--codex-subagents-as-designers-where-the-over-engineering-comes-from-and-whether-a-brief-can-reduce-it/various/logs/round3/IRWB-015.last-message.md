Commit `c28b445f8dcd17ae8c69b7b58403c38fccb73fa5`

- Cut grouping, empty-pattern support, and the parser stack. Top-level alternation and atom stars still exercise overlapping paths, repetition, and empty-text acceptance.
- Cut synthetic jump states and the separate overflow status. Directly patched edges bound the NFA to 13 states.
- Cut compact state lists, counters, separate visited flags, and early termination. Two flag banks handle reachability and closure deduplication.
- Cut the parser-only helper and custom helper input specs. The scalar character predicate keeps the inlining target.
- Cut extra generated profiles, the grammar generator, the host recognizer, and exhaustive sweeps. Two profiles and directed fixtures cover the essential cases.
- Cut speculative per-operation costs and the second budget threshold. The design uses a visit bound and calls for measuring headroom under the existing limit.
- Cut the separate DFA project, runtime fallback, and prescribed determinization plan. The fixed-pattern comparison directly tests specialization.
- Cut the benchmark matrix and cross-ticket reading list. Paired RV32 measurements and direct source links support the experiment.