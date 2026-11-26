Implemented and registered [regex-nfa](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-015/corpus/projects/regex-nfa), including the Typed Thompson NFA matcher, walkthrough, and workbench exploration script. Added the [focused tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-015/tests/typed/regex-nfa.test.mjs) and updated the [IRWB-015 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-015/ttmp/2026/11/26/IRWB-015--thompson-regex-matcher).

- `npm run build` passed.
- `node --test --test-isolation=none tests/typed/regex-nfa.test.mjs` passed both tests. The evaluator and both RV32 backends agreed with JavaScript `RegExp` on 100 generated cases and 10 fixtures, with unchanged input memory.
- `node tools/parity.mjs regex-nfa` reported 100/100 cases agreeing, zero inconclusive cases, and no rejected passes across 12 revisions.
- `docmgr doctor --ticket IRWB-015 --stale-after 30` passed.

The benchmark returned `1` in **8,183 RV32 instructions at r0**, **8,040 after `speed`**, and **6,628 on the reference compiler**. The maximal active set took 5,290 evaluator statements at r0 and 4,175 after `speed`, both below the 20,000-statement limit.

The project uses existing tape and entry metadata. Because the generator accepts one fixed string per specification, default pass checks use the benchmark pattern and the focused oracle test covers all eight designed patterns. The matcher returns after breaking out of the final closure loop to satisfy the Typed front end. Legacy corpus-wide tests still assume the old project set, and one loader omits tape metadata. Those tests were outside the requested edit and verification scope.

Commits `0beef65` (corpus and tests) and `a48847e` (ticket records). The worktree is clean.