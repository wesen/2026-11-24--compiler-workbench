---
Title: 'Final report: specializing the bytecode VM'
Ticket: IRWB-036-F
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Automatic specialization of the bytecode VM on its code image and entry reaches 74 and 74 RV32 instructions (hand-written 75 and 74; general 7,678 and 6,874), with 36-byte functions, every step checked by the meaning contract."
LastUpdated: 2026-11-27T10:36:45.747280318-05:00
WhatFor: ""
WhenToUse: ""
---

# Final report: specializing the bytecode VM on its bytecode

Design: `design-doc/01-specializing-the-bytecode-vm-on-its-bytecode.md`. Diary: `log/01-implementation-diary.md`.
Measurements: `scripts/03-measure.mjs` (output `scripts/03-measure.out`), `scripts/04-what-stops.mjs` (output
`scripts/04-what-stops.out`). Tests: `tests/typed/pe.test.mjs`.

## Result

At n = 12, seed = 8, with the backend option `coalesce: true` (as in IRWB-012), RV32 instructions executed and
the bytes of the function's code:

| Fixture | general r0 | general `speed` | specialized (this work) | hand-specialized |
| --- | ---: | ---: | ---: | ---: |
| Fibonacci (entry 0) | 7,678 / 840 B | 9,286 / 904 B | **74 / 36 B** | 75 / 40 B |
| Checksum (entry 34) | 6,874 / 840 B | 8,218 / 904 B | **74 / 36 B** | 74 / 36 B |

The automatic specialization closes the whole gap: Fibonacci runs one instruction fewer than the hand-written
loop (its loop tests `remaining == 0` where the hand-written one tests `remaining > 0`), checksum runs the same
count. Code size goes down, not up: one 36-byte function per fixture, against 840 bytes for the general VM. All
numbers are measured (`scripts/03-measure.out`); the 221 valid (n, seed) calls per entry agree with r0 on the
evaluator and on RV32 (`tests/typed/pe.test.mjs`).

The pipeline from r0: `specialize` (the bindings: the 64 code cells and the entry), `pe`, then
`RESIDUAL_PIPELINE` = `cfg, promote, webs, <speed>, webs, subst ×4, dce, cfg`. Every pass ran under the meaning
contract against r0 restricted to the bindings (40/40 cases each, none rejected). The residual Fibonacci loop:

```text
bb:runVm.0   frame24 = 0; frame16 = n; frame20 = seed; if (frame16 == 0) goto .n5 else .n6
bb:runVm.n5  return frame24
bb:runVm.n6  frame28 = frame24 + frame20; frame24 = frame20; frame20 = frame28;
             frame16 = frame16 - 1 (through two copies the backend coalesces); if (frame16 == 0) goto .n5 else .n6
```

`frame16`, `frame20`, `frame24` are the VM's locals 0, 1, 2 promoted from the frame array; the operand stack
disappeared into single-definition temporaries.

## The binding-time analysis and its check

`bindingTimes` (src/typed/pe.ts) is flow-insensitive and two-kinded. With the code cells and the entry bound,
`pc`, `sp`, `opcode`, `operand` and the fetch temporaries are static of kind `n` (an i32), and `t17`/`t18`
(`frame + (sp << 2)`, `frame + 16 + (operand << 2)`) are static of kind `f` (a frame address with a static
offset); `left`, `right`, `n`, `seed` are dynamic. The buffer promise propagates through the two loads
`load16[caddr(code, pc)+4]`: a cell load from a bound buffer at a static position is static. With only the
code bound, the analysis finds `pc` dynamic (it starts at `entry`), so only `sp`, `t10` and `t17` are static
(tested).

The `f` kind was needed, measured: with frame addresses dynamic, `t17` and `t18` stayed residual locals, so
`promote` saw addresses it could not name and the result ran 684 and 556 instructions (504 and 432 bytes).

Check: the analysis has no separate verifier. An unsound static classification would make `pe` produce a
residual program that disagrees with r0, which the meaning contract rejects; on top of the 40 contract cases, the
test replays all 221 valid calls per entry.

The buffer promise itself is checked statically before any rewrite, as the field binding is: the `specialize`
pass refuses a binding when the function assigns the parameter or when any function stores to an address that
is not rooted at its own frame arrays (tested with a program whose other function writes the buffer:
`poke stores outside its frame arrays (s:poke.5); it could write b`).

## The dispatch-loop specialization and how it stops

`pe` rebuilds the function over (block, static store) pairs. Specialization points are the entry, the loop
headers and dynamic branch targets, memoized on the static locals live into the block; elsewhere it follows
static and unconditional edges inside one residual block. For Fibonacci it made 20 variants and 42 residual
statements, for checksum 18 and 40. The guest's `JUMP 0` returns to (head, pc = 0, sp = 0), already made, which
closes the residual loop; `JZ` is the one dynamic branch per trip.

