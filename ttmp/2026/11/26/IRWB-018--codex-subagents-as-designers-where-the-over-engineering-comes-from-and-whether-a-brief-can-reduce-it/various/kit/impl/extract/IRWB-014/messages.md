## 1

I’ll read the reviewed design and corpus examples first. I’ll use the docmgr and diary skills to keep IRWB-014 current as I implement and verify the project.

## 2

Both Node loaders already forward `ingest.tape`, so no loader changes are needed. The build passed. I’ll implement the codec and use the exact token fixtures to check the format before running the generated cases.

## 3

The exact token fixtures passed at r0, and the Workbench script decoded 24 A cells in 3,181 RV32 instructions. I also found an existing test that hardcodes 46 corpus scripts. The required `explore` script brings the count to 47, and that test is outside the requested edit scope.

## 4

Project parity passed all 400 generated cases. Each of the eight changed `speed` revisions also agreed on 400 cases in the focused test. The longest evaluator run I observed took 1,767 statements against the 20,000-statement limit. I’ll record the instruction totals and finish the ticket updates.

## 5

Implemented [lz-roundtrip](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-014/corpus/projects/lz-roundtrip) with the Typed hash-chain compressor, overlapping decoder, project metadata, two runnable examples, and a fresh `explore` script. Added [focused tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-014/tests/typed/lz-roundtrip.test.mjs) and recorded the results in the [IRWB-014 diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor/log/01-design-diary.md). All ticket tasks are checked off.

- `npm run build` passed.
- `node --test --test-isolation=none tests/typed/lz-roundtrip.test.mjs` passed both tests, including exact tokens, byte-for-byte round trips on the evaluator and RV32 images, and the fresh Workbench run.
- `node tools/parity.mjs lz-roundtrip --json` reported 400/400 agreements with zero inconclusive cases or rejected passes. The longest observed evaluator run took 1,767 of the 20,000 allowed statements.

Over 100 seed-7 round trips, r0 used **185,876** RV32 instructions, `speed` used **157,682**, and the reference image used **156,405**. On the same 34 cases with `chainLimit = 3`, specialization reduced the `speed` total from **54,993** to **54,959**.

The Node loaders already supported `ingest.tape`, so the planned loader edits were unnecessary. The focused test invokes the reference compiler directly because `reference-check.mjs` ignores the project argument. The required `explore` script also raises the corpus script count from 46 to 47. The existing Workbench inventory test still hardcodes 46 and was outside the allowed edit and execution scope.

Commits `70388b8` and `6c60d01` are local. The worktree is clean.
