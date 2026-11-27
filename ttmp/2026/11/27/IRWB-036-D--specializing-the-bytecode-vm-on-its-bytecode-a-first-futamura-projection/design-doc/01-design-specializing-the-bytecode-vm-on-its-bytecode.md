---
Title: 'Design: specializing the bytecode VM on its bytecode'
Ticket: IRWB-036-D
Status: active
Topics:
    - compiler
    - ir
    - performance
    - specialization
    - typed
DocType: design-doc
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/bytecode-vm/main.typed
      Note: |-
        the interpreter this ticket specializes; unchanged
        the interpreter, unchanged
    - Path: repo://corpus/projects/bytecode-vm/project.json
      Note: the fixed 64-cell code image and the entry oneOf; the promise's data
    - Path: repo://src/typed/passes.ts
      Note: typedPass, PASSES, PIPELINES; the fold/cfg/dce passes the residual is built with
    - Path: repo://src/typed/program.ts
      Note: |-
        assume/inputs/specialize, the contract restriction a promise needs
        the contract restriction a buffer promise needs
    - Path: repo://src/typed/specialize.ts
      Note: |-
        the existing specializer (parameter and record-field bindings); gains the buffer form and the memory binding-time analysis
        gains the buffer form and the memory binding-time analysis
    - Path: repo://src/typed/tx.ts
      Note: the only way a pass edits; block/stmt/value construction and commit-time pruning
ExternalSources: []
Summary: 'Design for IRWB-036-D: a constant-buffer host promise (checked statically and by the restricted meaning contract), a binding-time analysis with abstract pointers that folds loads out of the promised buffer, and a dispatch-loop specialization that peels a loop head per constant program-counter state, judged by instructions and code size against the hand-specialized loops (75 and 74 instructions).'
LastUpdated: 2026-11-27T00:00:00-05:00
WhatFor: Implementing and reviewing the first Futamura projection in the Typed compiler.
WhenToUse: Before changing specialize.ts, adding the dispatch pass, or reading the report's numbers.
---

# Design: specializing the bytecode VM on its bytecode

## Goal

The bytecode VM (`corpus/projects/bytecode-vm/`, ticket IRWB-012) interprets a 64-cell program that lives in a
`buffer` parameter. Hand-written loops for its two fixtures run 75 and 74 RV32 instructions; the general VM runs
7,678 and 6,874. This ticket asks the compiler to close part of that gap by specializing the interpreter on the
bytecode itself: the first Futamura projection.

Three pieces are built in this session: a **constant-buffer host promise**, a **binding-time analysis** that
propagates the promise through loads from the promised buffer, and a **dispatch-loop specialization** that removes
the opcode dispatch of a loop whose program counter is known at a program point. All of it is measured in RV32
instructions and image bytes, against the general VM and the hand-written loops.

## The supported input domain

The work is specified for, and only for, the following:

- **The buffer.** A `buffer` (or `string`) parameter whose contents are a finite sequence of 0…65535 cells, given by
  the promise. Two programs are specialized: entries 0 and 34 of the corpus image, each with the fixed 64 cells of
  `project.json`.
- **The promise is a host promise.** It says what every call the program's checks consider passes as that
  parameter. Nothing here proves the host honours it; what is checked is (a) that the program cannot falsify it and
  (b) that the candidate means what r0 means *on calls that satisfy it*.
- **Scalar parameters stay dynamic.** `n` and `seed` are ordinary inputs of the promised cases.
- **What the dispatch specialization needs.** A loop whose head reads a local through a checked address into a
  memory region (`caddr`), where every local assigned in the loop and live into the head has a known constant value
  on the incoming edge. Edges that do not meet that condition keep the general code.

## 1. The promise: one more form of `typed.bindings`

`src/typed/specialize.ts` already carries facts from an outer artifact into Typed code: a parameter binding
(`{fn, param, value}`) and a record-field binding (`{record, field, value}`). This ticket adds a third form:

```ts
export interface Binding {
  readonly fn?: string; readonly param?: string;     // parameter form: that parameter's value
  readonly record?: string; readonly field?: string;  // field form: that field of every such record
  readonly cells?: readonly number[];                 // buffer form: that parameter's whole buffer
  readonly value?: number;                            // (absent in the buffer form)
  readonly entity: string; readonly note?: string;
}
```

`cells` gives the capacity (its length) and the data words. The artifact stays `typed.bindings`: same `factRef`
provenance (`fact:typed.bindings:<id>@<rev>#<entity>`), same `Program.specialize` entry point, same `why` chain
from a folded constant back to the outer entity that established it.

*Alternative considered:* IRWB-007 §12's richer `typed.memory` artifact, with regions named by an access path from
a record parameter, per-region entries, computed origins and word-range entities. That form exists because Candela
reaches five buffers through pointer fields of a kernel record and the promise holds per entry.
*Why not here:* the bytecode VM's interpreter has one buffer parameter, one entry function and one promised region;
a whole new artifact kind, a builder and a second assume path would carry no information this program uses. The
`cells` form is the smallest thing that expresses the promise, and `entities` can come with the first program that
needs them (Later).

### Checks

Two, the same two the record-field binding has:

1. **Static, inside the pass.** A store that can reach the promised buffer would falsify the promise after entry, so
   the pass refuses (`TxError('unsupported')`) when it finds one: every `store` whose address expression reads the
   parameter (directly, through `caddr`, through arithmetic on it, or through a local it was copied into), and every
   `call` that passes the parameter on. `main.typed` writes only `stack` and `locals`, so the check passes.
2. **Restricted meaning contract.** `Program.assume` learns the buffer form: for that function and parameter, the
   case specification becomes `{cells}` — the very cells the promise names. Every later pass is then compared with
   r0 only on calls that pass exactly that buffer, which is the field binding's mechanism (a dotted assumption
   turns into `{oneOf: [v]}`). Each revision records the assumptions it was made under.

*Alternative:* a **runtime guard** — the residual compares the buffer's capacity and cells with the promised ones
and falls back to the general VM. It would make the image mean what r0 means on *every* input, but it keeps the
general interpreter in the image (so the code-size measurement stops being about the residual) and the fallback
path itself needs checking. Left to Later, with a note on what it would cost.

## 2. The binding-time analysis: abstract pointers over one promised buffer

The promise is only useful if a load from it becomes a constant. Inside the `specialize` pass, each function with
a promised buffer is walked once with a small abstract interpretation over value trees:

```text
  a ∈ { const n, ptr off, ⊤ }        (off = byte offset into the promised buffer)
  get p                     p is the promised parameter, never reassigned   -> ptr 0
  add(ptr a, const n)  /  add(const n, ptr a)                               -> ptr (a+n)
  sub(ptr a, const n)                                                       -> ptr (a-n)
  caddr(ptr a, const k)     k <u cells.length   -> ptr (2k)   (the range check folds away)
                            otherwise           -> ⊤          (the trap stays)
  load16u(ptr a, imm)       4 ≤ a+imm, (a+imm-4)/2 < cells.length  -> const cells[(a+imm-4)/2]
  load32(ptr a, imm)        both cells of the word in range         -> const (little endian)
  anything else                                                             -> ⊤
```

A `ptr` is never materialized as a value: it only travels up the tree so that a load can read the promise. Every
folded load is replaced by a constant whose `because` is the fact reference for that word, so `why` on the
residual's operand reaches the promise. The `caddr`'s trap is *proved* away only when the position is below the
capacity, which is what the promise's `cells.length` gives.

The recursion is on value trees, not on the CFG, which is enough here: the parameter is never reassigned, so
`get p` means the buffer on every path. Where a form of the fact needs a join (a buffer reached only through a
record field, or a pointer stored in a local), the analysis yields ⊤ and the code stays general — that is what
stops it, and it is listed in the report.

