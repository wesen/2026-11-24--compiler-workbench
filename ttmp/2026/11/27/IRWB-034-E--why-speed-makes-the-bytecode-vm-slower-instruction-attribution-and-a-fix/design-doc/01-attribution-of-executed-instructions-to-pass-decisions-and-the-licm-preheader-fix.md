---
Title: Attribution of executed instructions to pass decisions, and the licm preheader fix
Ticket: IRWB-034-E
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/analyses.ts
      Note: loopsOf returns one natural loop per back edge; the fix merges loops that share a header
    - Path: repo://src/typed/passes.ts
      Note: the licm pass body that creates preheaders and hoists
    - Path: repo://src/typed/backend/run.ts
      Note: per-instruction execution counts (covers -> heat) the attribution is built on
    - Path: repo://src/typed/program.ts
      Note: revision chain with edits and correspondences the attribution walks
    - Path: repo://corpus/projects/bytecode-vm/
      Note: the project the speed pipeline makes slower
ExternalSources: []
Summary: Why speed makes the bytecode VM slower, a reusable attribution tool that credits executed instructions to pass decisions, and the compiler fix.
LastUpdated: 2026-11-27
WhatFor: ""
WhenToUse: ""
---

# Attribution of executed instructions to pass decisions, and the licm preheader fix

## The problem, from the compiler's own records

Script `scripts/01-revision-steps.mjs` lowers every revision the `speed`
pipeline publishes on `bytecode-vm` to an RV32 image and runs both fixtures
(`n = 12, seed = 8`, entries 0 and 34) on the emulator. The pipeline publishes
seven revisions; the step counts per revision are:

| rev | pass | fib | checksum |
| --- | --- | ---: | ---: |
| r0 | ingest | 7,678 | 6,874 |
| r1 | cfg | 7,055 | 6,287 |
| r2 | fold | 6,871 | 6,127 |
| r3 | cfg | 6,688 | 5,968 |
| r4 | licm | 9,287 | 8,219 |
| r5-r6 | subst ×2 | 9,287 | 8,219 |
| r7 | cfg | 9,286 | 8,218 |

The whole regression is the `licm` revision: +2,599 executed instructions on
Fibonacci and +2,251 on checksum. The other passes only improve the program.
(The two `inline` passes and `rotate` publish nothing: the program has one
function and no rotatable header.)

## Why licm makes it slower

`typed.loops` (`loopsOf`, src/typed/analyses.ts) reports **one natural loop per
back edge**. The dispatch loop (`while (true)` over an if/else-if chain on the
opcode) has nine arms that jump back to the same header, so `loopsOf` returns
nine loops with the same head `bb:runVm.3`, the same id
`loop:runVm@bb:runVm.3`, and bodies that each exclude the other arms
(script `04-cfg.mjs`).

`licm` iterates over those nine loops. For each it creates a preheader (none of
the sub-loops has one) and retargets every predecessor of the head that is
outside *that sub-loop's body* — which includes the other arms' back edges —
into it. The nine preheaders chain (`n0 → … → n8 → head`), and every back edge
of the real runtime cycle now points into the chain. The "hoisted" code
therefore re-executes on **every dispatch**: the emulator's per-instruction
counts, attributed to statements through the image's `covers`, show each
hoisted `set` (the frame-array base addresses `inv = frame+0`, `inv1 =
frame+16`, …) running 184 times on Fibonacci and 160 times on checksum — once
per guest instruction — instead of once (script `02-licm-diff.mjs`).

Two costs follow from the same decision, and the attribution separates them:

1. **Re-execution.** The hoisted statements run once per dispatch instead
   of once: the statement-level heat deltas (script `02`) account for the
   bulk of the regression; the exact split comes out of the attribution tool
   below.
2. **Register pressure.** The fourteen new `inv` locals are live across the
   whole loop: the image grows from 206 to 226 instructions, the frame from 32
   to 80 bytes, ten callee-saved registers (`s1`-`s10`) are now saved and
   restored in the prologue/epilogue, and 15 new `addi … why: 'frame array'`
   address computations appear. The backend executes 23 instructions that
   cover no statement (up from 3): +20 per call from the saves/restores alone.

Hoisting was semantically sound (the hoisted values are pure `aaddr`
constants), which is why the meaning contract accepted the revision: the pass
is moving pure code onto the hot path, and nothing in the current framework
prices that.

## The attribution tool

`src/typed/attribute.ts` exports `attributeSteps(program, case)`, a function
other code (the workbench, the next stage's provenance-driven missed-optimization
search) can call on any `Program` whose revision chain is published:

- For each revision transition it lowers both revisions with the same backend
  options, runs both images on the emulator with per-instruction counts, and
  attributes the counts to statements through the image's `covers` (the
  existing `heat`).
- It maps each statement of the later revision back to the earlier revision's
  statement through the transition's **correspondence** (the `from → to` group
  entries the pass recorded), so the delta of a surviving statement, the cost
  of a removed one and the cost of a created one are all per statement. This
  follows an instruction's history through several passes, not just one.
- It credits each statement delta to the **edit** that made it (insert /
  replace / remove edits name statement ids; the correspondence entries carry
  the pass's `note` and `because`), producing a decision table per transition.
- The residual — executed instructions covering no changed statement, i.e.
  saves, spills and frame code the backend added or removed because of the
  pass's register pressure — is reported per transition as `overhead`, not
  lost. The transition's total delta is exactly `after.steps − before.steps`
  from the emulator, so the split is checked against the emulator's own counts.

A second view, `attributeOrigins`, credits every instruction executed by the
head image to the pass that last produced its covering statement (via the
origin records' `via`/`rev`), for provenance questions of the form "who made
what I am executing".

`tests/typed/attribution.test.mjs` covers both views on `bytecode-vm`: the
deltas sum to the emulator's totals, and the licm transition is credited to
its hoist edits.

## The fix

**Merge natural loops that share a header** in `loopsOf` (union of bodies,
union of assigned locals, one id per header, preheader = the unique outside
predecessor with a single successor). This is the textbook treatment of
multi-back-edge loops; per-back-edge loops with the same header are a
degenerate representation that every consumer must re-deduplicate (`rotate`
already does, via `done`).

With one loop, licm's preheader for the dispatch loop is the entry block
itself (its only outside predecessor), so the hoisted sets run once, no back
edge is retargeted, and the preheader chain never touches the cycle.

Alternatives considered:

- *A guard in licm only* (never retarget an edge that is a back edge of
  another same-head loop): fixes this program but leaves nine loops with one
  id and bodies that are each wrong for code motion (a value invariant in all
  nine is hoisted nine times, once per sub-loop). Rejected.
- *A cost check in licm* (do not hoist a value the backend can rematerialize
  for one instruction, like `aaddr`): the right second line of defense, kept
  out of this change unless measurement after the merge still leaves the VM
  above r0; hoisting one `addi` is at best a wash and at worst the register
  pressure seen above.

The fix must hold: bytecode-vm under `speed` at or below r0's instructions,
no regression in the corpus totals of the other projects under O2 and `speed`,
parity clean.

## Measurement plan

1. `scripts/01-revision-steps.mjs` — per-revision step counts (before/after).
2. `scripts/05-corpus-instructions.mjs` — per-project emulator instructions
   under O2 and `speed` (seeded cases, `measure`'s protocol), before and after
   the fix, with corpus totals.
3. `node --test tests/typed/*.test.mjs tests/framework/*.test.mjs
   tests/workbench/*.test.mjs`, `node tools/parity.mjs bytecode-vm`.
