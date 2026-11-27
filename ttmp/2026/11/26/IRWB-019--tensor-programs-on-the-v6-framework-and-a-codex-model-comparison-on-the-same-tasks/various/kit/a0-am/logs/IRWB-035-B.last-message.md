Across all 50 corpus projects, local rewrites accounted for **10.0% of O2 edits** and **4.2% of `speed` edits**. Even when counting only value-field replacements, the local shares were 40.2% and 35.9%. The corpus does not support programme A’s majority hypothesis.

| Pipeline | Edit records | Local | Structural | Other | Local share of executions at edited statements |
|---|---:|---:|---:|---:|---:|
| O2 | 2,021 | 10.0% | 69.9% | 20.0% | 23.0% |
| `speed` | 9,736 | 4.2% | 83.5% | 12.3% | 11.3% |

**No local edit carried a complete verified-rule citation.** Existing verified rules nevertheless reproduced **183/203 O2 local edits (90.1%)** and **362/408 `speed` local edits (88.7%)**. Two guarded rules cover the remainder: division and remainder by a positive power of two when the dividend is nonnegative. A proof would also need to establish that range condition.

The instruction measure counts executions at affected statements on both sides of each edit. Eleven generated calls hit the emulator limit and yielded no counters.

The callable classifier required **no framework changes**. The build succeeded. The requested test groups had **409 passes, zero failures and three opt-in skips**. The worktree is clean at `0989c2da642a14f7af37890c0d78978be0fcba47`.

[Ticket](ttmp/2026/11/27/IRWB-035-B--local-value-rewrites-in-o2-and-speed/index.md) · [Design](ttmp/2026/11/27/IRWB-035-B--local-value-rewrites-in-o2-and-speed/design-doc/01-counting-local-rewrites.md) · [Final report](ttmp/2026/11/27/IRWB-035-B--local-value-rewrites-in-o2-and-speed/analysis/01-corpus-results.md) · [Per-pass and per-project tables](ttmp/2026/11/27/IRWB-035-B--local-value-rewrites-in-o2-and-speed/analysis/02-measurement-tables.md)