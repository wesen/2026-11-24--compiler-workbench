# Changelog

## 2026-11-26

- Initial workspace created

## 2026-11-26

Research design written: seven rules (inline, factor-const, split-index, nest-max, exp-shift, nest-sum, fold-intro) deriving the streaming form in thirteen checked applications; the fold construct with reals and f32 semantics; checking per rule (recorded exact argument + exact or tolerance differential gate, epsilon calibrated from P0's measured f32 error); generality boundaries; falsifiable GB10 experiment. Probe numbers corrected against the saved evidence before publication (factor-const drift 2.6x mixed, streaming steps +1.26x on top of P2).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1b-g-max-irwb-021-s/ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/design-doc/01-research-design-deriving-streaming-attention-by-checked-rewrites.md — the research design document
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r1b-g-max-irwb-021-s/ttmp/2026/11/26/IRWB-021-S--deriving-streaming-attention-by-checked-rewrites-flashattention-from-plain-tix/various/01-probe-results.txt — the probe evidence the document cites

## 2026-11-26

Ticket complete (research design, no implementation): commits ececfbd (ticket, diary, probe with controls) and 7313a6e (design document, bookkeeping). Deliverables: design-doc/01, log/01-research-diary.md (5 steps), scripts/01-numeric-probe.mjs + various/01-probe-results.txt (80 configurations, 8 sanity checks pass, 3 negative controls rejected).
