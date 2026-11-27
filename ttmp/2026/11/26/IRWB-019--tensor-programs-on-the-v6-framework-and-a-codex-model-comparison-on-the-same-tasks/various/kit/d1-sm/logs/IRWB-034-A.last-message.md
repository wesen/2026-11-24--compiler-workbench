Fixed IRWB-034-A. LICM treated nine back edges into the VM’s dispatch header as separate loops. It redirected sibling back edges through synthetic preheaders, so frame-address calculations ran again on the hot dispatch path. LICM now groups loops by header, redirects only external edges, and shares hoisted frame addresses by offset.

| Coalesced RV32 workload | r0 before and after | O2 before → after | `speed` before → after |
|---|---:|---:|---:|
| VM Fibonacci, `n=12, seed=8` | 7,678 | 9,286 → 6,349 | 9,286 → 6,349 |
| VM checksum, `n=12, seed=8` | 6,874 | 8,218 → 5,677 | 8,218 → 5,677 |
| 50-project corpus | — | 8,692,508 → 8,527,694 | 6,474,145 → 6,306,325 |

No project regressed under either pipeline in the three measured backend configurations. The requested test groups reported 408 passes, three skips, and zero failures. Parity reported 8,286 agreements, zero disagreements, and 14 inconclusive cases.

Typed now exports the tested `attributeInstructions()` API for following executed RV32 instructions through pass correspondence and rule records. No framework changes were needed.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-sm-irwb-034-a/ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-sm-irwb-034-a/ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/design-doc/01-attribute-dynamic-rv32-cost-to-typed-optimization-decisions.md) · [Final report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-sm-irwb-034-a/ttmp/2026/11/27/IRWB-034-A--attribute-and-fix-the-typed-bytecode-vm-speed-regression/analysis/01-bytecode-vm-speed-attribution-and-validation.md)

Last commit `c719081ac32dacd88967b1970b6b70920b5fc7c8`.