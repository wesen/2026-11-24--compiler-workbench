---
Title: 'Report: the bytecode VM specialized on its bytecode'
Ticket: IRWB-036-G
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Automatic specialization of the bytecode VM on its bytecode reaches 79 and 79 RV32 instructions (general 7,678 and 6,874, hand-written 75 and 74) in 96 code bytes; what was built, measured, and where it stops."
LastUpdated: 2026-11-27T10:31:56.106319064-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: the bytecode VM specialized on its bytecode

## Result

All numbers: RV32 instructions executed at n = 12, seed = 8, backend option `coalesce: true`; code size is the
image's code bytes (`image.value.bytes`). "Gap closed" is (general r0 − x) / (general r0 − hand-written).

| Program image | Code bytes | Fibonacci (entry 0) | Checksum (entry 34) | Gap closed |
| --- | ---: | ---: | ---: | ---: |
| General VM, r0 | 840 | 7,678 | 6,874 | 0% |
| General VM, `speed` | 904 | 9,286 | 8,218 | −21%, −20% |
| `specialize-buffer` alone | 1,652 | 2,209 | 1,957 | 71.9%, 72.3% |
| **Specialized, full sequence** (code and entry promised) | **96** | **79** | **79** | **99.95%, 99.93%** |
| Guarded (nothing assumed, general VM kept) | 3,236 | 1,150 | 1,228 | 85.9%, 83.0% |
| Code promised, entry unbound | 2,792 | 11,711 | 10,487 | −53%, −53% |
| Hand-specialized loops (two functions, 76 bytes together) | 76 | 75 | 74 | 100% |

The specialized VM is one function of 7 blocks that holds both programs; its two loops are the hand-written
loops statement for statement (`scripts/06-final.out.txt`):

```text
bb:runVm.n12  -> [.n7, .n12]                       bb:runVm.n14  -> [.n9, .n14]
    slot28 = (slot24 + slot20)                         slot20 = ((slot20 * 33) + slot16)
    slot24 = slot20                                    slot16 = (slot16 - 1)
    slot20 = slot28                                    if (slot16 == 0) goto .n9 else .n14
    slot16 = (slot16 - 1)
    if (slot16 == 0) goto .n7 else .n12
```

The residual function differs from the hand-written pair by the test of `entry` and by holding both programs
(4 and 5 instructions, 20 code bytes; the difference was not broken down by instruction). Each program costs 7 instructions at n = 0 and 6.00 per trip
(`scripts/07.out.txt`); the general VM costs 166 and 626 or 559 per trip.

A third bytecode image that the corpus does not have (seed plus the sum of k², stack depth 3) specializes to one
loop: 65 instructions against 6,994, 44 code bytes, 18 variants.

## What was built

All in `src/typed/`; no file under `src/framework/` changed.

### The promise: a buffer binding (`specialize.ts`, `program.ts`)

`Binding` has two new forms: `{ fn, param, cells }` (the exact u16 cells of a buffer parameter) and
`{ fn, param, oneOf }` (the values a scalar parameter can have). The check has the two halves the field binding
has:

1. `Program.specializeBuffer` calls `assume`, which puts `{ cells }` and `{ oneOf }` into the input
   specification of every later meaning check, so each pass is compared with r0 only on inputs that satisfy the
   promise, and `undo` drops it with the revision.
2. The pass refuses a function that could make the promise false: any call, an assignment to the buffer
   parameter, or a store whose address is not rooted in the function's own frame array area (through locals that
   only ever hold frame addresses).

### Binding-time analysis (`bta.ts`)

Greatest fixpoint over the locals: a local is static unless one of its assignments has a non-static value; static
values are constants, static locals, pure i32 operators over static values, and loads from a bound buffer at a
static position (`charCodeAt`) or its length. For `runVm` (`scripts/02-bta.out.txt`):

| Bound | Static locals | Buffer loads static / dynamic |
| --- | --- | --- |
| `code` | `sp t10` | 0 / 2 |
| `code`, `entry` ∈ {0, 34} | `entry sp pc t6 opcode t8 operand t10` | 2 / 0 |

