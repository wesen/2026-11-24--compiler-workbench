## 1

I’m using the docmgr and diary skills to create IRWB-012. I’ll verify the Typed features and checker limits before writing the VM design, then commit only the ticket.

## 2

The front end requires an enum for `match`, while a bytecode fetch returns an `i32`. The design uses an `if` chain for dispatch. I’ll check that the same small probe runs through the lifter, evaluator, and both RV32 paths.

## 3

The probe found a loader gap. Tape ingestion handles both frame arrays and agrees across the evaluator and RV32, but the default Node project loader fails before lifting. The browser already supports the tape opt-in, so the design calls for forwarding that setting through the Node loaders as part of implementation.

## 4

The assembly and JSON bytecode agree for both fixtures, and I verified their maximum guest counts of 186 for Fibonacci and 172 for checksum. The evaluator budget remains provisional until the VM is implemented. Ticket validation passed, and I’ll commit the ticket now.

## 5

[Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-012/ttmp/2026/11/26/IRWB-012--bytecode-vm/design-doc/01-bytecode-vm-corpus-project.md) · [Ticket IRWB-012](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-012/ttmp/2026/11/26/IRWB-012--bytecode-vm/index.md) · Commit `1d4ce5159b7f750ae9d444010520e8d021e3bad7`

The design specifies a Typed stack VM with Fibonacci and checksum bytecode fixtures, an independent JavaScript oracle, and a benchmark that compares the general interpreter with manually specialized Typed code in RV32 instructions per guest instruction. A small probe confirmed that the frame arrays require tape ingestion through the Node project loader. Both fixture encodings and guest instruction counts were verified. The evaluator step budget is provisional until implementation. The commit contains only the ticket files.
