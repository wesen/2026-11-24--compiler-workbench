---
Title: 'A standard library of compiler algorithms, step 1: liveness over the machine code and the coalescer'
Ticket: IRWB-046-C
Status: active
Topics:
    - stdlib
    - framework
    - liveness
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The interface, the scope decision and the layout for src/stdlib/, and its first primitive: backward gen/kill liveness, adopted by the register allocator's intervals and by the copy coalescer, with byte-identical RV32 images as the acceptance."
LastUpdated: 2026-11-27T00:00:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# A standard library of compiler algorithms, step 1: liveness

## 1. What this step builds

IRWB-039 phase 2 (design doc `01-...`, "Phase 2: the standard library") starts `src/stdlib/`: pure, synchronous
implementations of standard compiler algorithms over small shape interfaces, never over a domain's types. This
session is step 2a (the skeleton, the index, the import test) and step 2b (liveness, adopted by the two clients
that carry it today):

- `src/stdlib/` laid out so that the later primitives have an obvious place, with an index that states the layers
  and the admission rule;
- the **liveness** primitive, in `src/stdlib/flow/liveness.ts`;
- `intervals()` in `src/typed/backend/regalloc.ts` and `coalesceCopies()` in `src/typed/backend/coalesce.ts` read
  their liveness from it, and their own sweeps are deleted;
- tests: the primitive's behaviour including an unreachable block, and the import boundary of the library.

Acceptance is byte-identical output: the RV32 images, instruction counts and edit censuses of every corpus project
under `r0`, `O2` and `speed`, and the CUDA sources and `optimizeTix` revisions of every Tix program, unchanged from
IRWB-039's recorded baselines (`scripts/02-baselines.mjs check`).

## 2. Admission: why liveness is the first primitive

The rule (design doc, "Admission", from R3): a named theory, two clients, an executable checker or fixture, pure and
synchronous; and the promotion test names both clients, the law, the code it retires, and one input on which a
careless extraction changes meaning.

| | |
|---|---|
| Named theory | liveness of a variable at a program point: backward gen/kill dataflow, `liveOut(b) = ∪ liveIn(s)` over successors, `liveIn(b) = use(b) ∪ (liveOut(b) − def(b))`, least fixpoint over sets. Textbook (Dragon Book 9.2.6; Appel, *Modern Compiler Implementation*, 10.1). |
| Clients | `intervals()` in `src/typed/backend/regalloc.ts` (line 85) and the liveness block at the top of `coalesceCopies()` in `src/typed/backend/coalesce.ts` (line 32). These are line-for-line the same two sweeps — per-block uses and definitions, then the fixpoint — before either client does anything of its own. |
| Executable checker | `tests/stdlib/liveness.test.mjs`: hand-computed sets on a diamond with a loop, an unreachable block, an empty block, and a register used twice in one instruction. |
| Pure and synchronous | four shape functions in, sets out; no clock, IO, or shared state. |
| Input where a careless extraction changes meaning | the unreachable-predecessor graph of §5: the machine code says block 1 is live-out {64, 65}, an entry-reachable solver says {}. `scripts/01-unreachable-block-scopes.mjs` prints both from this checkout. |

## 3. The layout of `src/stdlib/`

Design doc, step 2a, from layering D: `graph lattice num` use nothing; `ssa flow` use them; `pe affine term` above;
`check measure` on top. A module is a file at `src/stdlib/<layer>/<algorithm>.ts`; `src/stdlib/index.ts` is the
library's index — it lists the layers, states the admission rule, and re-exports what exists. Nothing else is
created now: later steps add their files to the directory their layer already names.

```
src/stdlib/
  index.ts                the index: layers, admission rule, what exists, what is planned
  flow/liveness.ts        this step
```

