---
Title: 'B1: specializing the bytecode VM on its bytecode — implementation diary'
Ticket: IRWB-036-E
Status: active
Topics:
    - compiler
    - ir
    - performance
    - specialization
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/peval.ts
      Note: the peval pass: abstract state, regions, memo, invalidation
    - Path: repo://src/typed/bindings.ts
      Note: the typed.bindings artifact and the buffer-promise check, shared by specialize and peval
    - Path: repo://tests/typed/peval.test.mjs
      Note: gated specialization, exhaustive domain check, refusal paths
    - Path: repo://corpus/projects/bytecode-vm/main.typed
      Note: the interpreter that was specialized
ExternalSources: []
Summary: 'Implementation diary for IRWB-036-E: the buffer binding, the peval pass, the four residual bugs the meaning contract and the exhaustive checks caught, and the measurements.'
LastUpdated: 2026-11-27T00:00:00Z
WhatFor: ''
WhenToUse: ''
---

# IRWB-036-E implementation diary

## Step 1 — Read the ground (scripts/01-vm-ir.mjs)

Dumped `runVm` at r0: the fetch is `load16[caddr(code, pc)+4]` (the `+4` is the
load's `imm`, learned the hard way in step 4), `stack` at frame+0 and `locals`
at frame+16, `sp`/`pc` locals, one back-edge. 142 statements, 32-byte frame
array. Read `define-pass.ts`, `inline.ts` (the whole-function rewrite
precedent), `tx.ts`, `specialize.ts`, `program.ts`, `evaluate.ts`
(cases/`meaningKept`), IRWB-007's guide (the binding-time analysis that bounds
Candela gains; its "polyvariant or nothing" conclusion shaped the entry
split), IRWB-012's measurements.

## Step 2 — Design committed (d74f9f6)

Design written before implementation: buffer promise checked like a field
binding, polyvariant trace with memo/liveness/demotion, residual as checked
TypedBlocks. All of that survived except demotion (step 6).

## Step 3 — The binding plumbing

- `src/typed/bindings.ts` (new): `Binding` gains the buffer form
  `{fn, param, cells}`; `BindingsIR.validate` accepts it; `checkBufferBinding`
  refuses when a store's address tree touches the bound parameter (shared by
  `specialize` and `peval`). Lived first in `specialize.ts`; moved out when
  `passes → peval → specialize → passes` became an import cycle (the same
  cycle `inline.ts` documents; fixed the same way: `makePeval(correspond)`).
- `Program.assume` learns the buffer form: the parameter's input spec becomes
  `{cells}`, so a host whose spec leaves the buffer free still gets a contract
  restricted to the promised bytes (tested: a project whose `code` input is
  unspecified).

## Step 4 — First trace, four bugs (the meaning contract earned its keep)

The first residual was rejected by the gate (`38/40 disagree`), then debugged
with `check:false` (scripts/03) against r0 on single cases:

1. `load16[caddr(code,pc)+4]` never folded: the `+4` is the load's `imm`, not
   an `add` node (lift.ts encodes the byte offset in the value).
2. The binary-operator fallback re-walked the *source* tree, re-materializing
   loads that had already folded; the fallback now builds from the evaluated
   abstract arguments.
3. `t18 = frame+16 + operand*4` sets a local to an address: locals can hold
   folded addresses (tracked abstractly, materialized at cuts).
4. The real one: a store to a cell that lives in a local must write the local
   (after invalidating pending readers), or the local goes stale and the
   loop condition tested the decremented counter — fib returned 8 instead of
   4, checksum agreed. With the store rule in place both agreed on all 442
   domain cases.

Each fix was found by reading the residual listing against the expected
Fibonacci dataflow, not by guessing.

## Step 5 — The stack cells cost 8 moves a trip; defer to the cut

With correctness done, the first gated measurement (7be0219): fib 162, checksum
141 (hand: 75/74). The residual routed every push and pop through the stack
cells' locals (`pe.m0 = …`). Fix: a store to a cell in a local is emitted
immediately only when some pending value reads that local; otherwise it is
deferred to the cut, where the pending id becomes a `set` anyway, and the sets
nobody reads die at `dce`. A `set` is emitted only when the *residual* tree has
an effect — checking the source tree kept folded stack reads as memory loads.
`invalidate` became recursive (materializing a value overwrites its local in
turn, so its readers go first; cycles refuse).

## Step 6 — Demotion → peeling (design revision)

The design's demotion-restart (loop-varying constants forced into locals)
would also have demoted the dead stack cells — no exact cell liveness to hand —
measured as ~8 register moves per trip. Dropped: two arrivals that differ on a
cell are different memo keys, so the pass traces the second as its own region.
That peels the first trip off each loop (the fib first trip runs with
`locals[2] = 0` folded) and the steady loop closes on itself. Simpler and
strictly more precise; termination is the budgets, not the fixpoint.

## Step 7 — Measurements (scripts/02, 04)

All 442 domain cases agree across r0, speed, peval, peval+speed and the
independent oracle, on the evaluator and on RV32. See the report for the
tables; the headline: fib 7,678 → 76 (hand 75), checksum 6,874 → 81 (hand 74);
per-trip 5.90 vs the hand's 5.97 instructions — the steady loops are the hand
loops, the remaining overhead is the peeled trip and the two-entry dispatch.

## Step 8 — Tests and suites

`tests/typed/peval.test.mjs`: the gated specialization (`40/40`), the
exhaustive evaluator differential (442 cases), RV32 spot checks, the `why`
chain reaching the outer fact, the restricted-domain stance (an entry the
promise does not list: r0 returns 0, the residual traps, so the unrestricted
invariant fails), the input-spec restriction, and the refusal paths (bad
parameter name; no promised entry domain). `tests/typed` 157 tests green
(2 transient worker-spawn cancellations once, 0 on rerun), `tests/framework`
234 green, `tests/workbench` green after updating the pass count (15 → 16);
`tools/build-site.mjs` builds.
