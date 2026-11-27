Both automatically specialized programs ran in **77 RV32 instructions** and occupied **48 bytes** each. The host binds the bytecode contents and entry point while `n` and `seed` remain dynamic.

| Program | General VM | Specialized VM | Hand-written loop | Instruction gap closed |
|---|---:|---:|---:|---:|
| Fibonacci | 7,678 instructions / 840 B | 77 / 48 B | 75 / 40 B | 99.974% |
| Checksum | 6,874 instructions / 840 B | 77 / 48 B | 74 / 36 B | 99.956% |

Counts were measured at `n = 12`, `seed = 8`. The general VM uses one shared image. The specialized images retain the VM’s 32-byte stack-frame setup and teardown.

The specializer folds checked loads at known indices and reconnects repeated program-counter states as loop backedges. Every changed pass passed the meaning check under the host promise. Both final images also matched the general VM on all **442 corpus calls**, including caller-visible memory.

**Shared framework changes:** none. Typed’s transaction correspondence now links promoted and split locals to their source statements. The requested test groups finished with **412 passes, zero failures, and three opt-in skips**.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-am-irwb-036-b/ttmp/2026/11/27/IRWB-036-B--specializing-the-bytecode-vm/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-am-irwb-036-b/ttmp/2026/11/27/IRWB-036-B--specializing-the-bytecode-vm/design-doc/01-binding-time-and-residual-control-flow.md) · [Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-am-irwb-036-b/ttmp/2026/11/27/IRWB-036-B--specializing-the-bytecode-vm/analysis/01-measurement-report.md)

Last commit `b9153bcb8e28768c0e6ef3d012e32ea47b4b6afb`. The worktree is clean.