---
Title: 'B1: specializing the bytecode VM on its bytecode — first Futamura projection (design)'
Ticket: IRWB-036-E
Status: active
Topics:
    - compiler
    - ir
    - performance
    - specialization
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/bytecode-vm/main.typed
      Note: the interpreter: fetch/dispatch loop over a u16 `code` buffer, with `stack`/`locals` frame arrays
    - Path: repo://src/typed/specialize.ts
      Note: the existing parameter/field bindings this design extends with a constant-buffer promise
    - Path: repo://src/typed/peval.ts
      Note: the polyvariant partial evaluator (new): trace, memo, liveness-bounded materialization, demotion restarts
    - Path: repo://src/typed/program.ts
      Note: assume(): how a buffer promise restricts the meaning contract's cases
    - Path: repo://ttmp/2026/11/27/IRWB-036-E--b1-specializing-the-bytecode-vm-on-its-bytecode-first-futamura-projection/scripts/01-vm-ir.mjs
      Note: the lifted dispatch loop this design specializes
ExternalSources: []
Summary: 'Design for IRWB-036-E: a host promise that a buffer parameter holds fixed contents, and a polyvariant partial evaluator that traces the dispatch loop on known program counters, closes loops at memoized program points, demotes loop-varying static cells to locals, and emits the residual as checked TypedBlocks. Targets the 7,678/6,874-instruction general VM against the 75/74 hand-specialized loops.'
LastUpdated: 2026-11-27T12:00:00-05:00
WhatFor: Implementing the first Futamura projection for the bytecode VM, and judging how much of the 100x gap automatic specialization closes.
WhenToUse: Before writing the buffer binding, the peval pass, or their measurements; and when reviewing them.
---

# Design: specializing the bytecode VM on its bytecode

## 1. The problem

`runVm` in `corpus/projects/bytecode-vm/` is an interpreter: a fetch (`load16[caddr(code, pc)+4]`), an
if/else dispatch on the opcode, handlers over two frame arrays (`stack` at frame+0, `locals` at
frame+16), and a single back-edge to the fetch. At r0 one guest instruction costs ~42 RV32
instructions; the hand-written Typed loops (`seededFib`, `rollingChecksum` in the IRWB-012 test)
cost 75 and 74 RV32 instructions for the whole run (n=12), a ~100x gap.

What makes the gap is *memory*: the existing specialization (IRWB-009/010, `src/typed/specialize.ts`)
binds scalars and record fields, and binding `entry`, `n`, `seed` here gains almost nothing — every
guest instruction still re-reads `code`, re-reads and re-writes `stack`/`locals`, and re-traverses the
dispatch. The knowledge that closes the gap is that the *contents of the `code` buffer are fixed*.
With the buffer constant and `pc` momentarily known, the fetch folds, the dispatch folds, the
handler's operand folds, and what remains of one guest instruction is the data arithmetic itself.
That is the first Futamura projection: specialize the interpreter on its program and the residual is
the program, compiled.

## 2. What the host promises, and how it is checked

Two facts, from two existing sources of host knowledge:

1. **The buffer promise** (new): a `typed.bindings` binding of the new *buffer form*
   `{ fn, param, cells, entity, note }` — "`fn`'s buffer parameter `param` always holds `cells`."
   Checked exactly as the field binding is checked: the pass refuses (leaves the function alone)
   if a store in the function could write through an address derived from that parameter. In
   `runVm` every store address is frame-`aaddr`-based, so the promise holds. The check lives next
   to the field-binding check in `specialize.ts` and is shared by both passes.
2. **The entry domain** (existing): the project's input spec `entry: { oneOf: [0, 34] }`. The
   meaning contract already only generates cases from the input specs, so the *checked* domain of
   `runVm` is exactly "code = the 64 fixture cells, entry ∈ {0,34}, n ∈ [0,12], seed ∈ [-8,8]". The
   specializer splits on precisely this domain — it never claims more than the contract checks.

