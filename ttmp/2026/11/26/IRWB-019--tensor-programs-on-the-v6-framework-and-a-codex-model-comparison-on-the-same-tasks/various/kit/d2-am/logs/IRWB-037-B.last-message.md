IRWB-037-B closed both remaining fixture gaps. The checked bounds-elimination pass removed four redundant guards from regex, saving **346 executed RV32 instructions**. The same pass saved **11,347** on LZ by proving that masked hash indices fit the table.

| Workload | Before | After | Saved | Reference |
|---|---:|---:|---:|---:|
| Regex fixture, `speed` | 6,933 | **6,587** | 346 | 6,628 |
| LZ fixture, `speed` | 156,782 | **145,435** | 11,347 | 156,405 |
| Chess fixture, `speed` | 10,038,193 | **10,038,193** | 0 | 10,827,760 |
| 50-project corpus, O2 | 1,090,271 | **1,083,485** | 6,786 | 875,417 |
| 50-project corpus, `speed` | 792,800 | **787,613** | 5,187 | 875,417 |

The corpus totals use D1’s generated workload, including one call charged at the instruction cap. Both pipelines improved on four projects, with zero project-level regressions.

Typed attribution now exposes `--hot`, which ranks surviving statements by executed instructions and shows their recorded cost reductions. It also identified a multiply-by-five rewrite. The rule verifier proved the identity, but four matches saved zero instructions, so it stayed experimental. **No framework changes were needed.**

The build succeeded. The requested suites finished with **414 passed, 3 skipped, 0 failed**. Parity and both image checks agreed on all **8,286 decided cases**, with 14 inconclusive.

[Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-am-irwb-037-b/ttmp/2026/11/27/IRWB-037-B--missed-typed-optimizations-from-instruction-provenance/index.md) · [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-am-irwb-037-b/ttmp/2026/11/27/IRWB-037-B--missed-typed-optimizations-from-instruction-provenance/design-doc/01-tracing-residual-instruction-cost.md) · [Final report and per-project measurements](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-am-irwb-037-b/ttmp/2026/11/27/IRWB-037-B--missed-typed-optimizations-from-instruction-provenance/reference/02-measured-results-and-verification.md)

Last commit `c6768a6c6b36fa2924769546bbaa0f8b5e6fd1a7`. The worktree is clean.