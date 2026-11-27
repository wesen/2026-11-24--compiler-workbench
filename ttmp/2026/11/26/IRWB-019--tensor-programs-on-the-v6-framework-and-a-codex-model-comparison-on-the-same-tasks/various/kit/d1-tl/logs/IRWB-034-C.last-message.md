The investigation identified a likely cause and produced a candidate fix, but **IRWB-034-C is not complete**. The full corpus comparison, parity check, and required test suites remain unverified, so I cannot claim the no-regression requirement is met.

For the bytecode VM at `n = 12, seed = 8`, the measured Fibonacci/checksum instruction counts were:

| Revision | Before candidate fix | After candidate fix |
|---|---:|---:|
| r0 | 7,678 / 6,874 | 7,678 / 6,874 |
| `speed` | 9,286 / 8,218 | 6,688 / 5,968 |

LICM accounts for the increase between the measured revisions: it hoists frame-array addresses into locals, hiding the address form that the backend can fold into stack-relative loads and stores. For Fibonacci, instructions labeled “frame array” rose from 342 to 2,749. The candidate guard keeps those addresses visible to the backend. No framework files were changed.

A reusable attribution prototype and focused test are in the worktree; the focused test passed. Its credits identify the latest recorded decision for each instruction, while revision comparisons establish the measured cost. Corpus totals and the requested O2 comparison are not yet complete.

The [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-tl-irwb-034-c/ttmp/2026/11/27/IRWB-034-C--attribute-and-fix-bytecode-vm-speed-regression/index.md), [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-tl-irwb-034-c/ttmp/2026/11/27/IRWB-034-C--attribute-and-fix-bytecode-vm-speed-regression/design-doc/01-attribution-and-cost-decision-design.md), and [preliminary report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-tl-irwb-034-c/ttmp/2026/11/27/IRWB-034-C--attribute-and-fix-bytecode-vm-speed-regression/reference/02-final-report.md) contain the evidence and remaining work. The design is committed as `83b1522`; the candidate implementation, scripts, and preliminary report remain uncommitted.