Its check is the specializer: a value is only ever replaced by a constant after the specializer has computed it
under a concrete environment with the evaluator's own `binop`. A local the analysis calls static but whose value
cannot be computed at some point is dropped from the environment there.

### Dispatch-loop specialization (`specialize-buffer.ts`)

Polyvariant specialization of blocks on the state (block, values of the live static locals).

- **When to unroll.** Always: the loop is not recognised as such. A known `pc` makes every trip of the dispatch
  loop a different state, so the loop unrolls along the bytecode.
- **How it stops.** States are memoized, so the bytecode's `JUMP 0` reaches the existing state
  (dispatch head, pc = 0, sp = 0) and becomes a residual back edge. A decided jump is compressed into the current
  variant unless its target is the head of an original loop, already has a variant, or was already copied into
  this variant, so every cycle of the original passes a memoized state. A budget bounds the variants (default
  4 per bound cell, 256 here; measured need 38). Over budget, the jump goes to the original block.
- **Why the fallback is sound.** Every `set` is emitted, static ones too, so at any point of a variant the
  locals and the frame hold what the general program holds there.
- **How it stays checked.** It is a `typedPass` applied by `Program.apply`: the optimization contract compares
  the output with r0 on 40 generated cases under the assumptions (40/40 at every step, `06-final.out.txt`).
  Every constant it introduces cites `fact:typed.bindings:…#<entity>`; every variant block and statement has
  the original as its origin. The edit `specialized` records the division, the variants, and the cells read.
- **Checks measured.** Wrong cells applied without the assumption are rejected (`contractRejected`); the 442
  exhaustive fixture calls agree with the general VM on the RV32 emulator; bytecode that jumps out of the
  buffer, underflows the stack or uses an unknown opcode traps or returns as the general VM does; budgets 0, 8
  and 37 keep the meaning.

### What turns the residual interpreter into the loop

`specialize-buffer` alone removes the fetch and decode (2,209 instructions): the residual code is still a stack
machine in frame memory. Three small checked passes do the rest (`specializeInterpreter` runs the sequence
`specialize-buffer, cfg, frame-slots, copyprop, dce, copyback, speed`):

| Stage | Code bytes | Fibonacci | Checksum |
| --- | ---: | ---: | ---: |
| `specialize-buffer` | 1,652 | 2,209 | 1,957 |
| + `cfg` | 1,552 | 2,054 | 1,814 |
| + `frame-slots` | 1,072 | 1,366 | 1,222 |
| + `speed` (without the two copy passes) | 160 | 190 | 177 |
| + `copyprop`, `dce` before `speed` | 108 | 91 | 103 |
| + `copyback` before `speed` | 96 | 79 | 79 |

- `frame-slots.ts`: a frame array area accessed only by 32-bit word at constant offsets becomes one local per
  word. All or nothing per function.
- `copyprop.ts`: `copyprop` (after `a = b`, reads of `a` in the block read `b`) and `copyback`
  (`t = E; a = t` with `t` dead becomes `a = E`).

## New approaches tried

| Approach | Result |
| --- | --- |
| Polyvariant specialization with a size budget and fallback to the general loop | Sound at every budget (measured 0 to 38). **Not profitable below the need**: without `speed`, budgets 4 to 37 run 7,028 to 6,602 instructions for Fibonacci against 7,055 at budget 0 (`08.out.txt`), because the fallback is one way: once in the general loop, execution never returns to a variant. With `speed` they are slower than the general VM (10,703 to 15,161), because licm places its hoisted address copies on a path the multi-entry general loop runs every trip. At budget 37 the checksum is complete (694 with `speed`) and Fibonacci is not. |
| Run-time check of the promise (`guard: true`) | Works with no assumption: the contract is the unrestricted one, and other bytecode (one cell changed, another length) gives the general VM's results. Cost: 250 instructions at n = 0 (the length test, 32 word comparisons, two tests of `entry`, and the unpromoted prologue), 75 to 80 per trip instead of 6, 3,236 code bytes. The per-trip cost is the frame, which cannot be promoted while the general loop indexes it dynamically. A first version that compared each cell through the bounds-checked address cost 665 at n = 0. |
| Candidate values for `entry` ("the trick" at the function entry) | Necessary: without it `pc` is dynamic, the specializer has only `sp` to specialize on, makes 111 variants and the result is slower. |
| Transition compression | Necessary: without it the same budget ran out at `pc = 14` (about 15 blocks per guest instruction). |

