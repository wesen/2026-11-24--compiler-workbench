---
Title: Step attribution of executed instructions and a per-header loop for licm
Ticket: IRWB-034-G
Status: active
Topics:
    - typed
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Design: attribute the instruction difference between revisions to pass edits; make typed.loops one loop per header'
LastUpdated: 2026-11-27T10:07:20.011082223-05:00
WhatFor: ""
WhenToUse: ""
---

# Step attribution of executed instructions and a per-header loop for licm

## Goal

Two things, in this session:

1. A callable attribution: for one concrete call, credit the difference in executed RV32 instructions between
   r0 and the head of a pipeline to the pass decisions that caused it, with sums that equal the emulator's counts.
2. A compiler fix for the decision the attribution names, so that `speed` runs the bytecode VM in at most r0's
   instructions, with no corpus project worse than before and parity clean.

## What is already known (measured before this design)

`scripts/01-per-pass-steps.mjs` runs the VM (n = 12, seed = 8, `coalesce: true`) after every pass of `speed`:

| after | Fibonacci | checksum |
| --- | ---: | ---: |
| r0 | 7,678 | 6,874 |
| cfg, fold, ..., second cfg | 6,688 | 5,968 |
| licm | 9,287 | 8,219 |
| end of `speed` | 9,286 | 8,218 |

One pass, licm, costs 2,599 instructions; every other pass helps or does nothing. O2 shows the same step.
`scripts/02-licm-listing.mjs` prints the IR around it. The dispatch loop has one header (`bb:runVm.3`) and nine
back edges. `typed.loops` returns one loop per back edge, nine loops with the same id and header and different
bodies. licm makes a preheader for each, and retargets to it every jump to the header from outside *that* loop's
body. A back edge of loop A is outside loop B's body, so it is sent through B's preheader: the nine preheaders
and the fifteen hoisted `inv = frame+0` statements end up on the back edges and run on every dispatch.

The attribution below is built to state this from the records, per decision, instead of from reading the listing.

## Supported input

- A chain of published revisions of one program (`Program.revisions`: artifact, pass name, edits), r0 first.
- One concrete call (function, arguments, guest memory) that finishes without trap or step limit on every
  revision's image. A call that traps or hits the limit is rejected with an error where the run is made
  (`attribute: <fn> did not finish at r<k>`).
- Images lowered by this backend with one set of backend options for the whole chain.

## Attribution

### Method: one exact step per pass

For each pair of consecutive revisions A (before pass P) and B (after), lower both, run the call on both with
per-instruction counts, and sum the counts per *site*:

- an instruction that covers a statement belongs to that statement (the backend records `covers: [value, stmt]`);
- an instruction that covers only the function (frame, saved registers, `ret`) belongs to the site `frame`;
- an instruction that covers nothing belongs to the site `backend`.

Sites of A and B are joined into groups: a statement with the same id on both sides is one group; a statement
new in B joins the group of its `origin.from` when that is a statement of A (a `replaceStmt`), and is its own
group otherwise (an insertion). Each group has a delta, instructions in B minus instructions in A. The deltas of
a step sum to `steps(B) - steps(A)`, and the steps sum to `steps(head) - steps(r0)`; both are emulator counts,
so no instruction is unaccounted for and none is estimated.

Each group is then credited to a *decision*, read from P's edit records for the group's statements:

- the kinds of the edits that name the statement (`insert`, `replace`, `retarget`, `remove`, `move`,
  `replaceStmt`), with the note of the edit or of the new statement's origin (`hoisted out of loop:...`,
  `merged with its only successor`) and the `because` ids;
- a group with a delta and no edit is credited to `P: indirect`: the statement is unchanged and the backend
  compiled it differently (another register, a spill, a jump that no longer falls through). The frame site is
  reported as `P: indirect, frame`.

The result is rows `{ rev, pass, decision, because, delta, after, statements }`, and a roll-up by decision
over the whole chain. This follows instructions through several passes by construction: a statement that licm
inserts and cfg later moves appears in licm's step with its cost and in cfg's step with the change the move made.

### Decision: per-step differences, not one r0-to-head comparison

The simplest alternative compares r0 with the head once: trace each head instruction's covered ids back through
`origin.from` to an r0 statement and credit the newest pass on that chain. It needs two runs instead of one per
revision. It falls short on the question asked: when cfg removes a jump (a saving) and licm later rewrites the
same statement (a cost), the two effects land on one row under the newer pass, and a saving of 990 instructions
by the cleanup passes would hide part of licm's cost. Per-step differences keep each pass's effect separate, and
the price is one lowering and one emulator run per changed revision (the VM's `speed` chain has 8 of them;
the time is reported with the results).

