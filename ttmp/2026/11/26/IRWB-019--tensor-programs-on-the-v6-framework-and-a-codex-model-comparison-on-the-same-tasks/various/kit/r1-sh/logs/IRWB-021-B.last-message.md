[IRWB-021-B ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sh-irwb-021-b/ttmp/2026/11/26/IRWB-021-B--deriving-streaming-attention-by-checked-rewrites/index.md) · [Research design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sh-irwb-021-b/ttmp/2026/11/26/IRWB-021-B--deriving-streaming-attention-by-checked-rewrites/design-doc/01-research-design-for-deriving-streaming-attention.md) · [Diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1-sh-irwb-021-b/ttmp/2026/11/26/IRWB-021-B--deriving-streaming-attention-by-checked-rewrites/reference/01-diary.md)

1. **Pull out the divisor** — divide once after the weighted sum.
2. **Pack aligned sums** — accumulate the normalizer and weighted numerator in one tuple fold.
3. **Localize the exponential center** — merge singleton summaries, rescaling both sums to the current maximum.
4. **Partition the key fold** — regroup the singleton fold into ordered blocks of 32 keys, including the tail.
5. **Compute one summary per block** — use the block maximum to compute its normalizer and weighted numerator.
6. **Inline the tile producers** — compute scores in tile-local storage and remove the dead global score tensor.

Ticket validation passed. The GB10 experiment remains to be run.

Commit `bdcd6bad780973d4c8185ff082e7c8428668df89`