Completed [IRWB-036-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-sm-irwb-036-a/ttmp/2026/11/27/IRWB-036-A--specialize-the-bytecode-vm-on-constant-memory/index.md). The checked specializer removes bytecode fetch and dispatch while keeping the guest loop count dynamic.

| Program | General VM | Automatic specialization | Hand-written loop | Instruction gap closed |
|---|---:|---:|---:|---:|
| Seeded Fibonacci | 7,678 instructions / 840 B | **161 / 64 B** | 75 / 40 B | 98.87% |
| Rolling checksum | 6,874 instructions / 840 B | **136 / 52 B** | 74 / 36 B | 99.09% |

Measured at `n = 12`, `seed = 8`, with RV32 coalescing enabled. The general VM shares one image across both entries. The automatic results include opt-in frame-slot promotion before `speed` and rely on the host supplying the promised bytecode.

The generic framework required no changes. Typed stages buffer assumptions with accepted revisions and declares frame removal through its transaction API. Both specializations agreed with the general VM across all 442 corpus calls. The requested suites recorded 411 passes, three skips, and zero failures. The browser build passed.

[Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-sm-irwb-036-a/ttmp/2026/11/27/IRWB-036-A--specialize-the-bytecode-vm-on-constant-memory/design-doc/01-residualize-typed-control-flow-with-a-constant-buffer.md) · [Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-sm-irwb-036-a/ttmp/2026/11/27/IRWB-036-A--specialize-the-bytecode-vm-on-constant-memory/analysis/01-bytecode-vm-specialization-measurements.md)

Last commit `852139fb8eaf058d003ea79241812e96c0cf39d5`.