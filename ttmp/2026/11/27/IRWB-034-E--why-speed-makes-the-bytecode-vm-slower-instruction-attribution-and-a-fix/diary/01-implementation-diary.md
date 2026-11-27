---
Title: Implementation diary
Ticket: IRWB-034-E
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: diary
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/27/IRWB-034-E--why-speed-makes-the-bytecode-vm-slower-instruction-attribution-and-a-fix/report/01-final-report-the-attribution-the-fix-and-the-measurements.md
      Note: the final report with all measurement tables
ExternalSources: []
Summary: Step-by-step record of the attribution tool, the cause analysis and the loopsOf merge fix.
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: Read the brief and the compiler's records, write the design

**User prompt (verbatim):** "Your ticket is IRWB-034-E. ... (D1): why `speed`
makes the bytecode VM slower ... Find the cause from the compiler's own
records, not by guessing. ... Then fix it in the compiler ... The attribution
is a tool, not a one-off ... Measure and report."

**Assistant interpretation:** Research-and-implementation stage in one
session: attribution first, fix second, measurements and a report third;
the attribution must land as a callable function with a test.

**Inferred user intent:** The regression (fib 7,678 → 9,286, checksum 6,874
→ 8,218 at n = 12, seed = 8) must be explained by credit assignment over the
compiler's provenance records, fixed in the compiler (not by tuning the
project), and the attribution must be reusable by the next stage.

### What I did

- Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`,
  `src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`,
  `src/typed/passes.ts`, the IRWB-012 ticket, and the backend's
  `run.ts`/`image.ts` (per-instruction `counts`, `covers`, `heat`,
  correspondence).
- Created the ticket with docmgr; wrote
  `scripts/01-revision-steps.mjs` (per-revision emulator steps) and ran it.

### What worked

- `npm run build` clean; script 01 isolated the regression to the `licm`
  revision: +2,599 (fib) / +2,251 (checksum); every other published pass
  improved the program; `inline` and `rotate` published nothing.

### What didn't work

- First script run failed with `ERR_MODULE_NOT_MODULE`: the ticket's
  `scripts/` dir is six levels below the repo root, not three. Fixed the
  relative imports.

### What I learned

- The `speed` pipeline on this program is really "cfg, fold, cfg, licm,
  subst, subst, cfg": the interesting decisions are all in licm.

### Commit (code)

- `IRWB-034-E: design — the licm-per-back-edge preheader chain ...` (design
  doc, scripts 01-04, evidence).

## Step 2: The cause, from scripts 02-04

### What I did

- `scripts/02-licm-diff.mjs`: image diff r3 → r4 (`diffImages`), spill/frame
  facts, statement heat deltas through `covers`.
- `scripts/03-new-stmts.mjs`: the new statements' origins ("hoisted out of
  loop:runVm@bb:runVm.3", `inv = frame+0`, `inv1 = frame+16`, ...).
- `scripts/04-cfg.mjs`: `loopsOf` at r3 returns **nine** loops, all
  `loop:runVm@bb:runVm.3`, each with a different 4-11 block body, and every
  arm's back edge retargeted into the preheader chain at r4.

### What I learned

- `loopsOf` is per back edge; the dispatch loop has nine back edges after
  cfg; licm creates a preheader per sub-loop and retargets the *other*
  sub-loops' back edges into it (they are "outside" each sub-loop's body),
  so the preheader chain lies on the runtime cycle and the hoisted sets
  re-execute per dispatch (heat 184/160 each).
- Register pressure is the second cost, separable in the records: ten
  callee-saved saves/restores (+20 executed once), frame 32 → 80 bytes.

## Step 3: The attribution tool

### What I did

- `src/typed/attribute.ts`: `attributeSteps` / `attributeTransition` /
  `attributeOrigins` (see the report §2 for the method). Key design points:
  group-level credit over correspondence entries (exact under splits and
  merges; per-entity first-entry-wins under overlap), first-edit-wins
  assignment to decisions, `overhead` = measured delta − entry credits.
- `tests/typed/attribution.test.mjs`.

### What worked

- The account closed exactly on every transition of both fixtures:
  fib r4 +2,599 = +2,579 entries + 20 overhead; the 15 hoist inserts at
  +184 each and the preheader jump +184, against −341 of replaced arm work.
- `heat()`'s per-line walk (`linesOf`) made `attributeSteps` take 22 s;
  computing the per-statement map directly cut it to ~0.5 s per transition.

### What didn't work

- The first test version pinned the *buggy* build's numbers (delta 2,599,
  overhead 20, sixteen positive decisions); after the fix it failed, and I
  rewrote it to pin the fixed world (licm delta −306, hoist inserts at +1
  each) plus the invariant exactness assertions. Failure evidence: the
  `assert.ok(licm.delta > 2000)` lines failing with `actual: false`.

### Commit (code)

- `IRWB-034-E: attributeSteps/attributeOrigins — credit executed RV32
  instructions to pass decisions ...`.

## Step 4: The fix

### What I did

- `src/typed/analyses.ts` `loopsOf`: gather back edges per header, one
  merged loop per header (body = the predecessor closure from all latches,
  assigned = union, latch = first back edge's source, unique id).
- Considered and rejected: a licm-only guard (leaves nine wrong bodies and
  the duplicate id in the facts every pass sees); a licm cost check for
  one-instruction hoists (unnecessary after the merge — held under Later).

### What worked

- bytecode-vm under checked `speed`: r4 licm is now a net win (−306/−258);
  final 6,382/5,710 vs r0 7,678/6,874; O2 equal (its licm had the same
  bug before: 9,286/8,218).

### What didn't work

- `scripts/09-multi-back-edge.mjs` (r0-only scan for affected programs)
  found nothing: the dispatch loop is a single natural loop at r0 and only
  becomes multi-back-edge after cfg. The corpus sweep found regex-nfa
  instead.

### Commit (code)

- `IRWB-034-E: merge same-header natural loops in loopsOf ...`.

## Step 5: Measurement, parity, tests, report

### What I did

- `scripts/08-corpus-instructions.mjs`: all 47 projects × {O2, speed},
  before (stashed fix, rebuilt) and after; outputs committed
  (`output-08-before.txt`, `output-08-after.txt`).
- `scripts/10-headline.mjs`: per-case r0/O2/speed before and after, with
  the checked pipelines.
- `node tools/parity.mjs bytecode-vm` (6 revs, 100/100) and `regex-nfa`
  (11 revs, 100/100).
- `tests/typed/*.test.mjs` (32 files, 0 fail), `tests/framework` +
  `tests/workbench` (0 fail), `node tools/build-site.mjs` (builds).

### What worked

- Corpus totals: O2 1,124,912 → 1,107,836; speed 892,944 → 877,151;
  without bytecode-vm: O2 1,077,836 → 1,075,211, speed 845,868 → 844,526.
  Only bytecode-vm (47,076 → 32,625) and regex-nfa (improved) changed;
  `my-analysis` unchanged (one limit-hitting case on both sides).

### What didn't work

- The first sweep draft ran the meaning contract per pass; chess-search +
  sha-chacha alone took 5m18s, and `check: false` saved almost nothing
  (the passes' own analyses dominate). Kept `check: false` for the sweep on
  both sides (kernels are deterministic; the contract only gates) and
  validated the checked pipelines separately.

### What warrants a second pair of eyes

- The `overhead` bucket's exactness relies on first-entry-wins when a
  correspondence shares an entity between entries; the sum stays exact by
  construction, but which entry carries a shared entity's heat is
  order-dependent in that (so far unobserved) case.

### Code review instructions

- Start at `src/typed/attribute.ts` and `loopsOf` in `src/typed/analyses.ts`,
  then `tests/typed/attribution.test.mjs`. Reproduce the headline numbers
  with `node scripts/10-headline.mjs` (from the ticket's `scripts/`), the
  attribution tables with `node scripts/06-attribution.mjs`, and the sweep
  with `node scripts/08-corpus-instructions.mjs`.
