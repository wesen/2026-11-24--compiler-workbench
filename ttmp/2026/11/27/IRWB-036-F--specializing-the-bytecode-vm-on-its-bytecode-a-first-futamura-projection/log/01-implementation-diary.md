---
Title: Implementation diary
Ticket: IRWB-036-F
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary of IRWB-036-F: design, buffer bindings, BTA, pe, promote, webs, measurements."
LastUpdated: 2026-11-27T10:05:52.936137268-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: the brief, the r0 IR, the design

The task (from the coordinator's brief `IRWB-036-F.md`, B1): specialize the bytecode VM on its bytecode, with a
constant-buffer promise checked like the field binding, a binding-time analysis through loads from that buffer,
dispatch-loop specialization on a known pc, and measurements against the hand-specialized 75 and 74
instructions.

`scripts/01-listing.mjs` printed r0 of `runVm`: dispatch head `bb:runVm.1`, the fetch through
`load16[caddr(code, pc)+4]`, the `opcode == k` chain, and frame-array stack/locals behind explicit
`>=u 4` checks. The design (`design-doc/01-...`) was committed as ed19438 before any code.

## Step 2: buffer bindings, the BTA and pe; first measurement

Extended `typed.bindings` with `cells`, `Program.assume` with `{ cells }`, and wrote `pe.ts` and `promote.ts`.
Probe: `npx tsc` resolves through the parent repository's node_modules (the worktree has none); the build works.

First run of `scripts/02-specialize.mjs`: pe 40/40 on both entries, 20 and 18 variants, but only 7,678 → 684
and 6,874 → 556 instructions. The listing showed why: `t17 = frame+0; store32[t17+0] = ...`. Frame addresses
were dynamic in the BTA, so every stack access went through a residual local and `promote` refused.

Fix: a second static kind `f` (frame address with static offset) for locals not live into the entry. Result:
164 and 139 instructions, every access promoted, but the stack slot `frame0` had many definitions, so `subst`
could not forward it.

## Step 3: webs, and the frame area

Wrote `webs.ts` (live-range splitting by reaching definitions). With `webs` before `speed`: 77 and 89; with a
second `webs` + four `subst`: 77 and 77. The remaining 2 to 3 instructions against the hand-written loops were
the frame setup: `promote` had removed every access but `arrayBytes` stayed. Deleting it changes the `fn`
entity, which no write kind covered (`undeclaredWrite` would refuse it), so I added a write kind `frame`.
Result: 74 and 74, 36 bytes each. Commit 5831309.

## Step 4: tests, budget, what stops it

The first budget counted both statements and visited blocks, so the smallest working budget was 244 (blocks
walked), not the residual size. Split: the budget counts residual statements (default: the function's own 123
statements), and a separate walk bound (blocks in the function) catches header-less cycles. Smallest budgets
now 42 and 40 (`scripts/03-measure.out`).

`scripts/04-what-stops.mjs`: code bound without the entry is a loss (111 variants, 9,821 / 8,705 instructions,
2,364 B with a 4096 budget; refused by default); a push loop becomes one `trap`; a static counter under a
dynamic exit hits the budget; a program writing the buffer elsewhere is refused.

The constant-position test failed first: the default front end lifts `charCodeAt` to an explicit length check
plus `load16[(b + (t1 << 1))+4]`, not `caddr`. `bufferLoad` now recognizes that form and its folded forms
(`b + 2k`, `load16[b + 4 + 2k]`). Commit 743152c.

## Step 5: suites, Prettier, report

Prettier on the files that were formatted at the base (specialize.ts, passes.ts, tx.ts) and the new ones; not on
program.ts (unformatted at the base). Ran `tests/typed`, `tests/framework`, `tests/workbench` (result below).
Wrote `reference/01-final-report-...`.
