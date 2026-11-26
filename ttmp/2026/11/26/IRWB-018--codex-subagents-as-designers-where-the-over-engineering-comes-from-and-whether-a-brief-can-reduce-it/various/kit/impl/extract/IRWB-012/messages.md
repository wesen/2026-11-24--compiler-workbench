## 1

I’ll read the reviewed design and the corpus examples first. I’ll use the docmgr and diary skills to track implementation, verification, and any deviations in IRWB-012.

## 2

Both Node loaders picked up tape ingest from `project.json`. The maximum-count probe returned the designed results for both fixtures and used 4,131 and 3,699 r0 evaluator statements, well below the 20,000-statement limit. The loader regression already exists, so I’ll exercise both loaders with the real project and keep the shared code untouched.

## 3

All 442 valid inputs agreed across the JavaScript oracle, both IR revisions, and both RV32 compiler paths. At the measured input, `speed` increased the emulator instruction count for both fixtures. The hand-specialized loops agreed with the VM and used 75 and 74 instructions. I’ll record those results alongside the bytecode listings.

## 4

Implemented IRWB-012 in [corpus/projects/bytecode-vm](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/corpus/projects/bytecode-vm). The Typed stack VM runs seeded Fibonacci and rolling checksum from a shared 64-cell bytecode image. The Explore script compares r0 and `speed` on a fresh workbench copy. The project notes include both disassemblies and the hand-specialized measurements.

**Verification**

- `npm run build` passed.
- `node --test --test-isolation=none tests/typed/bytecode-vm.test.mjs` passed all three subtests. The JavaScript oracle, r0 and `speed` evaluators, and both RV32 compiler paths agreed on 100 generated cases and all 442 valid calls. Every evaluator call finished within 20,000 statements.
- `node tools/parity.mjs bytecode-vm` reported seven checked revisions, 100/100 agreement, and zero inconclusive cases.

At `n = 12, seed = 8`, `speed` increased Fibonacci’s RV32 instruction count from 7,678 to 9,286 and checksum’s from 6,874 to 8,218. The hand-specialized loops took 75 and 74 instructions respectively.

**Deviations.** Tape ingest and its loader regression already existed. The reference-check CLI ignores project arguments, so the focused test invokes the reference compiler directly. The existing whole-corpus totals still predate this project because existing tests were out of scope. These decisions are recorded in the [implementation diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-012/ttmp/2026/11/26/IRWB-012--bytecode-vm/log/02-implementation-diary.md).

Commits `c2500fb` for the corpus and tests and `6e7b620` for the ticket updates. The worktree is clean.