The buffer promise also restricts the contract the way a scalar binding does: `Program.assume`
learns the buffer form and fixes that parameter's input spec to `{ cells }`, so generated cases
always run the interpreter on the promised bytes. For the corpus project the input spec already pins
`code`, so nothing changes there; the mechanism matters for a host whose input spec leaves the
buffer free. A run-time check of the promise (comparing the buffer against the folded cells before
entering) was considered and rejected: it costs a pass over the buffer per call — more than the
whole residual loop — to defend against inputs the meaning contract never generates. The static
write-check plus the restricted contract is the enforcement, on the same principle as scalar and
field bindings ("the contract changes with the assumption").

## 3. The partial evaluator (`src/typed/peval.ts`, new pass `peval`)

A whole-program pass (like `dfe`/`inline`): for each function with a buffer binding (or bound
scalars) it runs a polyvariant abstract trace and replaces the function's blocks with the residual.
Functions outside the supported domain are left unchanged with a recorded reason — the pass never
degrades a program it does not understand.

### 3.1 Supported input domain (explicit)

Per function: statements `set, store, br, br_if, return, trap, zero, eval`; i32 values
`const, get, add, sub, mul, shl, shr, shru, and, or, xor, eq, ne, lt, gt, le, ge, ltu, geu, eqz,
load, load16u, aaddr, caddr`. No `call`, no f32, no `result`/`tuple`, one result. Frame-array
accesses at word-aligned static offsets. Anything else → the function is skipped, unchanged.
Generalizing further (calls, f32, records) is listed under Later: no corpus program needs it.

### 3.2 Abstract state

- **IR local** → `CONST(c)` | `VAL(id)` | `DYN`. `DYN` means "materialized in its own local slot"
  (the original `set`/`get` statements survive); `VAL(id)` is a residual value node valid in the
  current block only.
- **Frame cell** (word of a frame array, keyed by byte offset) → `CONST(c)` | `VAL(id)` |
  `LOC(m)`. `LOC(m)` is a fresh local `m` the pass allocates per cell.
- **Address** → `FRAME(byte)` | `CODE(byte)` | `DYN`, propagated through `aaddr`, `caddr` and
  constant address arithmetic. `caddr(get(code), k)` folds to `CODE(2k)` with the capacity check
  evaluated against the promised `cells.length`; a position that would trap residualizes a `trap`.
  `load16u(CODE(4+2k))` folds to `cells[k]`; a 32-bit code load composes two adjacent cells.
- **The bound buffer** is a constant memory: loads fold, stores refuse (the promise check).

### 3.3 Regions, the memo, and how the loop closes

The trace follows original blocks. A **region** is the maximal straight run of blocks executed from
one abstract entry point; it ends at a `br` into an already-seen entry point, a dynamic `br_if`, a
`return`, or a `trap`. Entry points are memoized by key

```
(original block, live IR locals with their values, live frame cells with their states)
```

where "live" comes from liveness: IR locals from the framework's `liveness` analysis (`liveIn` of
the target block), frame cells from a liveness fixpoint over the region graph that the first
(discovery) pass records (each region logs its cell read/write events and exit keys; cells not
live-in are written before read on every path, so their state is irrelevant both to the key and to
materialization). A `br` to a memo hit closes a loop as a residual `goto`/`br_if` back-edge; a
dynamic `br_if` cuts the region and pushes both arms as new entry points.

**Splitting on entry**: at the function entry, a scalar parameter whose input spec is `oneOf` with
at most 8 values (justified below) is split polyvariantly: the residual entry block becomes a
`br_if` chain `entry == v0 → arm0, …, else trap`, and each arm is traced with that parameter
constant. The `else trap` is honest: outside the promised domain the residual has no meaning, and
the contract never generates such a case (the same stance a scalar binding takes via `assume`).

**Unrolling and stopping**: a region unrolls as long as the state stays precise — `pc` static means
every fetch, dispatch and operand folds, so one region covers one guest instruction (or a whole
guest straight-line run). The trace stops at: a memo hit (loop closed), a dynamic condition (cut),
a `return`/`trap` (region end), or a budget. Budgets: ≤ 256 regions, ≤ 4096 traced blocks, ≤ 2048
residual statements, ≤ 8 demotion rounds (§3.4); all refuse (function skipped) rather than
truncate. Justification: the corpus VM needs 7 regions and < 20 residual statements; 256 regions
covers bytecode programs of ~500 cells (8x the largest corpus buffer) and still bounds the image
size for the device; the 8-value split cap bounds the entry chain at one comparison per case
(present domain has 2).

