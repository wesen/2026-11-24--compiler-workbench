---
Title: Specializing the bytecode VM on a constant buffer
Ticket: IRWB-036-G
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "A buffer binding, a binding-time analysis, and a polyvariant block specializer with a budget that falls back to the general loop; plus frame-slot promotion."
LastUpdated: 2026-11-27T10:01:20.507473747-05:00
WhatFor: ""
WhenToUse: ""
---

# Specializing the bytecode VM on a constant buffer

## Goal and supported domain

`runVm(code, entry, n, seed)` in `corpus/projects/bytecode-vm/` interprets the bytecode in `code`. The general VM
runs 7,678 (Fibonacci) and 6,874 (checksum) RV32 instructions at n = 12, seed = 8; hand-written loops run 75 and
74. This design makes the compiler derive a residual program from the VM and one bytecode image, as checked
passes, and measures how much of that gap it closes.

Supported domain. A function of the program that

- takes a `buffer` parameter the host binds to fixed cells (u16 values, a fixed length);
- never stores through anything but its own frame array area, and calls nothing (so nothing in it can write the
  buffer);
- reads the buffer with `charCodeAt` (IR: `load16u(caddr(get P, i)) + 4`) or reads its length (`load(get P) + 0`).

Inside the domain the bytecode itself is unrestricted: nothing below knows the VM's opcodes. Outside the domain
the pass refuses with an ordinary `unsupported` error at the binding it cannot honour.

## What is built

Three pieces, all in `src/typed/`, each a `typedPass` held to the meaning contract against r0.

### 1. A buffer binding and a candidate binding (`specialize.ts`, `program.ts`)

`Binding` gets two forms next to `value`:

- `{ fn, param, cells: number[] }`: the host promises that buffer parameter `param` of `fn` always has exactly
  these cells. It is checked as the field binding is: (a) `Program.assume` fixes that parameter to
  `{ cells }` in the inputs of every later meaning check, so the program is compared with r0 only on inputs that
  satisfy the promise; (b) the pass refuses if the function could make the promise false inside the program:
  any call, or any store whose address is not rooted at `aaddr` (the frame array area).
- `{ fn, param, oneOf: number[] }`: the host promises that scalar parameter `param` is one of these values
  (here `entry` in {0, 34}). `assume` fixes the input to `{ oneOf }`.

Simplest alternative for the cells: bind each cell as a scalar `value` binding. There is nothing to bind it
to: a cell is memory, not a parameter or record field, which is why the existing specialization gains nothing here.

### 2. Binding-time analysis (`bta.ts`)

A division of the function's locals into static and dynamic, computed as a greatest fixpoint: start with every
local static, and make a local dynamic when one of its definitions is not static. A value is static when it is

- a constant, or an operator (pure, i32, not a load, not a call) over static values;
- `get` of a static local;
- a load from a bound buffer at a static position (`load16u(caddr(get P, static))`, `load(get P)`), with `P`
  never assigned in the function.

Entry values: a parameter with a `oneOf` binding starts static (one variant per candidate, see 3); every other
parameter starts dynamic; a non-parameter local starts at the constant 0, which is static. Frame loads are dynamic.

The analysis returns the static locals and the static buffer loads (the propagation of the promise through loads
the brief asks for). It is a plain function over the store, not a framework analysis: the only consumer is the
specializer, in the same pass run, and no pass claims to preserve it. Alternative: no analysis, track every local
that happens to be constant on a path (online). It would work on this VM, but it gives no answer to "which loads
does the promise reach" before specializing, and it lets locals that are constant only by accident (never fed by
the buffer) multiply variants. The division restricts tracking to what the analysis proved, and the report prints it.

Its check: every static decision is re-established by the specializer by actually evaluating the value under a
concrete environment; a local the BTA calls static whose value the specializer cannot compute at some point is
dropped from that environment there (it costs variants, never correctness).

### 3. Polyvariant specialization of the blocks (`specialize-buffer`, in `specialize.ts`)

State: `(block, env)`, where `env` maps static locals that are live into the block (framework liveness) to
their constant values. The pass keeps every original block and adds variants:

- For each candidate of a `oneOf` parameter, in order, the new entry tests `param == candidate` and jumps to the
  variant `(entry block, {param: candidate})`; the last candidate is taken without a test (the promise). With no
  `oneOf` binding there is one variant of the entry block with the empty environment.
- A variant is a copy of the block's statements with: static reads replaced by their constants, static buffer
  loads replaced by the cell (position < length; otherwise the load is copied unchanged and traps as before),
  static subtrees folded with the evaluator's own `binop`. A `set` of a tracked local is **still emitted**
  (with the constant as its value) and updates `env`.
- A `br_if` whose condition is static becomes a `br` to the variant of the taken successor; a dynamic one
  keeps both successors, each as its own variant.
- Variants are memoized on `(block, env restricted to live static locals)`. This is what closes the loop: the
  bytecode's `JUMP 0` reaches `(dispatch head, {pc: 0, sp: 0})`, which already exists.

When to unroll: always, while the budget lasts; the dispatch loop is not recognised as a loop, the known `pc`
simply makes each trip a different state. How it stops: (a) the state space is finite when the static locals take
finitely many values (for the VM: one state per reachable `(pc, sp)`); (b) a **budget** on the number of variants.
When the budget is spent, a jump to a state that has no variant goes to the **original block** instead. That is
sound with no further condition because every `set` was emitted: at every point of a variant the real locals and
the frame hold exactly what the general program would hold there, so the original block can take over. The
general loop is the fallback variant of every state. If the budget suffices, the original blocks become
unreachable and `commit` prunes them.