### Decision: sites are statements

Values would be a finer site, and `covers` has them. The edits name statements (`stmt`, `from`, `to`), so
statement sites join to decisions without a second mapping; a row lists its statements, and `Program.why`
answers the finer question for any of them. Value-level sites: Later.

### API (new file `src/typed/attribute.ts`)

```ts
attributeSteps(revisions, call, options?) -> Attribution
//   revisions: readonly { rev, pass, artifact, edits }[]   (Program.revisions)
//   call:      { fn, args, memory }                        (a Case from benchCase or casesFrom)
//   options:   { backend?: BackendOptionsInput }
// Attribution: { call, totals: { rev, pass, instructions }[], rows: AttributionRow[], decisions: DecisionRow[] }
formatAttribution(a, { top? }) -> string   // the decisions table as text
```

`tools/attribute.mjs <project> <pipeline> <fn> [--input JSON] [--coalesce] [--rows]` prints the table for a corpus
project (buffers default to the project's own inputs). One test (`tests/typed/attribute.test.mjs`) checks, on a
small two-back-edge loop and on the VM, that the rows of each step sum to the emulator's difference and that the
largest positive decision is the one expected.

## The fix

### Decision: `typed.loops` returns one loop per header

A natural loop is defined per header: the union of the bodies of its back edges. `loopsOf` will group back edges
by header and return one loop with the union body, `latch` (the first back edge's source, as now) and `latches`
(all of them), the exits and assigned locals of the union, and the preheader computed against the union. For the
VM the preheader is then the entry block, nothing is retargeted, and the hoisted statements run once.

- Simplest alternative: licm skips a header with more than one back edge. It meets the VM's target (the code
  stays as it is before licm: 6,688) and loses hoisting in every loop with a `continue`; and the analysis keeps
  returning nine loops with one id, which the next consumer would trip over. Not chosen unless the corpus
  measurement shows the union regressing a project.
- Fixing only licm (group by header inside the pass) leaves the same duplicate ids in the analysis and in the
  workbench's loop view. The analysis is the place; its version goes to 2 because its output changes.

rotate already handles one header once (`done`), so it sees no change in what it does.

### To measure after that (and change only if the numbers say so)

With the union loop licm still hoists `frame+0` fifteen times into fifteen locals. `frame+K` is one `addi` from
sp; a hoisted copy saves that `addi` per use only while the local has a register, and costs a reload when it is
spilled. Two candidate refinements, each measured on the VM and the corpus before it is kept:

1. licm does not hoist a bare `aaddr` (a one-instruction leaf, like `const` and `get`, which it already skips);
2. licm reuses one local for structurally equal invariant trees in one loop.

### New approach to try: the static cost estimate as a gate

`backend/frequency.ts` estimates instructions per call from block frequencies. Probe: compute the estimate
before and after each pass of `speed` on the VM and on the corpus, and compare the sign of its change with the
emulator's. If it agrees, a pass-level guard (`reject a licm result whose estimate is higher`) is cheap and
general; if it does not, report the disagreement. This is an experiment; the fix above does not depend on it.

## Acceptance

- VM under `speed` and O2, Fibonacci and checksum at n = 12, seed = 8: at or below r0 (7,678 and 6,874).
- `scripts/03-corpus-measure.mjs` before and after: no project higher under O2 or `speed` (default options and
  chains + coalesce + homes), summed over the seeded cases `measure` uses.
- `tools/parity.mjs` with no failures; typed, framework and workbench tests pass.

## Left out

- A profile-guided guard in `speed` (choose between the pipeline with and without licm by emulator count): the
  `fastest-all` strategy already does that kind of choice, and it would hide the defect instead of removing it.
- Changing the corpus notes' measured table for the VM beyond the numbers this fix changes.

## Later

- Value-level sites and attribution to rewrite rules (`because` rule ids) for the missed-optimization stage.
- Attribution across backend options (the same revision under two option sets).
- Attribution summed over a case set with weights, for whole-corpus tables.

## Outcome (added after the implementation)

The report (`reference/02-report-why-speed-made-the-bytecode-vm-slower.md`) has the results. Where the work
departed from this design:

- The loops change alone met the VM's target and raised one corpus cell (regex-nfa under O2 with the tuned
  options). Refinement 2 (one local per equal invariant tree) became part of the fix, on by default.
- That exposed a coalescer limit in orders, fixed in `backend/coalesce.ts`. The design did not foresee a
  backend change.
- Refinement 1 (do not hoist a bare `aaddr`) was measured and dropped.
- The estimate guard was measured and is not used.
- The tool takes `--backend JSON` in addition to `--coalesce`.
