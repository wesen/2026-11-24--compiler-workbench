Closed [IRWB-037-A](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-sm-irwb-037-a/ttmp/2026/11/27/IRWB-037-A--missed-typed-optimizations-from-instruction-provenance/index.md). The [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-sm-irwb-037-a/ttmp/2026/11/27/IRWB-037-A--missed-typed-optimizations-from-instruction-provenance/design-doc/01-find-missed-optimizations-from-hot-rv32-code.md) was committed first. The [report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-sm-irwb-037-a/ttmp/2026/11/27/IRWB-037-A--missed-typed-optimizations-from-instruction-provenance/reference/02-measurements-and-results.md) contains all 50 project rows and the checked ablations.

- **Fixed-bound elimination** saved 346 instructions on default regex `speed` and 11,347 on tuned LZ `speed`.
- **`horner31-mask15`** saved another 3,648 instructions on tuned LZ. The repository verifier proved the rewrite modulo 16 and checked 1,110,592 boundary and randomized assignments.
- **Attribution** now ranks executed final sites, including sites with no credited reduction. No framework code changed. The late LVN experiment hit a stale value ID on regex and was left out.

| RV32 workload | Before | After | Reference |
| --- | ---: | ---: | ---: |
| Regex `speed`, default | 6,933 | 6,587 | 6,628 |
| LZ `speed`, tuned | 156,782 | 141,787 | 156,405 |
| Chess `speed`, tuned | 10,038,193 | 10,038,193 | 10,827,760 |
| Corpus O2, default | 863,730 | 855,692 | 650,657 |
| Corpus `speed`, default | 649,282 | 640,638 | 650,657 |
| Corpus O2, tuned | 806,326 | 801,162 | 650,657 |
| Corpus `speed`, tuned | 576,822 | 570,939 | 650,657 |

Four corpus projects improved and none regressed in the measured runs. The build and all three requested test groups passed, with 415 tests passing and 3 opt-in skips. Parity and both reference checks agreed on all 8,286 decided cases.

Final commit `e46c0425bfdea594f64d1bc6cf65503098f14071`.