What stops it:

1. Memoization (above). Restricting the key to live static locals matters: `opcode` and `operand` are dead at
   the head; keyed on them, every head variant would be made twice.
2. A static trap ends a path: a guest loop `PUSH 1; JUMP 0` grows `sp` until the static check `sp >=u 4`
   fails; the whole residual function is one `trap` (10 variants, 18 statements, `scripts/04-what-stops.out`).
3. The budget, `params.budget` residual statements. Default: the statement count of the function being
   specialized (123 for `runVm`), i.e. no code growth unless the host asks. Measured: the smallest budgets that
   succeed are 42 and 40; at 41 the Fibonacci specialization is refused with
   `pe: runVm needs more than 41 residual statements (params.budget) before its static stores repeat`, and the
   program is unchanged (tested). A Typed loop with a static counter and a dynamic exit runs into the budget
   (tested).
4. A walk between specialization points that visits more blocks than the function has means a cycle without a
   loop header (irreducible); it is refused with an ordinary error. Not reached by any fixture.

The result stays checked: `pe` is an ordinary `typedPass`, so the framework diffs it, enforces its declared
writes and runs the meaning contract against r0 under the program's assumptions. Every residual statement's
origin is the original statement and its `because` is the two binding facts (tested), so `why` on residual
code reaches the code image and the entry.

## Where it falls short

- Specializing on the code alone (entry dynamic) is a loss. `sp` is still static, so `pe` makes a variant of
  the whole dispatch per stack depth: 111 variants, 197 residual statements, refused under the default budget;
  with budget 4096 it runs 9,821 and 8,705 instructions in 2,364 bytes, slower and larger than r0 (7,678 / 6,874
  / 840 B). Measured, `scripts/04-what-stops.out`. Without a static `pc` the dispatch cannot be decided, and
  the per-depth copies only add code.
- The BTA is flow-insensitive: a local static in one region and dynamic in another is dynamic everywhere. No
  VM local needs more.
- The promise check is syntactic and conservative: a program that stores anywhere outside frame arrays (to any
  buffer or record) cannot bind a buffer, even when the store provably misses it.
- `specialize` alone folds buffer loads only at positions already constant; the default (non-tape) front end
  reads at a position local, so it needs a constprop first (tested). `pe` does not have this limit.
- The cleanup after `pe` needed a second `webs` + `subst` round: with `speed` alone after `promote` the loops ran
  161 and 136 instructions; with `webs` before `speed`, 74 and 86; with `RESIDUAL_PIPELINE`, 74 and 74.

## Changes, each with its reason

No change under `src/framework/`: the passes are `typedPass`es and the check is the existing contract.

| Change | Reason |
| --- | --- |
| `specialize.ts`: buffer form of a binding (`cells`), validation, `bufferPromiseBroken`, `frameRooted`, `bufferLoad`, constant-position folding | the host promise about memory and its static check, as the brief asks |
| `program.ts`: an assumption may be `{ cells }` (`Assumed`) | so the contract's cases fix the bound buffer |
| `pe.ts` (new): `bindingTimes`, `pe`, `RESIDUAL_PIPELINE` | the binding-time analysis and the dispatch-loop specialization |
| `promote.ts` (new), registered as `promote` | turn constant-address frame cells into locals; without it the stack traffic stays in memory |
| `webs.ts` (new), registered as `webs` | split the reused stack slots into single-definition temporaries `subst` can forward (with `promote` and `speed`: 161 and 136 without it, 74 and 74 with the full `RESIDUAL_PIPELINE`) |
| `tx.ts`/`passes.ts`: write kind `frame` (the `fn` entity) | `promote` removes the frame array area once nothing uses it; that changes the function record, which no existing write kind covered. Saves the frame setup: 3 instructions per call, 77 → 74 on both fixtures |

## Measured and argued

Measured: every number in the tables and lists above (scripts 02 to 04, the tests). Argued, not measured: that
the BTA is sound in general (it is checked per application by the contract, and on this VM exhaustively); that
`frameRooted` addresses stay inside the frame (it relies on the front end's index checks before every array
access); that the walk bound detects every header-less cycle.

## Left out, and Later

- Polyvariance over `entry` inside one function (dispatching a dynamic entry to two residual entries): the
  corpus has two fixed entries, so two specializations match the hand-written loops.
- A run-time check of the promise (hash the buffer at entry, fall back to the general VM): not tried; the static
  check and the restricted contract cover the supported domain.
- Later: a flow-sensitive BTA; generalizing a local to dynamic when the budget runs out instead of refusing;
  binding buffers that callees receive; a pipeline entry for `RESIDUAL_PIPELINE` in `PIPELINES` (left out so the
  corpus-wide pipeline sweeps are unchanged).
