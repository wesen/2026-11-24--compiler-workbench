---
Title: 'D1 design: instruction attribution through correspondence, and a licm cost check'
Ticket: IRWB-034-D
Status: draft
Topics:
    - compiler
    - ir
    - performance
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: src/typed/passes.ts
      Note: the typed passes; licm is the pass this design changes
    - Path: src/typed/attribution.ts
      Note: the attribution tool this design specifies (new file)
    - Path: src/typed/backend/run.ts
      Note: runImage returns per-word execution counts; heat attributes them to statements through covers
    - Path: src/typed/backend/image.ts
      Note: image instructions carry `covers` (the typed.blocks ids they implement)
    - Path: src/typed/program.ts
      Note: the revision chain with one correspondence per pass, which the attribution composes
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T09:45:21-05:00
WhatFor: ""
WhenToUse: ""
---


# D1 design: instruction attribution through correspondence, and a licm cost check

## Executive summary

`speed` makes the bytecode VM run **more** RV32 instructions (fib 7,678 → 9,286; checksum 6,874 → 8,218
at `n = 12, seed = 8`). The cause is `licm`: it hoists the address computations of every opcode arm
(`addi t, sp, 0`, `addi t, sp, 16`) out of the dispatch loop into a block that is executed on **every**
dispatch, while the original computation ran only on the dispatches that took that arm (12 of 184 for the
PUSH arm). Measured by ablation: `speed` without `licm` runs 6,688 / 5,968 instructions — better than r0.

Two deliverables follow.

1. **An attribution tool** (`src/typed/attribution.ts`, callable, with a test) that credits every executed
   RV32 instruction to the pass decision that produced it, by composing the revision chain's
   correspondences back to r0 and reading the image's `covers`. It answers both "which decisions hold the
   instructions" and "which decisions cost the difference against r0".
2. **A cost check in `licm`**: a hoist is kept only when the moved expression is guaranteed to execute at
   least once per execution of the block it is hoisted to — structurally, only when the defining block
   dominates every exit of the loop. A preheader is created only when at least one hoist survives that
   check. The argument is exact and needs no profile: it shows the hoisted cost is never larger than the
   cost it replaces.

## Problem statement

`ttmp/2026/11/26/IRWB-012--bytecode-vm/` reports the measured regression; this ticket's probe
`scripts/01-reproduce.mjs` reproduces it, and `scripts/02-ablation.mjs` shows that the whole regression is
attributable to one pass:

| pipeline (bytecode VM, n = 12 seed = 8) | fib | checksum |
| --- | ---: | ---: |
| r0 | 7,678 | 6,874 |
| `speed` | 9,286 | 8,218 |
| `speed` without `licm` | 6,688 | 5,968 |
| `licm` alone on r0 | 7,192 | 6,460 |

Ablation alone says *which pass*, not *which decision* and not *why*. The task asks for the attribution from
the compiler's own records, and for a tool the next stage (missed optimizations from provenance) can reuse.
The two questions — "which decisions hold the instructions" and "why is `licm` wrong here" — need the same
data: executed instruction → image instruction → `covers` → IR entity → correspondence → the pass and edit
that made it.

### What `licm` did (measured, `scripts/03-licm-shape.mjs`)

`typed.loops` (natural loops, one per back edge) finds **9 loops with the same head `bb:runVm.3`** and 9
different latches: after `cfg` splits the dispatch chain, every opcode arm ends with its own jump back to the
head, so the one logical `while (true)` is 9 overlapping natural loops. None of them has a unique preheader,
so `licm` creates one per loop (9 blocks), retargeting every outside predecessor of the head to the new
block, and hoists into it.

`licm` recorded 24 inserts, 15 locals, 18 retargets, 15 replaces. 13 of the inserts are address computations
(`v:runVm.44` and friends, `sp + 0`, `sp + 16`) from opcode arms, each hoisted with
`note: "hoisted out of loop:runVm@bb:runVm.3"`. In the `speed` image those 13 `addi` are executed 172–184
times each — once per dispatch — while the statement they were taken from ran 12, 48, 74 or 97 times.

## The attribution tool

### Inputs

Everything comes from records the compiler already keeps:

- the revision chain: for each pass, the artifact and its `EntityCorrespondence` to the previous revision
  (`Program.revisions`); a correspondence entry is `{from: [...] , to: [...], relation, note}` where
  `relation` is the id of the pass that made the change, or `removed`, or the implicit retention that
  `makeCorrespondence` adds;
- each revision's `Edit` records (`insert`/`replace`/`remove`/`move`/`retarget`/`block`/`local`/`record`
  with `note` and `because`), which is where a pass states its decisions;