**Demotion (the binding-time fixpoint)**: when an arrival at a memoized point finds a live frame
cell (or IR local) that was `CONST` there but is now dynamic — loop-varying, e.g. VM `locals[2]`
which starts 0 but holds the running Fibonacci value after one trip — the trace restarts with that
cell *demoted*: forced `LOC(m)` from the start, so the prologue materializes it (`set m = 0`) and
every store emits `set m = …`. Demotions accumulate across restarts (monotone, so it terminates);
stack cells are *not* demoted this way because cell liveness shows they are written before read at
the loop head — they stay pure block-local dataflow, which is exactly why the residual loop needs
no stack at all.

This trace *is* the binding-time analysis the ticket asks for: it propagates the buffer promise
through `load16u/caddr` chains, computes which values stay static per program point, and its
per-region report (folds, splits, demotions, residual statements) is the binding-time profile.

### 3.4 The residual

Each region becomes one residual block: `set` statements for demoted cells and materialized
values, one `br`/`br_if`/`return`/`trap` terminator, values as ordinary DAG nodes (a value used a
second time is cloned; the `speed` pipeline's `lvn` re-merges the copies, reproducing the hand
code's `const next = a + b`). Prologue `zero` becomes `set m = 0` per demoted cell; non-demoted
zeroed cells stay folded constants. Every residual entity records `origin.from` = the original
statement/value it traces, `because` = the binding fact (`fact:typed.bindings@<rev>#<entity>`) and
the source ids, so `why` walks the residual back to the interpreter's source, and
`revisionCorrespondence` groups them; the original statements are removed with the same `because`.

### 3.5 Checks

1. **The pass is a checked pass**: it goes through `applyPass`, so the meaning contract compares
   the residual with r0 on generated cases (40/case-set by default in `p.apply`), the write
   declaration is enforced on the diff, and the correspondence is validated. The test additionally
   runs the exhaustive domain (13 n-values × 17 seeds × 2 entries, as in IRWB-012) on the
   evaluator, on the RV32 image, and against the independent JS oracle.
2. **The promise check** (§2): refusal on any store that could write the bound buffer.
3. **The dispatch-loop answer stays checked** because the residual is an ordinary artifact: the
   contract sees only "same results on the promised domain", whether the loop was unrolled,
   closed, or split is invisible to it by construction.

## 4. What is measured

For both fixtures (entry 0 Fibonacci, entry 34 checksum), at n=12, seed=8, backend `coalesce: true`:
RV32 instructions and image bytes for (a) r0, (b) r0 + `speed` (the previous best automatic), (c)
r0 + `peval` + `speed` (this work), (d) the hand-specialized loops (75/74). Plus: what the pipeline
contributes after `peval` (peval alone vs peval+speed), code size of each, and where the remaining
gap comes from (per-trip instruction breakdown from the emulator counts). Everything reported from
scripts in this ticket's `scripts/`, committed; the test files re-run the checks.

## 5. Alternatives considered

- **Bind scalars only** (existing `specialize`): measured by IRWB-012 — `speed` is *slower* than r0
  here (9,286 vs 7,678); scalars are not where the loop's time is.
- **Extend constprop with a constant-memory fact**: a load-at-dynamic-address cannot fold without
  the pc trace, so the dispatch never disappears; it would only help a scalar-bound pc.
- **Generate residual Typed source and re-lift**: breaks artifact identity, correspondence and
  `why`; rejected.
- **Runtime promise check**: rejected (§2).
- **Monovariant specialization** (one residual, no entry split): cannot fold the first fetch; the
  dispatch loop survives. Polyvariant splitting on the input domain is what makes the projection
  work.

## 6. Later

- Calls and f32 in the traced domain (Candela-scale PE, IRWB-007's plan).
- Splitting on more than one parameter (products) and on `oneOf` domains larger than 8.
- The Trick / residual-in-advance for call-heavy interpreters.
- A `strategy` preset composing `peval` into the standard pipelines.
