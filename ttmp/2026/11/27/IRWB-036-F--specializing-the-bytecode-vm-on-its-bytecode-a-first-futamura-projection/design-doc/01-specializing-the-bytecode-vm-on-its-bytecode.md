---
Title: Specializing the bytecode VM on its bytecode
Ticket: IRWB-036-F
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
Summary: "Design: a constant-buffer binding, a binding-time analysis, polyvariant specialization of the dispatch loop with a size budget, and frame-array promotion, all under the meaning contract."
LastUpdated: 2026-11-27T10:05:50.509841501-05:00
WhatFor: ""
WhenToUse: ""
---

# Specializing the bytecode VM on its bytecode

## Goal and input domain

`corpus/projects/bytecode-vm` interprets a 64-cell bytecode image with `runVm(code, entry, n, seed)`. At n = 12,
seed = 8 the general VM runs 7,678 (Fibonacci, entry 0) and 6,874 (checksum, entry 34) RV32 instructions; one
hand-written Typed loop per program runs 75 and 74. This stage makes the compiler derive the specialized programs
from the VM and the image (the first Futamura projection), checks every step with the existing meaning contract,
and measures how much of the gap closes.

Supported domain: a Typed function whose bound buffer parameter is never assigned, in a program that stores only
to frame arrays (no store whose address is not rooted at `aaddr`); the bound buffer's cells are the host's
`{cells}`; the other bound parameters are integers. Inputs outside the bindings are outside the specialized
program's meaning, as for the existing scalar and field bindings (`Program.assume`).

## What the r0 IR looks like (probe `scripts/01-listing.mjs`)

The dispatch loop head is `bb:runVm.1` (`if !(1)`), the fetch block `.3` reads
`opcode = load16[caddr(code, pc)+4]` and `operand = load16[caddr(code, pc+1)+4]`, and an `if/else` chain of
`opcode == k` tests leads to the arms. `stack` and `locals` are a 32-byte frame array area: every access is
`load32/store32[(frame+o + (sp << 2))]` behind an explicit `if (i >=u 4) trap` check. Arms rejoin through a
chain of one-jump blocks back to `.1`.

## Decisions

### 1. A constant-buffer binding (`typed.bindings`, buffer form)

A binding `{ fn, param, cells, entity }` promises that the buffer parameter holds exactly `cells`.
`Program.assume` fixes that parameter's case input to `{ cells }`, so the meaning contract compares with r0 only
on calls with that content (the corpus spec already fixes these cells; the binding makes the restriction a fact
the passes may use). The promise is checked as the field binding is checked, statically, before any rewrite:
the `specialize` pass refuses a binding when the function assigns the parameter, or when any function of the
program stores to an address not rooted at a frame array (such a store could write the buffer). Under the
binding, `specialize` replaces a cell load at a constant position (`load16u(caddr(get code, k), 4)`, k < length)
by `cells[k]` and the length word by `cells.length`, each citing the fact.

Simplest alternative: bind nothing and let the pass read the corpus input spec. It falls short because the
spec is test data, not a promise, and no check would refuse a program that writes the buffer.

### 2. A binding-time analysis (BTA)

`bindingTimes(st, f, bindings)` classifies each local as static or dynamic, flow-insensitively, to a fixpoint:
a bound integer parameter is static; an unbound parameter is dynamic; any other local is static iff every `set`
of it assigns a static expression (its initial zero is a constant). An expression is static iff it is a
constant, a read of a static local, an i32 operator over static operands, or a cell load
`load16u(caddr(get b, p), 4)` / length load `load(get b, 0)` on a bound buffer `b` with static `p`. Frame
addresses (`aaddr`), memory loads, calls and results are dynamic. This is where the buffer promise propagates
through loads: `opcode`, `operand`, `pc` and `sp` come out static once `entry` is bound; `left`, `right` and
everything read from the operand stack are dynamic.

Simplest alternative: no separate analysis, an online specializer that tries to evaluate everything. Without
the BTA the specializer cannot tell which locals belong in the variant key, and would key on dynamic values it
cannot know. A flow-sensitive BTA would be more precise; no local of the VM needs it, so it is listed under Later.

### 3. Polyvariant specialization of the dispatch loop (`pe` pass)

`pe` rebuilds a function whose bindings name it as a residual CFG over pairs (original block, static store):