One line each for the modules later steps put there (from the design doc's Phase 2 and 4):

- `graph/dominators.ts` — immediate dominators (Cooper, Harvey and Kennedy) and the dominator tree; `typed/analyses.ts` is its first client, `check/` its second.
- `graph/loops.ts` — natural loops, preheaders and loop bodies from retreating edges and dominators.
- `graph/postorder.ts` — depth-first order, reverse postorder, retreating edges; today inside `framework/dataflow/solver.ts` (`depthFirst`).
- `lattice/lattices.ts` — the lattice interface with the standard instances (flat, powerset, map, interval), moved from `framework/dataflow/lattices.ts`.
- `lattice/fixpoint.ts` — worklist and round-robin solvers with widening at loop heads, moved from `framework/dataflow/solver.ts`; liveness's own loop (§4.4) is the first thing it absorbs.
- `num/intervals.ts` — integer intervals and their arithmetic and comparison rules, from `typed/guards.ts`.
- `ssa/ssa.ts` — SSA construction and destruction (Cytron et al. renaming, pruned or not), from `typed/ssa.ts`.
- `pe/partial-eval.ts` — folding, residualisation and `solveFor`, from `typed/`'s specialiser work.
- `affine/affine.ts` — affine forms over index expressions, with the extent-17 counterexample as its test.
- `term/terms.ts` — a term signature with matching and instantiation, for rewrite rules as data.
- `check/verify.ts` — translation validation helpers shared by meaning contracts.
- `measure/frequencies.ts` — block and edge frequencies, and the estimate comparisons the backend makes (regalloc's spill estimates, `typed/backend/frequency.ts`).

Read that list as the tier each file belongs to, not as a plan this session executes: this step builds `index.ts`
and `flow/liveness.ts` only.

## 4. The interface

`src/stdlib/flow/liveness.ts`. Everything is numbered: blocks are `0 .. blockCount-1`, a block's items are a range
of item positions, variables are any value type `V`. Nothing in the module knows what a block, an item or a variable
is.

### 4.1 The shape

```ts
export interface LivenessShape<V> {
  /** Number of blocks; block indices are 0 .. blockCount-1. */
  readonly blockCount: number;
  /** Successor block indices of `block`. */
  successors(block: number): readonly number[];
  /** The items of `block`: `start` and `end` are item positions, inclusive. A block has at least one item. */
  items(block: number): { readonly start: number; readonly end: number };
  /** The variables the item reads. May be called more than once per item: return a re-iterable, not an iterator. */
  reads(item: number): Iterable<V>;
  /** The variables the item writes. */
  writes(item: number): Iterable<V>;
}
```

**Input domain** (the only inputs the primitive is specified for): a finite graph — `blockCount` finite and every
`successors(block)` entry in `0 .. blockCount-1`; every block's `items(block)` with `0 <= start <= end`; every item
in `0 .. end` of exactly one block; and finite `reads`/`writes`. Off that domain (a successor index out of range, a
reversed range, a variable that is read but never written or vice versa — neither is checked) the result is
unspecified; the primitive raises no error of its own.

`reads`/`writes` return `Iterable`, not `ReadonlySet`: both clients already hold an `MInsn` accessor that returns a
small array (`usesOf`, `defsOf`), and the primitive only iterates. Taking sets would make every client allocate two
`Set`s per instruction for nothing — on a 3,000-instruction function, 6,000 allocations per liveness call.

### 4.2 The scope

Required, with no default:

```ts
export type LivenessScope =
  | { readonly blocks: 'all' }                                  // every block, reached or not
  | { readonly blocks: 'entryReachable'; readonly entry: number }; // blocks on a path from `entry`
```

A default would hide exactly the decision this step exists to expose, and the two answers differ on real machine
code (§5). A caller that has not thought about it should be made to choose.

### 4.3 The result

```ts
export interface Liveness<V> {
  /** Variables live into / out of each block, indexed by block. */
  readonly liveIn: readonly ReadonlySet<V>[];
  readonly liveOut: readonly ReadonlySet<V>[];
  /**
   * Visit the items of `block` newest first, giving each item the variables live after it. The set is the
   * sweep's working set: it is valid only during the call and must not be modified.
   */
  walkBackwards(block: number, visit: (item: number, liveAfter: ReadonlySet<V>) => void): void;
}
```

`walkBackwards` is a callback rather than `liveAfter: ReadonlySet<V>[]` because the coalescer walks every item of
every block backwards anyway, one mutable `Set` per block; an array of per-item sets would cost one copy per
instruction (`O(n · |live|)` instead of `O(n)`) to hand the client a set it immediately discards. It stays a pure
function of the shape and the scope — the walk is deterministic and its only effect is on the caller's callback.

### 4.4 The algorithm

1. Per block, upward-exposed uses and definitions, in item order: `use(b) += reads(i) − def(b)`, `def(b) += writes(i)`.
2. The least fixpoint of the two equations, by round-robin sweeps in reverse block order (the clients' order) until
   no block's `liveIn` or `liveOut` changes. Under `'entryReachable'` the sweep visits only blocks a depth-first walk
   from `entry` reaches; the others keep `{}`.
3. `walkBackwards`: start from `liveOut(block)`, and for each item from `end` down to `start` give the item the
   current set, then remove its writes and add its reads.

The schedule is not observable: gen/kill with union join and set intersection is monotone from below, so every
schedule converges to the same least fixpoint. A worklist in reverse postorder visits fewer blocks per fixpoint; the
round-robin sweep costs at most a small constant more on machine code — the blocks of one function are few and the
sweeps converge in the depth of the loop nest — and it is the schedule both clients use today, so the extraction
cannot be blamed for a numeric change. The later `lattice/fixpoint.ts` (§3) is where the schedules become shared and
chosen, not here.

## 5. The scope decision: the unreachable predecessor

`scripts/01-unreachable-block-scopes.mjs` (probe 01) builds the case from the ticket:

| block | code | what liveness says with `'all'` | with `'entryReachable'` |
|---|---|---|---|
| 0 `entry` | `j join` | in {64, 65}, out {64, 65} | in {64, 65}, out {64, 65} |
| 1 `dead` | `j join` (nothing jumps to `dead`) | **in {64, 65}, out {64, 65}** | **in {}, out {}** |
| 2 `join` | `add rd66, r64, r65; ret` | in {64, 65}, out {} | in {64, 65}, out {} |

The join uses `r64` and `r65`, so the join's live-in is `{64, 65}`; block 1's live-out is the union of its
successors' live-in, so it is `{64, 65}` whether or not anything reaches block 1. Both answers are correct answers to
different questions:

- `'all'` — *liveness of the code as laid out*, which is the question a register allocator asks: block 1's
  instructions are emitted, they read and write registers, and an interval that ignores them may be given a register
  that block 1's instructions are still using. The primitive's `'all'` answer matches what `intervals` computes
  today (the probe prints `live-out {64, 65}` for block 1).
- `'entryReachable'` — *liveness of the executions that happen*, which is the question an analysis asks: a frame no
  execution enters keeps no registers. This is the framework solver's answer (the probe prints `out {}` for block 1
  with `src/framework/dataflow/solver.ts`, whose `sources` filter drops unreachable predecessors).

**Both clients take `'all'`.** That is what they do today, and it is the only choice that keeps the images identical.
What a careless extraction would change: the block facts of block 1 feed the interval construction — a register live
into an unreachable block gets a `touch` at that block's `start`, and a register live out of it a `touch` at
`end + 0.5`, which is how `intervals` stretches an interval over a whole block. With `'entryReachable'` those
touches vanish, an interval's start moves forward, its end moves back, and it can lose a `crossesCall` that the
unreachable block's span created — each of which changes which register linear scan picks, or whether it spills. So
the trap is not only "the live-out set of a dead block differs": the wrong scope silently changes allocation
decisions on a function whose unreachable code crosses a call.

Probe 02 (`scripts/02-unreachable-blocks-in-corpus.mjs`) asks whether the corpus can catch this: over 100
project-pipelines (every corpus project at `r0` and at the `speed` head) and 3,730 Typed basic blocks, **0 functions
and 0 blocks are unreachable**. The baselines therefore say nothing about the scope, which is why §7's test asserts
both scopes rather than only the one the clients use.

Forward dataflow does not have this escape: for a backward problem the predecessor's facts are derived *from* the
successor's, so an unreachable predecessor cannot pollute a reachable join, and the reachable blocks' facts are the
same under both scopes. That is why the whole difference shows up as dead-block facts — and why a test that only
checked the join would pass under either scope.

## 6. The clients, and what they give up

Both edits are deletions plus a call:

- **`regalloc.ts`** keeps `machineBlocks` (the block shape) and `usesOf`/`defsOf` (the item accessors), and gains
  `machineLiveness(code, blocks?)`, which binds the two to a `LivenessShape` with `scope: { blocks: 'all' }` and
  states in one sentence why that scope. `intervals()` loses its use/definition loop and its fixpoint (about 24
  lines) and reads `liveIn`/`liveOut` from the primitive. `Interval` construction, `touches`, `crossesCall` and
  `allocate` are untouched.
- **`coalesce.ts`** loses the same two sweeps (about 23 lines) and builds its interference edges inside
  `walkBackwards(block, …)`: for each item, each definition interferes with what is live after it, with the two
  copy exceptions (IRWB-003's copy exception and IRWB-034-G's `a <- s; b <- s`) unchanged.
- **`Intervals.liveOut`** changes type from `Set<number>[]` to `readonly ReadonlySet<number>[]`: the primitive hands
  out read-only sets, and nothing in the repository reads `liveOut` (it is returned for inspection). No runtime
  change.

A third copy stays: `physicalOccupancy()` in `regalloc.ts` sweeps the same backward equations a third time, over
`Int32` bitmasks, for a non-leaf function's `fa0`-`fa7` clashes. It is not one of the two clients this step names,
and it is not the same code: it works on bitfields and answers `occupied(r, from, to)` and `liveOut(r, at)` queries by
prefix counts. Rewriting it against the primitive means converting sets to bitmasks per instruction, in a path the
baselines cover only incidentally, for no gain this step; it is listed under Later (§8) with the reason.

## 7. Tests

`tests/stdlib/liveness.test.mjs` (new suite directory, beside `src/stdlib/`):

1. a diamond with a loop: hand-computed `liveIn`/`liveOut` per block, and per-item live sets from `walkBackwards`;
2. an instruction that reads one variable twice counts once;
3. an empty-ish block (label plus terminal) carries its successors' liveness through;
4. **the unreachable block of §5**: with `'all'`, block 1's live-out is `{64, 65}`; with `'entryReachable'`, block 1
   has no liveness at all. The test states both, so the scope is a documented property of the primitive and not an
   accident of its implementation;
5. `'entryReachable'` on a graph whose entry is not block 0 — only what the entry reaches is visited.

`tests/stdlib/imports.test.mjs`:

- every module under `src/stdlib/` imports nothing outside `src/stdlib/` — in particular nothing from `src/framework/`,
  `src/typed/` or `src/tensor/`, and no Node builtin and no package (read as source: no build required, same
  technique as `tests/framework/layering.test.mjs`);
- the layers of §3 hold: a module may import another stdlib module only from the same layer or a lower one;
- `src/stdlib/index.ts` re-exports every module the library contains, so a module cannot be added without a client
  finding it.

The second assertion is the one thing here beyond what the ticket asks for: without it "an obvious place for later
primitives" is a comment, and the first `pe/` module that imports `flow/` would be found later than it should be. It
is nine lines. Banning bare imports is the same argument one step further: an algorithm that reads a file, hashes
with `node:crypto` or takes the clock is not a library algorithm, and the day one is needed is the day to say why.

The existing `tests/typed/` backend tests must pass unchanged — they assert allocation, images and the byte
identities of the corpus, so they check the extraction as a side effect.

## 8. Alternatives considered

| Decision | Simplest alternative | Why not |
|---|---|---|
| Where liveness lives | leave both copies and put the primitive somewhere for later | the promotion test exists to retire code; two line-for-line copies in one file tree are the strongest case the library will ever get |
| Interface granularity | take the domain's instruction list and let the library call `usesOf`/`defsOf` | that is a domain interface (`MInsn`, virtual register numbering ≥ 64); the library would then be a Typed library in a stdlib directory |
| Variables as numbers | `V = number`, as both clients have | a generic `V` costs one type parameter and admits the Typed locals (also numbers) and, later, SSA names and Tix value ids; the sets are the same `Set` either way |
| Scope | one scope: entry-reachable (the framework solver's) | changes the images — §5 — and the ticket asks for the disagreement to be explicit, not resolved |
| Scope | one scope: all blocks | answers the compiler's question but not the analysis question; it also reads as an accident of the implementation rather than a stated domain |
| Scope | a boolean `reachableOnly` | a boolean at the call site reads `true` for "only reachable", and the two scopes are not a toggle over one algorithm: the entry is a parameter of one |
| Per-item results | `liveAfter: ReadonlySet<V>[]` | one `Set` copy per item for the coalescer, which discards each set immediately (§4.3) |
| Per-item results | recompute from `liveOut` on each `liveAfter(i)` call | quadratic per block for a client that asks about every item |
| Fixpoint schedule | worklist in reverse postorder | not observable (§4.4); the later shared solver is the place to pick, and the clients' order keeps the extraction blameless |
| Fixpoint location | build `lattice/fixpoint.ts` now and express liveness over it | that is step 2c, whose decision point is "if an adapter is larger than the algorithm it replaces, keep the domain copy"; a lattice adapter for two set operations would be larger than the 12-line loop it replaces |

## 9. Later (not this session)

- `graph/*`, `lattice/*`, `num/*`, `ssa/*`, `pe/*`, `affine/*`, `term/*`, `check/*`, `measure/*` (§3): later steps of
  IRWB-039 phase 2 and 4.
- Liveness's local fixpoint loop moves onto `lattice/fixpoint.ts` once that exists; that is the second client that
  justifies the shared solver (the first being `typed.ranges`).
- `physicalOccupancy()`'s bitmask sweep (§6) — the third copy, convertible once something wants item-level live sets
  as bitfields.
- The framework's own `solve()` keeps its entry-reachable scope and its `depthFirst`; nothing in this step touches
  `src/framework/`.

## 10. Acceptance

1. `node tests/stdlib/liveness.test.mjs` and `node tests/stdlib/imports.test.mjs` pass.
2. `npm run build`, then
   `node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check` prints `no differences` (image hashes,
   instruction counts, edit censuses, CUDA sources and `optimizeTix` revisions).
3. `tests/typed/*.test.mjs`, `tests/framework/*.test.mjs`, `tests/workbench/*.test.mjs`, `tests/tensor/*.test.mjs`
   (not `*-gpu.test.mjs`) pass apart from other steps' `todo` tests.
4. `npm run check` is clean; `node tools/build-site.mjs` still builds (it bundles `src/typed`).
