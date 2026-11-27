---
Title: Instruction attribution through correspondence, and the licm fix for loops that share a head
Ticket: IRWB-034-F
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Design for IRWB-034-F: credit executed RV32 instructions to the pass decisions that produced them, use it to find why speed slows the bytecode VM, and fix licm."
LastUpdated: 2026-11-27T10:15:00-05:00
WhatFor: "What will be built in this session, and why each decision was taken"
WhenToUse: "Before reading the code of src/typed/attribution.ts or the licm change"
---

# Instruction attribution through correspondence, and the licm fix for loops that share a head

## Goal

At `n = 12, seed = 8` the `speed` pipeline takes the bytecode VM's Fibonacci from 7,678 to 9,286 RV32
instructions and its checksum from 6,874 to 8,218 (backend option `coalesce: true`). This session

1. builds a callable attribution: every executed instruction of an image is credited to the pass decision
   that produced it, and every executed instruction of the baseline image is debited to the decision that
   changed it, so the difference between two revisions splits into per-decision terms;
2. uses it on the bytecode VM under `speed` to name the decision that costs the extra instructions;
3. fixes that decision in the compiler, with the bytecode VM at or below r0 under `speed`, the other projects'
   instruction totals not worse, and parity clean.

## Preliminary evidence (probes 01 and 02)

Two probes ran before this design, to know what the attribution must be able to explain.

- `scripts/01-pass-prefix.mjs` applies `speed` one pass at a time and counts both fixtures after each pass.
  The counts fall from 7,678 to 6,688 (Fibonacci) through the first `cfg`, `fold` and `cfg`, then **`licm`
  raises them to 9,287** and the callee-saved registers from 0 to 10. No later pass changes them by more than 1.
  `inline` and `rotate` change nothing (one function; the dispatch head is not a lone test).
- `scripts/02-licm-listing.mjs` prints the IR and the counted image before and after `licm`. The dispatch loop
  `while (true)` has one head (`bb:runVm.3`) and nine back edges, one per opcode arm. `typed.loops` reports one
  natural loop **per back edge**, all with the id `loop:runVm@bb:runVm.3`. `licm` treats each as a loop of its
  own: for each it makes a preheader and redirects every predecessor of the head that is outside *that* loop's
  body, which includes the latches of the other eight. The nine "preheaders" form a chain that every back edge
  now runs through. After `cfg` merges the chain it is one block of 15 `addi rd, sp, k` (the hoisted frame
  addresses `frame+0`, `frame+16`) and a jump, executed 184 times per Fibonacci run.

The probes are a replay of pass prefixes, which tells which pass but not which of its edits. The attribution
must reproduce the licm term from the revisions' own records and split it into edits.

## Supported input domain

- A Typed revision chain as `Program.revisions` holds it: consecutive revisions, each after the first carrying
  the correspondence from its predecessor (`Revision.correspondence`) and its edit log (`Revision.edits`).
  Revisions from `apply`, `pipeline` and `runStrategy` qualify.
- Images lowered by this backend (`lowerToImage`) from the first and last revision with the same options, so
  every instruction carries `covers` (typed.blocks ids of the revision it was lowered from).
- Cases as `casesFrom` or `benchCase` return them (`{ fn, args, memory }`), each finishing within the emulator
  limit. A run that hits the limit or faults is an error of the attribution, not a term in it.

## Part 1: the attribution

### Records it reads

- **Image covers.** Each `ImageInsn` names the value and statement it implements (or only `fn:NAME` for frame,
  save, restore and return code). Execution counts per instruction word come from `runImage` (`counts`).
- **Correspondence per revision.** An entry `{from, to, relation, because, note}` says which entities of the
  revision before became which of the revision after. Typed's `revisionCorrespondence` writes one for every new
  entity (from its origin record) and every removal; the framework adds `retained` for the rest.
