---
Title: 'B1: specializing the bytecode VM on its bytecode — report'
Ticket: IRWB-036-E
Status: active
Topics:
    - compiler
    - ir
    - performance
    - specialization
DocType: report
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/peval.ts
      Note: the peval pass (regions, memo, invalidation, peeling)
    - Path: repo://src/typed/bindings.ts
      Note: the buffer promise and its check
    - Path: repo://src/typed/program.ts
      Note: assume() restricted by a buffer promise
    - Path: repo://tests/typed/peval.test.mjs
      Note: the checks this report cites
    - Path: repo://ttmp/2026/11/27/IRWB-036-E--b1-specializing-the-bytecode-vm-on-its-bytecode-first-futamura-projection/scripts/02-peval-vm.mjs
      Note: the measurement: r0 / speed / peval / peval+speed / hand, exhaustive
    - Path: repo://ttmp/2026/11/27/IRWB-036-E--b1-specializing-the-bytecode-vm-on-its-bytecode-first-futamura-projection/scripts/04-per-trip.mjs
      Note: the per-trip fit: instructions = overhead + n·perTrip
ExternalSources: []
Summary: 'Results of IRWB-036-E: automatic specialization (peval + speed) runs the Fibonacci fixture in 76 RV32 instructions against the hand-specialized 75 (r0: 7,678) and the checksum in 81 against 74 (r0: 6,874); per trip the specialized loops are identical to the hand loops (5.90 vs 5.97). All 442 domain cases agree with the oracle on the evaluator and on RV32, gated by the meaning contract.'
LastUpdated: 2026-11-27T00:00:00Z
WhatFor: Judging how much of the 100x gap between the general VM and the hand-specialized loops automatic specialization closes.
WhenToUse: Reviewing the peval pass, the buffer promise, or the measurements.
---

# Report: specializing the bytecode VM on its bytecode

## 1. The headline

