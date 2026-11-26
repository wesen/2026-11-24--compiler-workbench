## 1

I’ll use the docmgr and diary skills to track IRWB-013 while I read the reviewed design and verify how the corpus loads Tape projects.

## 2

The build passed, and a small Tape probe confirmed frame-array zeroing, hex i32 literals, logical shifts, and four-word value returns. The reference CLI loops over the entire corpus even when given a project name, so I’ll cover reference and O2 parity in the new project-specific test.

## 3

Checked `speed` parity passed all 200 generated entry cases across 14 changed revisions. The fresh measurement script also ran successfully and left the open project at r0. I’ll add the full-output vector assertions next and use the same generated cases for the reference, O2, and `speed` image comparisons.

## 4

The full vectors and all 500 generated cases agreed across the reference, O2, and `speed` images, including direct calls to `quarter`. Across the 15 `speed` revisions including r0, the fixed cases peaked at 6,465 SHA statements and 3,528 ChaCha statements, both below the 20,000 limit.

## 5

Implemented IRWB-013 in [corpus/projects/sha-chacha](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-013/corpus/projects/sha-chacha). It includes the SHA-256 and ChaCha20 single-block kernels, Tape metadata, packing notes, and a fresh `explore` script. The [implementation diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/log/02-implementation-diary.md) records the measurements and deviations. All implementation tasks are checked off.

**Verification**

- `npm run build` passed.
- `node --test tests/typed/sha-chacha.test.mjs` passed. The full vectors passed, and 500 generated cases agreed with r0 on each of the reference, O2, and `speed` RV32 images. Across all `speed` revisions, the fixed cases peaked at 6,465 SHA statements and 3,528 ChaCha statements, below the 20,000 limit.
- `node tools/parity.mjs --json sha-chacha` reported 200/200 agreeing entry cases across 14 changed revisions, with zero rejections or inconclusive cases.

With identical backend options, `speed` reduced executed instructions per byte from **220.44 to 124.41** for SHA-256 and **120.19 to 53.06** for ChaCha20.

**Design deviations**

The existing loaders already support Tape metadata and entry roots. The new test supplies reference signatures and runs O2 comparisons locally because the reference CLI has no project filter. Formatting used the corpus formatter’s helpers on this project, and aggregate test updates were outside the requested scope. Typed required the `Quarter` declaration before the functions and explicit mutable copies of its parameters.

**Commits**

- `109b6db` IRWB-013: add SHA-256 and ChaCha20 corpus kernels
- `b8f65c2` IRWB-013: verify vectors and checked RV32 images

The worktree is clean. Both commits are local.