- **Edit logs.** An entity that a pass changes in place keeps its id, so its correspondence entry is `retained`
  with no reason. The edit log has the change: `replace` (a value field), `retarget` (a branch target), `move`
  and `insert` (a statement placed in a block), each with `pass`, `rev` and `because`. Without the edit log
  the back edges that licm redirected would look unchanged.

### Decisions

A decision is one pass's change for one reason: the key is `(rev, pass, because)`, where `because` is the
sorted reason ids of the correspondence entry or edit (a loop id for licm and rotate, a rule id for the rule
tables, the inlined call for inline). A decision row also lists the kinds it contains (`created`, `removed`,
`replace`, `retarget`, ...).

### Credit and debit

- **Lineage, backwards.** For an entity of the last revision, walk the chain from the last step to the first.
  At step k, the entry whose `to` holds the entity either retains it (then any in-place edit of it in step k's
  log is a decision of step k, and the walk goes on with the same id) or derives it from `from` (a decision of
  step k; the walk goes on with each `from` id).
- **Fate, forwards.** For an entity of the first revision, walk forwards to the first step that removes it,
  derives something else from it, or edits it in place; that step's decision is its fate.
- **Credit** an executed instruction of the last image, with count n, to the *earliest* decision in the lineage
  of its covers. **Debit** an executed instruction of the first image to the earliest fate of its covers.
  Instructions whose covers have no decision go to `unchanged`; instructions that cover only `fn:NAME` go to
  `frame` (prologue, saves, restores, return), apart, because no pass edits them directly.
- **Net** per decision is credit minus debit. Every executed instruction is credited or debited exactly once, so
  the nets sum exactly to the difference of the two totals. The test checks this identity.

Why the earliest decision: the debit side must use the same rule as the credit side, or a statement that two
passes changed would be debited to one and credited to another. The earliest change is the one at which the
instruction stopped being r0's. The per-instruction rows keep the whole lineage, so a caller that wants the
latest decision (the missed-optimization stage may) reads it from there.

Simplest alternative: replay the pipeline one pass at a time and measure each prefix (probe 01). It names the
pass but not the edit or reason, costs one pipeline run per pass, and cannot attribute a strategy's published
chain without re-running it. It stays as the cross-check: the attribution's per-pass net must agree with the
prefix replay's per-pass difference, apart from the `frame` and `unchanged` terms. That comparison is the
"attribution checked against the emulator" experiment of this session.

### API

`src/typed/attribution.ts`:

```ts
attributeInstructions(chain: readonly Revision[], cases: readonly Case[],
                      options?: BackendOptionsInput): Attribution
```

`Attribution` holds the two totals, the decision rows sorted by |net|, per-pass sums, and one row per executed
instruction of the last image (`id`, `sym`, `count`, `covers`, `lineage`). `Program.attribute(from, to, cases,
options)` is a thin method over it. A non-contiguous chain is an error at entry: "attribution: r<k> is not the
revision after r<k-1>".

Test (`tests/typed/attribution.test.mjs`): on the bytecode VM under `speed` at n = 12, seed = 8, the nets sum to
the difference of totals; before the fix the largest positive decision is licm's, for `loop:runVm@bb:runVm.3`,
within the `frame` term of the prefix replay's licm step; a chain of one revision has one `unchanged` row and no
difference. The test pins the attribution after the fix too (the licm term then negative or small).

## Part 2: the fix

### Cause, as the probes describe it

`typed.loops` returns one natural loop per back edge. When several back edges share a head, licm runs once per
back edge, and each run's "outside predecessors" include the other back edges. The preheader is then on the
loop's own back edges and the hoisted code runs every iteration. This is a missed merge, not a cost estimate
gone wrong: the textbook natural loop of a head is the union of the bodies of all its back edges.

### Change

In `licm`, group `facts.loops` by head and treat each group as one loop: body and assigned locals are the
unions, and the preheader is recomputed against the union body (the single outside predecessor if it has one
successor, else a new block). The hoisting rule itself is unchanged. Assigned locals as a union are at least as
conservative as each part, so a hoist that was valid stays valid.