- The static store maps each BTA-static local to its value. It starts with the bound parameters and zero.
- Static statements run at specialization time: `set` of a static local updates the store; a branch on a
  static condition is decided; a static check that fails (`caddr` past the buffer, `>=u 4` on a static stack
  index) becomes a residual `trap`.
- Dynamic statements are copied with static subtrees folded to constants (i32 rules of the evaluator) and
  `frame+o + c` folded to `aaddr(o + c)`.
- Specialization points are the entry, loop headers (from the `loops` analysis) and the targets of dynamic
  branches. Each is memoized on (block, static store restricted to the static locals live into the block).
  Elsewhere the specializer continues in the same residual block (static and unconditional edges are inlined).

When to unroll: the dispatch loop's head is a loop header, so each distinct live static store at it (here: a
`pc` and `sp` pair, i.e. one guest instruction at one stack depth) becomes one residual block. How it stops:
(a) memoization: a guest backward jump reaches a (header, store) pair already made and closes a residual loop;
(b) a static trap ends a path; (c) a size budget, `params.budget` residual statements, refuses the
specialization with an ordinary error when exceeded (a guest loop that grows `sp` or a static counter without
bound would otherwise unfold forever). Restricting the key to live locals is what keeps dead `opcode` and
`operand` values from doubling the variants.

Every residual entity has `origin.from` the original statement or value, `because` the binding fact, and a note
with the static store, so `why` on residual code reaches the bytecode. The result is checked by the ordinary
meaning contract against r0 under the assumptions, like any pass.

Simplest alternative: unroll the loop k times with `pc` constant-propagated. It needs a trip count, which the
guest program decides dynamically (`JZ`), so it cannot close the residual loop; memoization on the static store
is the standard way (online partial evaluation with program-point specialization).

Default budget: set from measurement (the residual statement counts of the two fixtures, reported in the
final report) with a factor that still admits both; the report also measures the budget below which the
specialization is refused.

### 4. Frame-array promotion (`promote` pass)

After `pe`, every operand-stack and VM-local access has a constant frame address. `promote` replaces each
4-byte cell of a function's frame array area by a fresh local when every `aaddr` in the function is the direct
address of an i32 `load` or a 32-bit `store` with a cell-aligned constant offset inside the area: a store
becomes a `set`, a load a `get`, and `zero` becomes `set`s to 0. Any other use (a dynamic index, an address
that escapes into a call or arithmetic, an f32 load) leaves the function unchanged. Valid because the frame area
is private to the call (the meaning compares the guest memory only) and every access names its cell exactly.
It is a general pass, registered with the others and checked by the meaning contract.

Simplest alternative: stop after `pe`. The stack traffic then remains as memory loads and stores, a large part
of the gap; promoting is what lets constprop, subst and copy coalescing see the guest values as scalars.

## Framework and loader changes planned

- `src/typed/specialize.ts`: buffer form of a binding, validation, the static check, the constant cell loads.
- `src/typed/program.ts`: assumptions may hold `{ cells }` as well as numbers.
- `src/typed/pe.ts` (new): the BTA and the `pe` pass. `src/typed/promote.ts` (new) or in `passes.ts`: `promote`.
- No change to `src/framework/` is expected: the passes are ordinary `typedPass`es and the check is the
  existing contract.

## Measurement plan

For each fixture (entry 0, entry 34), from r0: `specialize` (code cells, entry), `pe`, `cfg`, `promote`, then the
`speed` pipeline; RV32 instructions (`runImage` steps, `coalesce: true`) at n = 12, seed = 8 and image bytes, for
the general r0 and `speed` images, the specialized image, and the hand-specialized loops of
`tests/typed/bytecode-vm.test.mjs`. Correctness: every pass gated by the meaning contract (40 cases), plus an
exhaustive replay of the 221 (n, seed) calls per entry against the JavaScript oracle on the evaluator and RV32.

## Left out

- Polyvariance over `entry` inside one function (a dynamic `entry` dispatching to two residual entry points, "The
  Trick"): the corpus has two fixed entries; two specializations match the hand-written loops.
- A run-time check of the promise (hashing the buffer at entry and falling back to the general VM): the static
  check plus the restricted contract already cover the supported domain.

## Later

- A flow-sensitive BTA (a local static in one region and dynamic in another).
- Generalization when the budget runs out (make the offending local dynamic and retry) instead of refusing.
- Specializing on buffers that callees receive (the static check refuses any program with non-frame stores).