*Alternatives considered:* extend `src/typed/sccp.ts` with the `ptr` lattice value (IRWB-007 §14). SCCP is not in
`PASSES`, runs over SSA, and adds a lattice join and an edge-executability flag — machinery this program does not
need, because the promise makes the buffer's address a property of a parameter, not of a phi. Keeping the analysis
inside `specialize` also keeps one pass that binds facts, rather than a binding pass plus a folding pass whose
order matters.

After the binding pass the ordinary `fold`/`cfg`/`dce` do the interpretive work they already do: the fetch of
`code.charCodeAt(pc)` and `code.charCodeAt(pc+1)` is a constant when `pc` is, so the opcode comparison folds, the
`if`/`else if` chain prunes to one arm, and the arm's arithmetic on `sp` folds when `sp` is constant.

## 3. The dispatch-loop specialization

### The shape it exploits

Lifted, `runVm` is one natural loop (81 of 82 blocks) with two loop-carried locals: `pc` and `sp`. The head reads
`code` at `pc` through `caddr`; the arm chain ends by jumping back to the head. When `pc` and `sp` are known on an
incoming edge, everything the dispatch does on that edge is decidable at compile time — which arm, which operand,
which stack slot — and the arm's exit reaches the head with the next `(pc, sp)` pair, also known.

### The pass (`dispatch`, new: `src/typed/dispatch.ts`)

Per function, per application:

1. **Find the dispatch heads.** A natural loop (the `loops` fact) whose head block reads a local through a
   `caddr`/`load*` pair. Its state is `assigned(loop) ∩ liveIn(head)` (the `liveness` fact): the locals that
   survive the loop, which for the VM are exactly `pc` and `sp`.
2. **Find the state of every edge into the head** with a per-edge constant analysis of those locals: a worklist over
   the CFG carrying a map *local → constant | ⊤*, transfer per block over its `set` statements, meet = agree else
   ⊤. The value of edge `u → H` is the transfer of `u`'s out-state.
3. **For each edge whose state is fully constant:**
   - if the state is already in the memo, retarget the edge to that state's materialized entry;
   - else, **peel**: clone the loop body (every block of the natural loop, with fresh ids and an origin from the
     block it copies), redirect every in-loop edge to the copy, insert `pc = c` and `sp = d` at the start of the
     copy's head, retarget the edge to the copy, and record the state.
4. **Stop** when no edge carries a constant state, or when the clone budget (`maxClones`, default 64 per function)
   is reached; edges that arrive afterwards keep the original head, so the general dispatch survives for them and
   the program stays correct (a mixed threading). The head block itself is removed by the ordinary pruning once
   nothing jumps to it.

The pass does no semantic reasoning of its own: `constprop`, `fold`, `cfg` and `dce` do it, as they do for every
other optimization. Peeling only gives them a block in which `pc` and `sp` are constants.

### How it is driven, and why the result stays checked

One `dispatch` application peels the edges it can see constants for *now*; the constants of the next state come out
of the cleanup passes. So the driver reserves the order for a fixed point:

```text
  specialize(bindings)                       the promise: buffer + entry + folded loads
  repeat until the program stops changing:
      dispatch, constprop, fold, simplify, cfg, dce
```

Every step is one checked revision: the framework diffs the pass against its input, enforces the declared writes,
builds the correspondence from the origins and the `because` of each removal, and runs the meaning contract against
**r0 under the promise's assumptions** on seeded cases (40 per revision, the project's own input specs). Nothing
here reaches around that: the residual is an ordinary `typed.blocks` program, so `why`, `check` and the RV32
backend all work as for any revision.

*Alternative considered:* an interpreter-level unroller that reads the bytecode at compile time and emits one
residual block per program point directly. It gives the same residual with less transient code, but it takes over
the folding of every arm, so the meaning of the residual would rest on new code the contract's cases are the only
check on. Peeling keeps the semantics in the folded IR that every other pass is checked through; its cost is a
transient copy of the loop per program point, which the cleanup passes remove before publication and which the
report measures as compile time.

*Alternative considered:* full filibustering — leaving the loop unrolled over k iterations (loop unrolling with a
constant trip count) instead of one block per program point. That repeats the dispatch code the specialization is
trying to delete; peeling on the program counter removes it entirely.