Alternatives:

- **Skip loops whose head is shared (a guard).** Simplest. It loses hoisting in such loops, which in the
  bytecode VM only hoists frame addresses worth one `addi` per use. Measured as a variant and reported.
- **Merge in `typed.loops`.** The principled place: it also fixes the duplicate loop ids. But the `Loop` fact
  has a single `latch`, the workbench lists the fact, and rotate already de-duplicates by head. Changing the
  analysis changes its version, its UI view and every consumer for one consumer's benefit. Left out.
- **A cost check from block frequencies** (`backend/frequency.ts`): reject a hoist when the preheader is
  estimated hotter than the uses. With merged loops the preheader runs once, so the check would never fire on
  this program; it answers a question the merge removes.

Expected effect, argued only: the chain of preheaders disappears (about 16 instructions per guest instruction,
184 guest instructions, about 2,900 per Fibonacci run). Whether the 15 hoisted frame addresses, now live across
the whole loop, cost saves or spills is measured, not assumed.

### Effect on O2 and parity

O2 contains the same licm, so O2 changes too, wherever a head has several back edges where licm runs. Probe 03
counts such heads per project; at the time of writing only the bytecode VM has one (the rest of the baseline
run is pending). Exact O2 expectations in `tests/typed/` change only for projects that have such heads. Parity
(`tools/parity.mjs`: every pass checked against r0, then 100 cases of the head against r0;
`tools/reference-check.mjs --o2`) runs over the whole corpus after the fix.

## Measurements to report

- Bytecode VM, both fixtures at n = 12, seed = 8, `coalesce: true`: r0, O2 and `speed`, before and after.
- Per corpus project: instructions under r0, O2 and `speed` over the cases `typed.metrics` uses (10 per function,
  seed 7, generated from r0 so every revision runs the same cases), with the default backend and with
  `coalesce: true`, before and after (`scripts/03-corpus-measure.mjs`). The case count is the existing metric's;
  this session does not choose a new one.
- The attribution table for the bytecode VM under `speed`, before and after, and its comparison with the prefix
  replay.

## Framework changes

None planned. The attribution reads the framework's `EntityCorrespondence` records and Typed's edit logs; it
needs no new framework API. If the edit-log reading turns out to belong in the correspondence (an in-place edit
recorded as an entry with its reason), that is a Typed change in `revisionCorrespondence`, listed below.

## Left out, and why

- Merging loops in `typed.loops` (above).
- Recording in-place edits as correspondence entries, so `whyEntity` sees them too: it changes every revision's
  correspondence and the rule-table equivalence test pins them; the attribution reads the edit log instead.
- Attributing `frame` instructions (callee saves) to the decision whose live ranges caused them: needs the
  allocator to record why a register was taken. Reported as its own term.

## Later

- Missed-optimization reports from provenance (the next stage) on top of the per-instruction rows.
- Merged natural loops in `typed.loops`, version 2, with the workbench view updated.

## Amendments during implementation

Recorded here rather than rewriting the plan above; the report has the measurements.

- **Step-by-step attribution added** (`attributeSteps`). The whole-chain attribution's per-pass sums did not
  match the prefix replay (up to 344 instructions moved between two cfg runs), because the earliest-change rule
  gives a term to the first pass that touched a statement. Applying the same function to each consecutive pair
  of revisions gives per-step nets that equal the replay by construction. One implementation, two callers.
- **Tried and not kept: licm hoists each distinct expression once.** The merge alone leaves 15 hoisted copies
  of two expressions in the VM, each holding a register across the loop (ten callee-saved), so `speed` is slower
  than r0 at n = 0. Reusing one local per expression shape fixed that and improved five projects, but made
  `orders` slower under `coalesce: true` (a copy from the shared local stays in the loop). Kept as
  `scripts/09-licm-hoist-once.patch`; the report has the measurements.
