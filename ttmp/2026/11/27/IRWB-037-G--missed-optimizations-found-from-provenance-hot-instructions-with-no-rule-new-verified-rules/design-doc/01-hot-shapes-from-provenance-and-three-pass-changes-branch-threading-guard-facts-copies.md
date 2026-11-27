---
Title: 'Hot shapes from provenance, and three pass changes: branch threading, guard facts, copies'
Ticket: IRWB-037-G
Status: active
Topics:
    - compiler
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: A tool that ranks executed instructions by code shape and provenance; three pass changes and a rule experiment chosen from its tables
LastUpdated: 2026-11-27T12:57:28.191688635-05:00
WhatFor: ""
WhenToUse: ""
---

# Hot shapes from provenance, and three pass changes: branch threading, guard facts, copies

## Goal and input domain

Find executed instructions that no rule or pass has improved, name the code shapes behind them, and add the
rules or pass changes that pay, each checked as passes are now.

- **Programs:** the 50 corpus projects, and the three benchmark calls of IRWB-014, 015 and 017 (regex
  `[a-c]*[b-d]*a*d` over `abccabbd`; LZ `roundTrip` over 100 seed-7 cases; chess `chessSearch` on
  quiet-mate-in-two at depth 3).
- **Pipelines:** O2 and `speed`. O2's pass list stays as it is (the book and three tests pin it).
- **Measure:** executed RV32 instructions on the emulator, with the default backend options and with
  chains + coalesce + homes ("tuned").

## Baseline, measured before any change (`scripts/01-benchmarks.mjs`)

| Benchmark | r0 | `speed` | `speed` tuned | Reference |
| --- | ---: | ---: | ---: | ---: |
| regex | 8,183 | 6,933 | 5,405 | 6,628 |
| LZ, 100 cases | 185,876 | 159,079 | 156,782 | 156,405 |
| chess | 14,804,396 | 11,021,307 | 10,038,193 | 10,827,760 |

D1's fix took regex from 8,040 to 6,933 with the default options. The gap to the reference is now 305
instructions with the default options, and with the tuned options we are 1,223 below it.

## Part 1: the tool (`src/typed/missed.ts`, `tools/missed.mjs`)

`attributeSteps` credits the difference between two revisions to pass decisions. It does not say what is left.
`hotShapes(head, calls)` answers that for one revision:

- run the head image on the calls with per-instruction counts;
- credit each executed instruction, through `covers`, to its statement and to its value node;
- abstract the statement to a shape (`if geu(x, #)`: locals are `x`, constants `#`, with 0, 1 and -1 kept) and
  the node to the pattern a rule would match (the operator over its operands' operators);
- label each site with its provenance: the passes named in the origins of the statement and of the values under
  it. `ingest` alone means no pass touched it;
- per shape: instructions, the untouched part, sites, a hottest example; per node pattern also the number of
  table rules with that root operator.

The simplest alternative is the per-statement listing of `scripts/02-hot-listing.mjs`. It shows the same counts,
and 30 separate bounds checks stay 30 lines; the shape table makes them one row of 1,742 instructions.

### What the tables show (measured, `various/06-*`, `various/07-corpus-shapes-before.json`)

Regex under `speed`, default options, 6,933 instructions:

| Shape | Instructions | Untouched | Sites |
| --- | ---: | ---: | ---: |
| `if geu(x, #)` (a frame-array bounds check against a constant length) | 1,742 | 1,742 | 30 |
| `if eq(load(add(x, shl(x, #))), 1)` | 680 | 0 | 2 |
| `if ge(x, x)` (loop tests) | 539 | 0 | 10 |
| `x = eq(load(...), 1)` then a branch on `x` in the next block | 280 + 64 | 0 | 1 |

Corpus under `speed`, default options, 653,178 instructions, 43.1% at statements no pass touched. Node patterns:

| Pattern | Instructions | Untouched | Sites | Reading |
| --- | ---: | ---: | ---: | --- |
| `set x` (`a = b`) | 56,172 | 24,450 | 325 | copies, most from inlined parameters |
| `if geu(x, #)` | 19,432 | 19,432 | 59 | constant bounds checks, never touched |
| `if geu(x, load)` | 21,641 | 18,200 | 142 | buffer bounds checks (bce's shape) |
| `br` | 18,760 | 6,240 | 135 | jumps, many into a block that only branches |
| `br_if x`, `set 0`, `lt(x, #)`, `if eqz(x)` | 15,996 + 8,374 + 5,566 + 5,236 | | | a boolean stored, then tested in the join block |
| `div(x, #)`, `rem(x, #)` | 20,617 + 10,867 | 3,950 | 64 | signed division by 2^k where the sign is not known |

13 of the 27 simplify rules never fire under `speed` on the corpus.

### The gap to the reference, without a source map (`scripts/04-spectrum.mjs`)

The reference image has no positions (`scripts/03-probe-reference-debug.mjs`: the compiler returns the image,
entries and signatures only). Both images run the same loops the same number of times, so instructions are
joined by their execution count: for each count n, the static instructions that ran n times in each image.
For regex the largest classes are n = 64 (29 against 27), n = 72 (9 against 8) and n = 32 (15 against 22, in our
favour: inlining). Reading the two sides of a class shows the reference keeps the same repeated bounds checks.
Its advantage is constants kept in registers (`bne t0, s7` where we build `1` each time) and a loop that ends in
one branch. Both are our backend options `homes` and `chains`. So the reference gap gives no rule; the shapes
above come from the provenance tables.

## Part 2: three pass changes

Each is a change to an existing pass, so O2 and `speed` both get it and no pipeline list changes. The
alternative, three new passes added to `speed` only, would leave O2 as it is; D1's report lists O2 results above
r0 as work for this stage.

### 2.1 `cfg`: a block that only branches on a local is copied into the blocks that jump to it

Shape: `t = c; goto J` in one predecessor, `t = 0; goto J` in another, and `J: if t goto A else B`. This is what
`a && b` lifts to.

- For a block J whose only statement is `br_if` on `get t` or `eqz(get t)`, and which is not the entry and not
  a loop head, each predecessor ending in `br J` gets a copy of the branch instead.
- It is tail duplication, as `rotate` does for loop heads, so it is valid whatever the predecessors do. Loop
  heads are left to `rotate`, which runs after licm for the reason its header gives.
- Never more instructions on a path: the path ran a jump and a branch and now runs a branch.
- The rest happens in passes that follow: constprop and cfg fold `t = 0; if t`, subst folds `t = c; if t` into
  `if c`, and then `typed.ranges` refines on `c`, which it cannot do through `t`.
- Simplest alternative: leave it to the backend's `chains`. That removes the jump and keeps the stored boolean
  and the lost range fact.

### 2.2 `bce`: a check that dominating branches already decide

Shape: `if (state >=u 9) trap` three times in a row on the same `state`, and `row = 5 * state` followed by
`if (row >=u 45) trap`, `if (row + 1 >=u 45) trap`.

- Facts: an interval per SSA name (`typed.ssa`, a framework analysis, becomes a declared need of bce).
  The pass walks the dominator tree. Entering a block whose only predecessor ends in `br_if`, it narrows the
  names the condition compares: `lt le gt ge eq ne` as `typed.ranges` does, and `x <u y` with `y >= 0` gives
  `0 <= x < y`.
- A check `if c goto T` with T a trap block is decided when the intervals of c's operands decide c. An
  operand's interval is `evalRange` over the tree, where a read takes its name's fact, or, for a name defined by
  a `set` of an expression without loads, calls or division, the interval of that expression under the current
  facts (depth 4: `row + 1` is two steps from `state`; measured on the corpus before fixing the number).
- Soundness: an SSA name has one value per activation of its definition, and a use dominated by a branch edge
  sees the same activation the branch tested, so a fact holds in every block the edge dominates.
  Interval arithmetic is `evalRange`'s, which gives the full interval on overflow.
- Simplest alternative: add unsigned refinement to `typed.ranges` and decide checks from `ranges.of`. That
  covers the repeated `state >=u 9`. It does not cover `row`: `row` is assigned before the check on `state`,
  and an interval per local cannot narrow `row` afterwards. The SSA walk can, because the fact is about the
  name that `row`'s definition reads.
- Only checks (a trap arm) are decided. A parameter `all` decides any branch; I measure it and report it.

### 2.3 `subst`: a copy of a local is read through

Shape: `inRange_code = code` (an inlined parameter), 56,172 instructions over the corpus.

- For `x = y` where the SSA name of `y` it copies is still the current name of `y` at a read of `x`, the read
  becomes a read of `y`. When no read and no phi is left, dce removes the copy.
- Current names come from the same dominator-tree walk as 2.2.
- Simplest alternative: the backend's `coalesce`. It exists and is off by default; with it on, this change
  should add little. I measure both.

### Framework change

`src/framework/dataflow/scoped.ts`: `walkDominatorTree(root, children, enter)` with a `ScopedMap` whose writes
are undone when the walk leaves the block that made them.

- Reason: 2.2 and 2.3 both need "what holds in the blocks this block dominates". This is the scoped-table
  walk of dominator-based value numbering and of SSA renaming; `ssaOf` has its own copy of it, which stays.
- `typedPass` accepts `ssa` as a need.

## Part 3: rules

Candidates are written from the hot node patterns, verified with `verifyRule`, and measured on the corpus. I
expect little: the backend's tiles already cover `sub(x, #)`, `add(#, x)` and comparisons against zero. Rules
that hold only for non-negative operands must be rejected by the verifier, with a counterexample. A rule is
added to the simplify table when it is sound and lowers a count; its evidence is recorded with the options the
table's records use (`random: 1e6, seed: 7, exhaustive32: true`).

## Tests and measurements

- `tests/typed/missed.test.mjs`: the tables sum to the emulator's count; untouched means `ingest` only.
- `tests/typed/guards.test.mjs`: each pass change on a small program, with the meaning check, and a program
  where the fact must not be used (the name is reassigned between the branch and the check).
- `tests/framework/`: the scoped walk.
- Corpus: `scripts/08-corpus-measure.mjs` before and after, with the reference column; the three benchmarks;
  `tools/parity.mjs` and `tools/reference-check.mjs`.

## Left out

- A value-level `why` for a hot instruction (statement and node are enough to name shapes).
- Attribution of the remaining instructions to rule ids: rule firings are counted per rule instead.

## Later

- Congruence facts (`row` is a multiple of 5), which the checks on `5 * queue[head] + 3` need.
- Buffer checks against a loaded length (`if geu(x, load)`), beyond what bce proves now.
- Check merging for `caddr` across blocks (LZ: 24,192 instructions in `caddr(x, add)`).
- A sparse analysis over SSA names in `src/framework/dataflow`, of which 2.2's walk is one instance.

## Addendum: what changed during the implementation

The text above is the design as committed before the implementation (badf42a). Four things changed, each
because of a measurement. The report has the numbers.

- **Passes of their own, in `speed` only.** The phases inside cfg, bce and constprop changed the book's O2
  examples, and nine tests pin those. They became the passes `thread`, `guards`, `copies` and `subst-mem`; O2 is
  unchanged.
- **`thread` decides a constant arm itself and runs twice.** The inner join of a nested `&&` appears only
  after the first run and a cfg.
- **`guards` also bounds loop counters and reduces `x / 2^k`, `x % 2^k`.** `typed.ranges` loses the lower
  bound of an outer loop counter under an inner loop, so `strength` left chess's `dense / 8`.
- **A rule table was added after all** (`identities`, three rules), for the shapes `guards` leaves. The first
  round of candidates confirmed the design's expectation: 192 instructions.
