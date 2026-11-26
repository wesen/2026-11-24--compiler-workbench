## 1

I’ll use the docmgr and diary skills to review the design against the experiment, then revise the guide and record each cut. I’ll work from this worktree and commit only IRWB-014.

## 2

The biggest cuts are the Typed round-trip wrapper, the separate pack helper, and the extra match window and length caps. The host can compare the decoded output directly with the input, while the bounded block still gives the compiler nested match search, checked writes, and overlapping back-references to optimize.

## 3

Committed as `2ad5c47ed485ab5913b624ce6a6f8ffa3c04f712`. Updated the diary, and `docmgr doctor` passed.

- Moved the round trip and equality check to the host, removing the Typed wrapper and its mismatch code.
- Moved token packing into the encoder. The hash helper still exercises inlining.
- Removed the separate match window and length caps. The block size and probe budget bound the search.
- Simplified the token grammar and decoder guards. Buffer capacities bound decoding.
- Reduced policy handling to a capped first cell, preserving the specialization input.
- Merged the generated encoder cases and trimmed overlapping fixtures.
- Removed the second walkthrough script and optional project metadata.
- Replaced speculative statement costs and the secondary threshold with loop-work bounds and a plan to measure against the actual gate.
- Trimmed the test and reporting matrix to directed fixtures, generated checks, and per-kernel RV32 instruction counts.
- Consolidated repeated implementation and correctness guidance.