- the lowered image (`rv32.image`): every instruction carries `covers`, the `typed.blocks` ids (a value and
  its statement) it implements, and the function entity for prologue and epilogue instructions;
- a run (`runImage`), which returns per-word execution counts.

### Algorithm

Given a chain `r0 … rN` and a run of the image lowered from `rN`:

1. **Lineage.** For each step `i`, build the backward map `after → before[]` from its correspondence. For a
   statement of `rN`, walking back `N` steps gives the set of r0 statements it descends from (empty when a
   pass made it from nothing). The map is built once per chain and cached.
2. **Credit.** For each image instruction with count `c`, take its statement cover (`s:` id; an instruction
   whose covers are only a function id is credited to that function bucket, so the prologue, epilogue and
   frame adjustments are visible). `c` is credited to
   `(statement, pass that produced it, its r0 roots)`. The pass that produced a statement is read from the
   statement's own `origin` (`{from, via, rev}`, the front end for r0 statements): this is the compiler's
   record of *which decision placed this instruction*, including the `note` (`hoisted out of …`).
3. **Totals are checked, not assumed.** The sum of credits must equal `run.steps`; if an instruction cannot
   be credited (no covers, or a cover the artifact does not hold) it lands in an `unattributed` row, which
   the tool reports rather than silently dropping.
4. **Difference against r0.** For each r0 root, compare the instructions credited to it at r0 with the
   instructions credited to its descendants at `rN`. A root whose count changed is credited to the pass that
   changed it (the pass of the non-front-end rows for that root). The deltas sum to `steps(rN) − steps(r0)`,
   which the test asserts.

### Output

```ts
attributeRun(chain, step, run) -> {
  total,                       // steps of the run; the credits sum to it
  rows: [{ statement, fn, pass, note?, roots, insns }],
  byPass:   [{ pass, insns }],
  unattributed
}
deltaBetween(base, next) -> [{ root, pass, base, next, delta }]
```

Rows are sorted by instructions, so the table is, in the report's words, "the decisions and the
instructions credited to each". `deltaBetween` answers the ticket's question directly.

### Why not the existing heat/`heat()`?

`heat()` attributes to statements of *one* revision and to source lines; it cannot say which pass caused an
instruction or what it replaced. The attribution composes the same `covers` with the correspondence chain.

## The fix in `licm`

### The rule

Hoisting a value from block `D` to a preheader `P` replaces `count(D)` executions with `count(P)`
executions. `P` executes once per **entry** into the loop; `D` executes once per iteration in which its
block is reached. Entries can exceed iterations (an entry may leave the loop without ever reaching the
latch), which is exactly what happens in the bytecode VM: `D` ran 12 times, `P` ran 172 times.

Guard, first draft: hoist out of loop `L` only when the defining block `D` **dominates every exit of `L`**.

Argument (no profile, no threshold): if `D` dominates all exits then every path from the head to an exit
runs `D`, hence every entry into `L` that reaches an exit executes `D` at least once, hence
`count(D) ≥ count(entries) = count(P)`. The hoist therefore never increases the number of executions, and
strictly decreases it when `D` executes on more iterations than the loop is entered, or when `D` computes
values with more than one use. This is the same structural property LLVM's `isGuaranteedToExecute` uses
(there for trap safety, here for cost).

### Revision after measuring: the rule is two checks, not one (deviation from the plan)

The exit-dominance guard is too strong, and the corpus says so. `D` must also dominate the *trap* and
*return* exits, and Typed's loops have a bounds-check trap inside them by construction, so the guard refused
Blend's hoist — the running example of the spec, whose O2 image is pinned by `tests/typed/backend.test.mjs`
(88 bytes / 451 instructions) — and every hoist in `licm-nested`, which is the project that exists to show
hoisting through two loops (1,678 → 2,677 instructions, i.e. back to r0). An exit that leaves the loop for
good (a trap, a return, a loop exit) costs at most one extra execution per entry; it cannot cost in
proportion to the trip count, which is what the bytecode VM did.

The rule that ships has two checks:

1. **The loop's head has a single back edge.** When the CFG gives one head several back edges (the
   bytecode VM's dispatch loop has nine), each natural loop is a fragment, and every preheader sits on the
   path of the *other* back edges: it runs once per **re-entry**, not once per iteration. This is the
   defect; it is also what the nine overlapping natural loops are.
2. **`D` dominates the loop's latch.** Every iteration that reaches the back edge computes `D`, so the
   hoist saves on every iteration and can only lose the entries that leave the loop before the latch — at
   most one per entry, the zero-trip cost every LICM pays.