## What stops the specialization, and where it falls short

- **A dynamic `pc`.** Every entry point must be a bound candidate. Indirect jumps computed from dynamic data
  (not in this VM) would make `pc` dynamic for good.
- **One-way fallback.** Over budget, or in guarded form on other bytecode, the general loop never re-enters
  residual code.
- **`frame-slots` is all or nothing.** Any dynamic frame index in the function (the kept general loop) keeps the
  whole frame in memory: the guarded form stays at 75 to 80 instructions per trip.
- **Stack depth must be static per `pc`.** Bytecode that reaches one `pc` with two depths gets a variant for each;
  depth that grows with a dynamic count would exhaust the budget (argued, not measured).
- **Functions with calls or buffer stores are refused**, so an interpreter split into helper functions must be
  inlined first (argued; `inline` exists, the combination was not run).
- **The signature stays.** `code` is still a parameter, and both programs live in one function behind a test of
  `entry`: 4 and 5 instructions and 20 bytes over the hand-written pair.
- **`speed` makes the general VM slower** (9,286 against 7,678), as IRWB-012 already measured; partial results
  inherit that.
- **The contract's sample.** Each step is accepted on 40 generated cases (both entries occur); the exhaustive
  442-case agreement is in the test, not in the gate.

## Framework changes

None under `src/framework/`: `definePass`, the contract, liveness and loops were used as they are. Changes in
`src/typed/`, each with its reason:

| Change | Reason |
| --- | --- |
| `Binding.cells`, `Binding.oneOf`; validation; `specialize` skips them (`specialize.ts`) | A host can only promise scalar values today; a buffer's contents and a candidate set had no form. |
| `Assumed` type, `Program.assume` for the new forms, `Program.specializeBuffer` (`program.ts`) | The restricted contract must generate the bound cells and candidates; `assumptions` held numbers only. |
| `bta.ts` | The binding-time division. |
| `specialize-buffer.ts` (`specializeBuffer`, `specializeInterpreter`) | The specializer and its pass sequence. |
| `frame-slots.ts` | No pass turned frame memory at constant offsets into locals. |
| `copyprop.ts` (`copyprop`, `copyback`) | `subst` forwards a single-reader definition; a promoted stack slot is assigned many times. |

The new passes are not in `PASSES` or any named pipeline: they are applied as pass objects, so `actions()`, the
strategies and the workbench are unchanged.

One thing the framework did not fit, worked around and proposed: `Tx.block` can only append, and a pass that
needs a new entry block has to reorder `f.blocks` itself. Proposal: `tx.block({ entry: true })`.

## Measured and argued

Measured (scripts 02, 05, 06, 07, 08 with outputs; `tests/typed/specialize-buffer.test.mjs`): every number in the
tables; the division; agreement on 442 cases; rejection of wrong cells; traps preserved on three malformed
images; guarded results on two other buffers; budgets.

Argued only: that the fallback is sound for every program in the domain (the emitted-sets argument; measured on
this VM at 8 budgets); that the no-write check is sufficient (it relies on the front end's bounds checks keeping
frame addresses inside the frame); the budget default of 4 per cell; behaviour with a dynamic stack depth; that
`frame-slots` is safe when frame words are read before being written (the evaluator's frame starts at zero and
the front end zeroes arrays; not tested on a function that skips the zeroing).

## Left out, and later

Left out: removing the dead `code` parameter (the host's signature); registering the passes in pipelines.

Later:
- Re-entry from the general loop into variants (a test of `pc` at the loop head).
- Frame promotion per region, or the residual program as its own function, so the guarded form gets it too.
- Bindings for buffers reached through record fields.
- Refusal by effect summary instead of "no calls".
- `tx.block({ entry: true })`.
