The investigation is **incomplete**: I found hot regex code and measured candidates, but did not establish a verified optimization that pays. No rules, passes, or framework code changed.

The original regex fixture now takes **6,933 instructions** under `speed`, against **6,628** for the reference. The original LZ fixture takes **156,782** under tuned `speed`, against **156,405** for the reference. I did not remeasure the original chess fixture; on the separate generated corpus cases, chess takes **327,316** under `speed` against **334,902** for the reference.

The generated corpus totals are **1,090,271** for O2, **867,770** for `speed`, and **875,417** for the reference. Each total includes one case capped at 200,000 instructions. Since the compiler was unchanged, these are baseline figures; there is no independently measured optimized-after result.

Attribution identified repeated array checks and load/compare sites in regex. Reapplying eight existing checked passes after `speed` yielded no instruction reduction. A possible repeated-check elimination still needs a sound path-sensitive proof and measurement.

The build and focused regex and LZ tests passed. The requested three-directory test run was still in progress at the checkpoint, so I cannot claim it passed.

- [Ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-tl-irwb-037-c/ttmp/2026/11/27/IRWB-037-C--missed-optimizations-found-from-provenance/index.md)
- [Design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-tl-irwb-037-c/ttmp/2026/11/27/IRWB-037-C--missed-optimizations-found-from-provenance/design-doc/01-provenance-guided-optimization-design.md)
- [Measurement report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-tl-irwb-037-c/ttmp/2026/11/27/IRWB-037-C--missed-optimizations-found-from-provenance/reference/02-measurement-report.md)

Last commit: `c12395b`.