A nested loop passes both: its inner head has a single back edge (the outer latch jumps to the outer head),
and its body dominates its latch. The bytecode VM's arms pass neither: nine back edges, and the arm that
computes `sp + 0` does not dominate the dispatch loop's latch.

### Lazy preheader

A preheader is only worth its `br` when something is hoisted into it. `licm` will compute the candidate
hoists for the loop first, and create the preheader (and retarget the head's outside predecessors) only if
at least one candidate passes the check. Without this, `licm` leaves 9 empty preheader blocks in the
bytecode VM, each costing a jump per dispatch. The 18 `retarget` edits are part of that churn.

### What licm records

Each accepted hoist already records `note: "hoisted out of loop:…"`. Each refused hoist records
`tx.record('skip', { stmt, value, block, why })` with one of two reasons (`not certain to execute on every
iteration of …`, `<head> is the head of N natural loops: the preheader of … runs once per re-entry`), so the
next stage can find a missed optimization — or a refused one — from the compiler's records rather than by
guessing, and the attribution can show the decision as made.

## Alternatives considered

- **Drop `licm` from `speed`.** One line, fixes the bytecode VM (6,688 / 5,968), and is wrong for the other
  projects that `licm` helps; the loops ticket (IRWB-003) put it there for the options chains. It would
  also leave the actual defect (a hoist that can increase the count) in place for every other pipeline.
- **Per-pass frequency estimates from the emulator** (compile r0, run the cases, feed block counts back into
  `licm` as a cost model). This is the most precise option and it is what the workbench can do, but it
  couples a typed pass to a backend and to the program's cases, and the loop-invariant rule above needs no
  measurement. Kept as a later option (see the report's "Later" list).
- **Only hoist when the loop has a unique preheader** (`L.preheader !== null`). Smaller change, and it
  removes the 9 bogus preheaders, but it refuses profitable hoists in exactly the loops where the CFG has
  several back edges, and it does not state the cost property. The back-edge count subsumes it: with no
  guaranteed execution, no hoist; when a hoist survives, the preheader it needs is created.
- **Hoist to the innermost loop containing all uses.** Does not help here: the single use of `sp + 0` is in
  the same block as its definition, and any enclosing loop still runs it more often than the arm does.
- **A cost model checked against the emulator** (predict instructions per decision, compare with measured
  counts). Attractive, but the mapping from a decision to instructions is exactly the attribution tool, and
  a per-decision prediction would be a second implementation of the same job. The tool measures; the rule
  argues.

## Implementation plan

1. `src/typed/attribution.ts`: `chainOf(program)` (revisions → steps), `lineage` composition,
   `attributeRun`, `deltaBetween`; export from `src/typed/index.ts` (or the typed barrel that exists).
2. `tests/typed/attribution.test.mjs`: totals sum to `steps`; r0 against itself has no deltas; on the
   bytecode VM's `speed` chain, `licm` is the pass with the largest credited instructions before the fix and
   the deltas name the 13 hoists; a small fixture program (one loop, one arm) shows a hoist credited to
   `licm` with the preheader's count.
3. `tools/attribution.mjs`: the CLI the report and the next stage use
   (`node tools/attribution.mjs <project> <pipeline> --entry … --n … --seed …`).
4. `licm` in `src/typed/passes.ts`: `needs.dominators`, the exit-dominance check, lazy preheader, `skip`
   records.
5. `scripts/`: `04-attribution.mjs` (the table for the report), `05-corpus.mjs` (instructions per corpus
   project under O2 and `speed`, before and after), `06-check.mjs` (the parity/regression checks).
6. Tests to run before the last commit: `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`,
   `tests/workbench/*.test.mjs`, `node tools/build-site.mjs`.

## What will be measured, and what will only be argued

Measured: the attribution table for the bytecode VM under `speed`; instructions per corpus project under O2
and `speed` before and after; parity (`tools/parity.mjs`, `tools/reference-check.mjs`); the meaning checks
every pass already runs (40 cases, r0 contract).

Argued: that the exit-dominance rule cannot increase the execution count (the `count(D) ≥ count(P)`
argument above), and that no other corpus project regresses — the second is measured on the corpus totals,
not proved per program.

## Open questions

- Does the check cost correctness anywhere? No: it only removes hoists, so the pass still means what r0
  means; the contract checks it in any case.
- Does the conservative rule lose measurable wins elsewhere in the corpus? Measured in step 5; if a project
  loses, the report says which and by how much.