### What it will not do

- A state that is not constant on an edge (a bytecode whose stack depth differs on two paths into the same
  program point) is not specialized: the edge keeps the general dispatch. For a well-formed stack program the
  depth is a function of the program counter, so the VM's fixtures never hit this; a malformed one is left general.
- The residual keeps the source's frame arrays: after specialization a stack access has a constant offset
  (`frame + 4k`), but it is still a load/store from the frame area. Scalarizing frame arrays whose address never
  escapes into locals is a separate pass (IRWB-002 item E5); the report measures what is left on the table
  without it, and it is the first item under Later.

## 4. What is measured, and against what

For each fixture (entry 0 = seeded Fibonacci, entry 34 = rolling checksum) at `n = 12, seed = 8`, with the same
backend options as the project notes (`coalesce: true`):

| image | how it is made |
| --- | --- |
| general r0 | the corpus program as lifted |
| general speed | the project's `speed` pipeline |
| **specialized** | `specialize` with the buffer and entry promises, then the dispatch fixpoint, then `speed` |
| hand-written | the two loops the IRWB-012 notes call hand-specialized, through `speed` |

and reported: RV32 instructions (emulator steps), instructions per guest instruction (the JavaScript oracle's
dispatch count, 184 and 160), image bytes, statements, blocks, and the number of residual RV32 instructions the
dispatch machinery still costs. Also: what stops the specialization (states left general, budget hits), and the
compile time of the fixpoint.

Correctness evidence beyond the per-revision contract: every one of the 442 valid calls (2 entries × 13 counts × 17
seeds) run on the residual's RV32 image against r0's image and against an independent JavaScript VM.

## 5. Decisions

| # | decision | alternative | reason |
| --- | --- | --- | --- |
| D1 | the promise is a `cells` form of `typed.bindings` | a new `typed.memory` artifact (IRWB-007 §12) | one fact kind, one provenance path, one assume path; the VM needs one buffer |
| D2 | checked statically (no reachable store, no escaping call) and by the restricted contract | a runtime guard in the residual | the guard keeps the general interpreter in the image and needs its own check; zero cost here since the corpus image is fixed per project |
| D3 | the BTA is an abstract-pointer walk inside `specialize` | extend SCCP's lattice with `ptr` | no join is needed for a never-reassigned parameter; keeps one binding pass and its order |
| D4 | dispatch specialization peels a loop head per constant state and lets `fold`/`cfg`/`dce` finish | an interpreter-level unroller that emits per-program-point code | the residual's semantics stay in the IR the contract checks; the transient clone is removed before publication |
| D5 | state = loop-assigned locals live into the head, all constant | the whole live-in set, or `pc` alone | `pc` alone leaves `sp` dynamic (bounds checks and dynamic frame offsets per stack access); the full live-in set includes temporaries that are not loop-carried |
| D6 | stop on a non-constant state or on a clone budget | unroll a fixed number of iterations | data-driven; a malformed program stops instead of growing |
| D7 | the fixpoint is a driver function (`specializeOnBytecode`) | a new entry in `PIPELINES`, or `repeatUntilStable` | the fixpoint needs a bindings artifact per program, which a strategy node cannot pass today; the pipeline composition is unchanged, so no other project's results move |

## 6. Later

- **Frame-array scalarization** (IRWB-002 E5): after specialization every stack access has a constant offset, so
  the frame array can become locals; that is where the remaining gap to the hand-written loops mostly is.
- **A runtime guard** for the promise, and the general VM kept as the fallback (IRWB-002 E2 applied to memory).
- **The richer `typed.memory` fact** with regions named by access path and word-range entities, for a program that
  reads several buffers through a record (Candela, IRWB-007).
- **Params for strategy algorithms**, so the whole fixpoint can be a named strategy a project ships in
  `strategies/<name>.json`.
- **Copying the promise into a bytecode-level polyvariant budget**: per-entry clones of the interpreter function
  rather than one function with two residual dispatch trees (only matters when one program serves both fixtures).