The default budget is 256 variants. Argument: each variant copies one block, and the 64-cell image has 32
instruction slots, each passing through at most the 11 blocks of the longest opcode path (ADD/SUB/MUL in the r0
listing), so 352 bounds this image and 256 is the nearest size that also bounds residual code at a few times the
general VM (r0 has 99 blocks). The measurement replaces this argument: the report gives the variants actually
used and a sweep over budgets.

Simplest alternative: unroll the loop a fixed number of times (the usual loop unrolling). It cannot work: the trip
count is the dynamic `n`; what is static is the *path* through the bytecode, and only memoization on `pc` turns the
bytecode's own back edge into a residual back edge.

How it stays checked: the pass is applied through `Program.specialize`, so `applyPass` runs the optimization
contract against r0 on generated cases restricted by the assumptions, like every other pass; each new value
cites `fact:typed.bindings:<id>@<rev>#<entity>` in `because`, each variant block and statement has its original as
origin (correspondence). The test also applies the pass with cells that differ from the inputs and expects
`contractRejected`.

### 4. Frame-slot promotion (`frame-slots` pass, `passes.ts`)

After specialization every stack and locals access of the VM is at a constant frame offset, but still a memory
access. A pass promotes the frame array area to locals when **every** use of `aaddr` in the function is the
address of a 32-bit load or store at a constant, 4-aligned offset (and every `zero` covers whole words): one local
per word, `store32` → `set`, `load32` → `get`, `zero` → sets of 0. If any `aaddr` is used otherwise (a dynamic
index, an escaping address), the pass does nothing. The frame is not part of the compared memory, so the meaning
contract judges the pass by results and input memory alone. Alternative: store-to-load forwarding within a
block; it leaves the stores and the loads across the loop's back edge, which is most of them.

### 5. A run-time check of the promise (new approach, measured)

Option `guard: true` of `specialize-buffer`: the new entry first compares the buffer's length and the cells the
specialization actually read (recorded while specializing) with the bound values and jumps to the original entry
block when any differs. Then no assumption is needed: the residual program is checked against r0 on **all**
inputs, the promise becomes a hint. The cost is the comparison chain and that the general VM stays (so the frame
cannot be promoted). Measured against the assumed form.

## Pipeline

`specialize` (cells + oneOf) → `speed` → `frame-slots` → `speed`. Measured with the project's backend options
(`coalesce: true`), instructions at n = 12, seed = 8, code size as `image.value.bytes`.

## Decisions in short

| Decision | Simplest alternative | Why not / why |
| --- | --- | --- |
| Emit every `set`, even static ones | Drop static sets (classic PE) | Emitting keeps the general blocks a valid continuation from any variant, so the budget needs no proof; `dce` removes the dead ones. |
| Memoize on live static locals | Memoize on all static locals | Stale `opcode`/`operand` from the previous instruction would split one `pc` into several states. |
| `entry` as a promised candidate set | Leave `entry` dynamic | Then `pc` is dynamic and no load is static (measured as the first experiment). |
| Budget falls back to the general loop | Fail the pass over budget | A partial specialization is still correct and useful; measured in the sweep. |
| One pass, extended `specialize` module | A new framework analysis for the BTA | One consumer; nothing to preserve or invalidate. |

## Framework changes expected

None in `src/framework/`. In `src/typed/`: the binding forms, `assume` for them, `bta.ts`, two passes.

## Tests and measurements

- `tests/typed/specialize-buffer.test.mjs`: BTA division of `runVm`; specialization applies under the contract
  (40/40) and the 442 exhaustive cases agree with r0 on the RV32 image; wrong cells are rejected; a function that
  stores into the buffer is refused; budget 0..N keeps meaning; guard form agrees with r0 on altered buffers.
- Scripts in `scripts/`: baseline, BTA dump, measurement table, budget sweep.

## Left out

- Arity raising / dropping the dead `code` parameter: the signature is the host's.
- Promotion of frame slots with dynamic indices; partially static structures.

## Later

- Bindings for buffers reached through record fields (needs alias facts for record pointers).
- Functions with calls (needs effect summaries to keep the no-write check).
- A second Futamura projection (specializing the specializer) needs the specializer written in Typed.

## Changes during implementation

Recorded here so the design above stays what was committed first; the report has the measurements.

- **Transition compression.** The first implementation made one variant per original block and state, and the
  budget of 256 ran out at `pc = 14` (the argument "at most 11 blocks per instruction" forgot the chain of opcode
  tests). A decided jump now continues in the same variant unless the target is the head of an original loop,
  already has a variant for the state, or was already copied into this variant. The VM then needs 38 variants.
- **Budget.** The default is 4 variants per bound cell (argument in `specialize-buffer.ts`), 256 for this image,
  against a measured need of 38.
- **Pipeline.** `frame-slots` must run before `licm`/`lvn`, which hoist the constant frame addresses into locals
  shared across blocks. The sequence is `specialize-buffer`, `cfg`, `frame-slots`, `copyprop`, `dce`, `copyback`,
  `speed` (`specializeInterpreter`).
- **Two more small passes.** `copyprop` (block-local copy propagation) and `copyback` (`t = E; a = t` → `a = E`):
  the promoted stack is one local assigned many times, a shape `subst` does not forward.
- **`frame-slots`** also resolves an address through a local assigned earlier in the same block, the front
  end's `t17 = address; store32[t17] = …`.
- **Guard.** After the length test the cells are compared without the bounds check, two cells per 32-bit word.
- **BTA entry values.** Only locals that are not parameters and candidate parameters start static, as designed;
  with `entry` unbound the division leaves `pc` dynamic, which the report measures.
