**Loop-invariant code motion (LICM) caused the slowdown.** Nine backedges shared the VM’s dispatch header. LICM created a preheader for each, redirecting dispatch through code that recomputed frame addresses for other opcode handlers. That revision alone added **2,599 Fibonacci instructions** and **2,251 checksum instructions**, with zero register spills.

The fix skips LICM when multiple loop facts share a header. Fixed `speed` beat r0 on **all 442 VM fixture calls**.

| RV32 instructions | r0 before → after | O2 before → after | `speed` before → after |
|---|---:|---:|---:|
| VM Fibonacci, `n=12, seed=8` | 7,678 → 7,678 | 9,286 → **6,688** | 9,286 → **6,688** |
| VM checksum, `n=12, seed=8` | 6,874 → 6,874 | 8,218 → **5,968** | 8,218 → **5,968** |
| All 50 projects | 863,485 → 863,485 | 866,708 → **849,309** | 645,113 → **629,329** |
| Other 49 projects | 824,464 → 824,464 | 819,642 → **815,354** | 598,047 → **595,374** |

`regex-nfa` also improved. The other 48 projects matched their previous totals. Corpus totals cover 829 of 830 seeded calls with coalescing enabled. One `my-analysis` call reached the emulator limit in every configuration.

The reusable profiler attributes each revision’s instruction delta and traces individual executed instructions through the existing correspondence chain. **No framework changes were required.** [Profiler source](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-am-irwb-034-b/src/typed/attribution.ts)

Corpus parity and the independent reference comparison each agreed on all 8,286 decided cases, with 14 inconclusive. The requested test groups had 408 passes, zero failures and three opt-in skips. Both focused attribution tests passed.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-am-irwb-034-b/ttmp/2026/11/27/IRWB-034-B--attribute-and-fix-the-bytecode-vm-slowdown/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-am-irwb-034-b/ttmp/2026/11/27/IRWB-034-B--attribute-and-fix-the-bytecode-vm-slowdown/design-doc/01-measuring-the-cost-of-each-revision.md) · [Final report and per-project counts](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-am-irwb-034-b/ttmp/2026/11/27/IRWB-034-B--attribute-and-fix-the-bytecode-vm-slowdown/analysis/01-instruction-attribution-and-corpus-results.md)

Last commit `6d0e8767aaa92077bb6d1c6a08605fc2e0f8cae4`. The worktree is clean.