At n=12, seed=8, backend `coalesce: true` (the same options as IRWB-012's table):

| Fixture (guest instr.) | r0 | speed | peval | **peval + speed** | hand |
|---|---:|---:|---:|---:|---:|
| Fibonacci (184) | 7,678 | 9,286 | 116 | **76** | 75 |
| Checksum (160) | 6,874 | 8,218 | 178 | **81** | 74 |
| image bytes | 840 | 904 | 268 | **160** | 76 |

Automatic specialization closes the gap to the hand-specialized loops to **1.01x (fib)** and **1.09x
(checksum)**, a 101x / 85x speedup over r0. Note `speed` alone is *slower* than r0 here (IRWB-012's finding);
every gain below comes from the specialization. The cost in code size: 160 bytes for both fixtures in one
function, against 76 bytes for one hand-written fixture — 5.3x smaller than r0's 840 bytes, and the residual
serves both entries.

A least-squares fit over n = 0…12 (`instructions = overhead + n·perTrip`, scripts/04):

| entry | peval per trip | hand per trip | peval overhead | hand overhead |
|---|---:|---:|---:|---:|
| 0 (fib) | 5.90 | 5.97 | 4.8 | 3.3 |
| 34 (checksum) | 6.00 | 5.97 | 9.0 | 2.3 |

**The steady-state loops are the hand loops** — 5.90 vs 5.97 instructions per trip; the final listing is
statement-for-statement the hand code (`next = a + b; a = b; b = next; remaining = remaining - 1`, guarded by
`if (remaining == 0)`). The whole remaining difference is *overhead*: the peeled first trip (one region per
loop, since the first trip runs with `locals[2] = 0` folded while later trips are dynamic) and the residual
entry dispatch (`entry == 0 … else entry == 34 … else trap`), which the hand version does not pay because it is
two separate functions called by the host directly.

## 2. What was built

1. **A buffer promise** (`src/typed/bindings.ts`): a `typed.bindings` binding of the new buffer form
   `{fn, param, cells}` — "`runVm`'s `code` always holds these 64 cells." Checked exactly as the field binding
   is checked: the pass refuses if any store's address tree touches the bound parameter. `Program.assume`
   learns the form and fixes that parameter's input spec to `{cells}`, so the meaning contract generates cases
   only on the promised bytes (tested on a project whose spec leaves the buffer free).
2. **The `peval` pass** (`src/typed/peval.ts`, whole-program like `dfe`): a polyvariant abstract trace over the
   original blocks. Its binding-time analysis propagates the promise through `caddr`/`load16u` chains: the fetch
   folds, the dispatch folds, the operand folds, the capacity check is evaluated against the promised length
   (a position that would trap residualizes a `trap`). IR locals hold constants, pending value ids or their own
   slots; frame-array words ("cells") hold constants, pending ids or fresh locals. Regions end at memo hits
   (loops close), dynamic conditions (arms cut) or return/trap; arrivals that differ peel instead of merging.
   The entry is split on the `oneOf` input spec — the *same* domain the contract generates cases from, so the
   specializer never claims more than the check enforces; other entries trap.
3. Everything is ordinary machinery: the pass is gated by `optimizationContract` (`40/40` on the promised
   domain), its entities carry `origin.from` + `because: fact:typed.bindings@…#…` so `why` walks the residual
   to the outer fact, `revisionCorrespondence` groups it, and the writes declaration is enforced on the diff.

## 3. The checks

- **Gated pass**: `p.apply('peval')` under the meaning contract — 40/40 generated cases agree with r0
  (the gate earned its keep: it rejected the first three residual bugs, see the diary).
- **Exhaustive domain**: all 442 valid calls (2 entries × n ∈ 0…12 × seed ∈ −8…8) agree with the independent
  JS oracle on the evaluator *and* on RV32 images for r0, `speed`, `peval`, `peval+speed` (scripts/02); the
  test repeats the evaluator differential and RV32 spot checks.
- **The domain claim is explicit**: an entry the promise does not list (30, which runs `LOAD 2; HALT` and
  returns 0 at r0) traps in the residual — the unrestricted invariant fails, the restricted one passes. The
  specialization means r0 *only* on the promised inputs, exactly like a scalar binding.
- **Refusal paths**: a binding naming a missing parameter; a store through the bound buffer; no promised entry
  domain (nothing to fold / budgets exceeded) — all leave the program unchanged with the reason recorded.

## 4. What stops the specialization, and where it falls short

- **The peeled trip and the entry dispatch** are the entire remaining gap (§1): 76 vs 75 and 81 vs 74. The
  peel is a *choice* (more precise than demotion, which measured 8 register moves a trip); the dispatch is
  the price of one function serving both fixtures.
- **Outside the domain, nothing**: the residual traps rather than interprets. A host wanting full generality
  keeps r0 and dispatches, or promises more entry values (the budget allows 8).
- **The supported input domain is explicit and narrow** (documented in the pass): i32 statements and values,
  word-aligned frame accesses, no calls, f32 or records — anything else skips the function unchanged. Calls
  are what IRWB-007's Candela needs; that is the next ticket's work, not this one's.
- **Budgets refuse, never truncate**: 256 regions / 4096 traced blocks / 2048 residual statements. A bytecode
  program without loops would unroll fully inside them; larger ones are left alone.

## 5. Framework changes, each with its reason

No `src/framework/` changes were needed. All changes are in `src/typed/` (+ tests):

| change | reason |
|---|---|
| `src/typed/bindings.ts` (new): buffer binding form, `BindingsIR` v1 validation, `checkBufferBinding` | the promise and its check, shared by `specialize` and `peval`; a separate module breaks the `passes ↔ specialize` import cycle the pass's registration would otherwise close |
| `src/typed/peval.ts` (new): the `peval` pass | the specialization itself; built by `makePeval(correspond)` like `makeInline`, for the same cycle |
| `src/typed/specialize.ts`: buffer bindings validated (write check), helpers moved to bindings.ts | "checked as the field binding is checked"; no duplication |
| `src/typed/program.ts`: `assume` fixes a buffer parameter's input spec | the contract must restrict cases to the promised bytes, as for scalar bindings |
| `src/typed/passes.ts`: `peval` registered | so `p.apply('peval')`, the workbench and strategies can name it |
| `tests/workbench/strategies.test.mjs`: pass count 15 → 16 | the catalogue grew by one pass |

## 6. Approaches tried

- **Demotion restart** (the committed design's fixpoint): worked, but with no exact cell liveness it demoted
  the dead stack cells too — 162/141 instructions. Replaced by peeling (§1): 76/81.
- **Runtime promise check** (a checksum of the buffer before entering): rejected without measuring — it costs a
  pass over the buffer per call, more than the whole residual loop, to defend against inputs the contract
  never generates. The static write-check plus the restricted contract is the enforcement, on the same
  principle as scalar and field bindings.
- **Materialize-all at cuts** vs **defer-to-cut for unread locals**: kept defer (measured: it is what removes
  the operand stack from the residual).
- **Constprop with a constant-memory fact**: rejected in the design already — a load at a dynamic address
  cannot fold without the pc trace; the dispatch would survive.

## 7. Measured vs argued

Measured: everything in §1 (RV32 emulator instruction counts and image bytes over the exhaustive domain, and
the per-trip fits), the 442-case agreement on evaluator and RV32, the contract's 40/40, the refusal paths
(tests), the restricted-vs-unrestricted domain stance, the demotion cost (162/141 before peeling).
Argued, not measured: the runtime-check cost (order-of-magnitude argument in §6); that 256 regions cover
"several hundred cells" (the corpus VM uses 13; no larger fixture exists to measure); the claim that calls
would need the IRWB-007 machinery (no call-bearing interpreter is in the corpus).

## 8. Reproduce

```
npm run build
node --test tests/typed/peval.test.mjs
node ttmp/2026/11/27/IRWB-036-E--*/scripts/02-peval-vm.mjs   # the tables in §1
node ttmp/2026/11/27/IRWB-036-E--*/scripts/04-per-trip.mjs   # the fits in §1
```
