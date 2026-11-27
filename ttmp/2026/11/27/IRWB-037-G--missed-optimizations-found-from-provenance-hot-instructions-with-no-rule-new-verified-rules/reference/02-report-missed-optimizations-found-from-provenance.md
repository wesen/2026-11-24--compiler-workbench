---
Title: 'Report: missed optimizations found from provenance'
Ticket: IRWB-037-G
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: The hot-shape tool, five passes and three rules added to speed, corpus and benchmark measurements
LastUpdated: 2026-11-27T12:57:37.16505794-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: missed optimizations found from provenance

## Summary

- **Tool.** `hotShapes` (`src/typed/missed.ts`, `node tools/missed.mjs <project> <pipeline> <fn>`) ranks the
  executed instructions of a revision by code shape and says which passes made that code. It complements D1's
  `attributeSteps`, which credits differences. Its first table for the regex matcher: 1,742 of 6,933 instructions
  in 30 constant bounds checks that no pass had touched.
- **Added to `speed`:** four passes found from the tables (`thread`, `copies`, `guards`, `subst-mem`) and a
  rule table of three verified rules (`identities`). Each alone on the old list, default options: thread
  -25,884, guards -16,494, copies -13,780, subst-mem -166; the three rules -7,581 on top of the four.
- **Result.** `speed` over the corpus: 867,770 to 789,710 instructions with the default backend options (-9.0%)
  and 792,800 to 724,721 with chains + coalesce + homes (-8.6%). 30 of 50 projects change, none is higher, no
  pass is rejected.

  | Benchmark | `speed` before | after | tuned before | tuned after | Reference |
  | --- | ---: | ---: | ---: | ---: | ---: |
  | regex | 6,933 | 6,052 | 5,405 | 4,868 | 6,628 |
  | LZ, 100 cases | 159,079 | 147,978 | 156,782 | 140,194 | 156,405 |
  | chess | 11,021,307 | 9,252,728 | 10,038,193 | 8,172,948 | 10,827,760 |

- **O2 is unchanged**, in every cell. Its passes and its list are pinned to the book by tests, and the new
  passes change the book's own examples (see "Where the passes live"). O2 with the new passes inserted,
  measured and not registered: 1,090,271 to 1,042,444 with the default options (-4.4%), 1,032,485 to 1,001,200 tuned (-3.0%).
- **Rules.** Ten candidates from the hot patterns before `guards`: seven sound, three refused by the verifier,
  and together worth 192 instructions. Four more for the shapes `guards` leaves: three fire and take 7,389
  instructions off chess-search. Those three are the table.
- **The reference compiler** has no rule we lack. Its remaining advantage in the regex matcher was constants in
  registers and loop layout, which are our backend options.
- **Framework change:** one, `src/framework/dataflow/scoped.ts`.

## Method

### 1. Measure again (`scripts/01-benchmarks.mjs`, `scripts/08-corpus-measure.mjs`)

The three benchmarks as their tickets measured them, and the corpus over the seeded cases `measure` uses
(10 per function, seed 7), each with the default backend options and with chains + coalesce + homes ("tuned"),
and on the reference compiler's image. D1 had taken regex from 8,040 to 6,933.

### 2. Hot shapes by provenance (`src/typed/missed.ts`)

`hotShapes(head, calls, { backend, rules })`:

- runs the head image on the calls with per-instruction counts;
- credits each executed instruction, through the backend's `covers`, to its statement and to its value node;
- abstracts a statement to a shape (`if geu(x, #)`: a local is `x`, a constant `#`, with 0, 1 and -1 kept),
  and a node to the pattern a rule would match (`eq(load, 1)`: the operator over its operands' operators). An
  instruction that only builds a leaf goes to the leaf's user, and a comparison fused into its branch is `if …`;
- labels each site with the passes named in the origins of its statement and of every value under it.
  `ingest` alone is "untouched";
- returns, per shape: instructions, the untouched part, sites, the hottest example, and for node patterns the
  number of table rules with that root operator.

The rows of each table plus the frame instructions sum to the emulator's count (a test asserts it).
`scripts/07-corpus-shapes.mjs` sums the tables over the corpus and counts rule firings.

### 3. The gap to the reference, joined by execution count (`scripts/04-spectrum.mjs`)

The reference image has no source positions. Both images run the same loops the same number of times, so I
joined instructions by how often they ran: for each count n, the static instructions that ran n times in each
image. A class where we have more instructions is a loop body where the reference is shorter.

- It works as a join: regex has classes at n = 64 (29 instructions against 27), 72 (9 against 8), 32 (15
  against 22).
- It found no rule. The reference repeats the same bounds checks; it is shorter by `bne t0, s7` where we build
  the constant each time, and by a loop that ends in one branch. With the tuned options we were already 1,223
  instructions below it.
- So the candidates came from provenance, not from the reference.

### 4. From a shape to a change

For each hot, untouched shape: read the example, name what would have to be known to remove it, look for the
framework concept that provides it, build the change as a checked pass, and measure it alone and together with
the others (`scripts/09-ablation.mjs`).

## The shapes found

Before, `speed`, default options. Regex is the benchmark call (6,933 instructions); corpus is the seeded
cases that finish (653,178 instructions, 43.1% at untouched statements).

| Shape | Where | Instructions | Untouched | Sites | What it is |
| --- | --- | ---: | ---: | ---: | --- |
| `if geu(x, #)` | regex | 1,742 | 1,742 | 30 | a frame-array bounds check against a constant length, repeated on one index |
| `if geu(x, #)` | corpus | 19,432 | 19,432 | 59 | the same |
| `set x` | corpus | 56,172 | 24,450 | 325 | `a = b`, mostly parameters of inlined calls |
| `br`, `br_if x`, `set 0` | corpus | 18,760 + 15,996 + 8,374 | | | `t = c; goto J` and `J: if t …`, the join of `&&` and `||` |
| `x = eq(load(…), 1)` | regex | 280 | 0 | 1 | the same, with a load in the stored condition |
| `div(x, #)`, `rem(x, #)` | corpus | 20,617 + 10,867 | 3,950 | 64 | signed division by 2^k of a value whose sign the compiler does not know |
| `if geu(x, load)` | corpus | 21,641 | 18,200 | 142 | a buffer bounds check against a loaded length (not addressed) |
| `caddr(x, add)`, `caddr(x, x)` | LZ | 24,192 + 19,684 | 0 | 14 | checked text addresses (not addressed) |

13 of the 27 simplify rules never fire under `speed` on the corpus (`various/07-corpus-shapes-before.json`):
`one-mul zero-mul or-zero xor-zero shl-zero shr-zero shru-zero and-zero and-ones not-eq not-ltu not-geu not-not`.

### The same patterns after this work

Corpus under `speed`, default options, the seeded cases that finish (`various/07-corpus-shapes-after.json`):
576,334 instructions (653,178 before), 31.2% at statements no pass touched (43.1%).

| Node pattern | Before | After |
| --- | ---: | ---: |
| `set x` | 56,172 | 22,643 |
| `br` | 18,760 | 3,921 |
| `br_if x` | 15,996 | 1,402 |
| `set 0` | 8,374 | 3,107 |
| `lt(x, #)` stored, and `if eqz(x)` on it | 5,566 + 5,236 | 1,030 + 98 |
| `if lt(x, #)` (the same comparisons, now in their branches) | 12,637 | 22,739 |
| `if geu(x, #)` | 19,432 | 10,618 |
| `div(x, #)` | 20,617 | 8,865 |
| `rem(x, #)` | 10,867 | 1,254 |
| `if geu(x, load)` (not addressed) | 21,641 | 22,990 |
| `caddr(x, x)`, `caddr(x, add)` (not addressed) | 14,280 + 7,932 | 14,280 + 7,932 |

- In the regex matcher the `if geu(x, #)` that remain are the first check of an index in each iteration, and
  checks such as `5 * queue[head] + 3 <u 45`, which intervals cannot decide. I did not classify the remaining
  ones in the other projects (the before-table's hottest example was the bytecode VM's `sp >=u 4`).
- The remaining `div(x, #)` were not broken down either. The pattern includes divisors that are not powers of
  two (histogram's `/ 10`), which the backend already handles with a multiplication.

## What was added, and what each gave

50 projects

| Variant of speed | Default options | Difference | Tuned | Difference |
| --- | ---: | ---: | ---: | ---: |
| old | 867,770 |  | 792,800 |  |
| thread | 841,886 | -25,884 | 773,982 | -18,818 |
| copies | 853,990 | -13,780 | 797,071 | +4,271 |
| guards | 851,276 | -16,494 | 776,784 | -16,016 |
| subst-mem | 867,604 | -166 | 792,780 | -20 |
| guards+identities | 848,001 | -19,769 | 773,509 | -19,291 |
| all but identities | 797,291 | -70,479 | 728,297 | -64,503 |
| all | 789,710 | -78,060 | 724,721 | -68,079 |

copies: higher than old: sha-chacha tuned 107,102 -> 107,862; chess-search tuned 297,382 -> 301,247

Each row is the corpus under a variant of `speed`'s pass list (`scripts/09-ablation.mjs`; chess-search and
the other 49 projects ran as two processes, `various/09-ablation-speed-chess.json` and `-rest.json`, merged by
`scripts/20-ablation-table.mjs`). `old` is the list before this ticket and reproduces the baseline totals. A
row with one name is the old list plus that pass.

Variants of the parameters and of the order, on the 49 projects other than chess-search (the run with all
variants on chess-search did not finish in the session; `various/09-ablation-extras-rest.json`):

49 projects

| Variant of speed | Default options | Difference | Tuned | Difference |
| --- | ---: | ---: | ---: | ---: |
| old | 540,454 |  | 495,418 |  |
| thread | 534,362 | -6,092 | 489,140 | -6,278 |
| thread+subst-mem | 533,761 | -6,693 | 488,295 | -7,123 |
| all | 510,860 | -29,594 | 482,354 | -13,064 |
| all, guards on every branch | 510,860 | -29,594 | 482,354 | -13,064 |
| all, guards without divisions | 510,860 | -29,594 | 482,354 | -13,064 |
| all, one thread | 511,239 | -29,215 | 482,733 | -12,685 |
| all, copies whole | 520,779 | -19,675 | 483,077 | -12,341 |
| all, lvn again before rotate | 509,536 | -30,918 | 481,030 | -14,388 |

all, lvn again before rotate:  skipped passes: regex-nfa: lvn (absent)

### `thread`: a block that only tests a local is copied into the blocks that jump to it

- **Shape.** `a && b` lifts to `t = c; goto J` in one arm, `t = 0; goto J` in the other, and `J: if t …`.
- **Change.** For a block J whose only statement is `br_if` on `get t` or `eqz(get t)`, not the entry and not
  a loop head, each block ending in `goto J` gets J's branch. When that block's own last assignment to `t` is
  a constant, it jumps straight to the arm.
- **Why it is valid.** It is tail duplication, as `rotate` does for loop heads: each path runs a copy of the
  test where it ran the original. Loop heads are left to `rotate`, which must run after licm.
- **Why twice in `speed`.** The inner join of a nested `&&` is a block of its own only after the outer one is
  gone and cfg has merged. On the 49 projects, one run gives 511,239, two give 510,860.
- **What follows from it.** subst folds `t = c; if t` into `if c`, and then `typed.ranges` and `guards` refine
  on `c`. Collatz under `speed`: 6,955 to 4,861. strings: 10,283 to 8,100.
- **Simplest alternative:** the backend's `chains` removes the jump. It keeps the stored boolean and the lost
  range fact.

### `guards`: what dominating branches decide

- **Shape.** `if (state >=u 9) trap` three times on one `state`; `row = 5 * state` then `if (row >=u 45)`,
  `if (row + 1 >=u 45)`; `dense / 8` for a `dense` that counts from 0.
- **Facts.** An interval per SSA name (`typed.ssa`, a declared need). The pass walks the dominator tree with
  the framework's scoped walk. Entering a block whose only predecessor ends in `br_if`, it narrows the names
  the condition compares: the signed comparisons, `eq`, `ne`, a bare boolean, and `x <u y` with `y >= 0`,
  which gives `0 <= x < y`.
- **A name without a fact** has the interval of its definition: for `x = e`, the interval of `e` under the
  current facts (`evalRange`, four definitions deep; `row + 1` is two from `state`).
- **Counters.** For `q = phi(a, n)` with `n = q + k`, k > 0, `a` defined before the loop, and `q <= MAX - k` at
  the increment by the branch facts: `q >= lo(a)`. One walk finds these with every phi full; a second uses them.
- **Decisions.** A check (a `br_if` with a trap arm) whose pure condition the intervals decide becomes a jump.
  `x / 2^k` and `x % 2^k` with `x >= 0` become a shift and a mask.
- **Why it is valid.** An SSA name has one value per activation of its definition. A block dominated by a
  branch edge is reached only through it, with no newer activation of the names it tested. Interval
  arithmetic gives the full interval on overflow. `decideCompare` and `narrowBy` are tested against every value
  of 28 x 28 small intervals for all eight comparisons.
- **Why not `typed.ranges`.** Adding unsigned refinement there covers the repeated `state >=u 9`. It does not
  cover `row`, which is assigned before the check on `state`: an interval per local cannot narrow `row`
  afterwards. And `typed.ranges` loses the lower bound of an outer loop counter when an inner loop's head
  widens it (`scripts/14-probe-chess-shapes.mjs`: `dense` in [-2^31, 63]), so `strength` leaves `dense / 8`.
- **`params.all`** decides every branch, not only checks: no difference on the 49 projects (an earlier build
  gave -80 over all 50). Off.
- **Attribution.** `tools/attribute.mjs regex-nfa speed regexMatch` now has rows such as
  `guards: replaceStmt (always false: geu([0, 40], [45, 45]))  -112`.

### `copies`: a read of a copy reads the source

- **Shape.** `inRange_code = code`: 56,172 instructions in `set x` over the corpus.
- **Change.** For `x = y`, a read of that `x` becomes a read of `y` wherever the SSA name of `y` the copy read
  is still current (the same walk, with a scoped map from local to current name). dce removes a copy nobody
  reads.
- **Measured.** Alone: -13,780 with the default options, +4,271 tuned. With the default options it is the
  third largest gain alone; with the tuned options the backend's `coalesce` already removes these copies, and `copies` alone costs there
  (sha-chacha's `chacha20Block`: 34 spills against 19, `scripts/15-per-function.mjs`). In the full list no
  project is higher than before in either column.
- **`params.whole`** (only copies all of whose reads can be replaced): worse on the 49 projects,
  520,779 against 510,860 in the full list (default options), 483,077 against 482,354 tuned. Off.

### `subst-mem`: subst, and a load may move into its reader

- **Shape.** `t43 = (load32[…] == 1)` and `if t43` after `thread`.
- **Change.** `subst` with `params.loads`: a value that reads memory (no call, division or checked address)
  moves into its only reader when no store, zeroing or call lies between and the reader makes no call.
- **Measured.** Alone -166 with the default options and -20 tuned; with `thread`, -601 and -845 against
  `thread` alone (49 projects).

### `identities`: three rules for what `guards` leaves

| Rule | Evidence | Firings on the corpus |
| --- | --- | ---: |
| `shl(shr(x, 3), 3) → and(x, -8)` | exhaustive (exhaustive-32 over 4,294,967,296 inputs) | 3 |
| `lt(and(x, 15), 8) → eqz(and(x, 8))` | exhaustive (exhaustive-32 over 4,294,967,296 inputs) | 14 |
| `shl(shl(x, 1), 1) → shl(x, 2)` | proof (symbolic-linear) | 4 |

- They match `dense + ((dense >> 3) << 3)` and `(at & 15) < 8` in the chess code, which exist only after
  `guards` has replaced the divisions, and `((i << 1) << 1)` in f32-dsp.
- Measured as a table pass after the last subst-mem (`scripts/16-rules-after-guards.mjs`): chess-search 286,239
  to 278,850 (tuned 245,751 to 242,367), f32-dsp 45,401 to 45,209.
- Recorded evidence: `src/typed/rules/evidence-identities.ts`, generated by
  `scripts/17-identities-evidence.mjs` with the options of the simplify and fold records
  (`random: 1e6, seed: 7, exhaustive32: true`). A test compares fingerprints.
- Each is one instance of a family. The family cannot be written: a template number is a literal, `log2 k`, or
  an operator over constant variables, so `-1 << k` has no form. See "Later".

## Rule discovery: what did not pay

`scripts/11-rule-candidates.mjs`, candidates written from the node patterns of the baseline tables:

| Candidate | From the pattern (instructions) | Verifier | Firings |
| --- | --- | --- | ---: |
| `eq(and(x, 1), 1) → and(x, 1)` | `eq(and, 1)`: 320 | sound | 0 |
| `eq(x, 0) → eqz(x)` | `if eq(x, 0)`: 1,333 | sound | 61 |
| `ne(x, 0) → x if bool x` | `ne(x, 0)`: 82 | sound | 0 |
| `ne(x, 0) → x` | `if ne(x, 0)`: 6,190 | unsound, x = -128 | |
| `add(add(x, #a), #b) → add(x, #a+b)` | `add(add, #)`: 60 | sound | 0 |
| `sub(add(x, #a), #b) → add(x, #a-b)` | `sub(add, #)`: 198 | sound | 0 |
| `shl(shl(x, 1), 1) → shl(x, 2)` | `shl(shl, 1)`: 192 | sound (proof) | 4 |
| `lt(rem(x, 16), 8) → eqz(and(x, 8))` | `lt(rem, #)`: 4,289 | unsound, x = -1431655766 | |
| `lt(and(x, 15), 8) → eqz(and(x, 8))` | the same after strength | sound | 0 |
| `shl(div(x, 8), 3) → and(x, -8)` | `shl(div, #)`: 3,794 | unsound, x = -2147483647 | |

- All seven sound ones in simplify's table: 822,611 to 822,419 over the corpus, all of it f32-dsp
  (`various/11-rule-candidates.json`; measured on the build of that moment).
- `eq-zero` fires 61 times and saves nothing: the backend's tiles already compare against `x0`. The same holds
  for `sub(x, #)` and `add(#, x)`, which I did not write as candidates after reading `select.ts`.
- The two hottest patterns are unsound as written, and the verifier said so with a negative x. They became
  sound and hot once `guards` had proved the operand non-negative and replaced the division: a rule that needs
  a fact is a pass plus a rule.
- So the missed optimizations of this corpus are mostly not rules: 70,479 instructions came off
  through the four passes and 7,581 through the three rules (default options; the ablation table).

## Corpus: instructions per project

`scripts/08-corpus-measure.mjs` before and after, `scripts/19-corpus-table.mjs`. A cell with an arrow changed.

| Project | Reference | r0 | O2 | O2 tuned | speed | speed tuned |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| across-calls | 700 | 660 | 640 | 630 | 270 → 240 | 210 |
| algebra | 170 | 100 | 20 | 20 | 20 | 20 |
| blend | 1,715 | 2,255 | 1,925 | 1,750 | 1,915 → 1,750 | 1,585 |
| bounds-lab | 4,234 | 5,923 | 5,333 | 4,843 | 5,012 → 4,817 | 4,426 |
| bounds-offset | 894 | 1,364 | 1,364 | 1,268 | 1,355 → 1,285 | 1,258 |
| bounds-param | 426 | 502 | 502 | 452 | 499 → 449 | 408 |
| bounds-two | 675 | 910 | 810 | 710 | 756 → 706 | 665 |
| branches | 211 | 165 | 139 | 131 | 139 | 131 |
| bytecode-vm | 28,889 | 39,954 | 32,295 | 24,750 | 32,295 → 31,981 | 24,750 → 24,593 |
| call-chain | 1,120 | 1,050 | 1,050 | 1,050 | 350 → 330 | 290 |
| calls | 840 | 651 | 651 | 580 | 288 → 234 | 227 |
| checksum | 1,170 | 1,710 | 1,410 | 1,260 | 1,251 | 1,110 |
| chess-search | 334,902 | 432,856 | 423,077 | 406,477 | 327,316 → 278,850 | 297,382 → 242,367 |
| collatz | 7,016 | 7,461 | 7,461 | 5,779 | 6,955 → 4,861 | 5,769 → 3,675 |
| constants | 160 | 100 | 70 | 70 | 70 | 70 |
| dead-code | 200 | 110 | 30 | 30 | 30 | 30 |
| diagnostics | 90 | 30 | 30 | 30 | 30 | 30 |
| distinct | 700 | 340 | 340 | 340 | 80 → 50 | 60 → 50 |
| div-checks | 308 | 172 | 162 | 152 | 162 → 160 | 152 |
| div-magic | 807 | 729 | 769 | 710 | 759 → 739 | 661 |
| early-exit | 575 | 761 | 631 | 559 | 564 | 557 |
| f32-dsp | 40,740 | 49,706 | 49,030 | 47,923 | 46,361 → 45,209 | 44,107 → 43,915 |
| first-steps | 500 | 280 | 220 | 220 | 80 | 80 |
| fixed-point | 647 | 429 | 411 | 392 | 251 | 242 |
| fragments | 2,021 | 2,697 | 2,299 | 2,090 | 2,289 → 2,090 | 1,891 |
| gcd | 365 | 324 | 324 | 314 | 314 | 265 |
| heat-lab | 6,758 | 8,832 | 8,832 | 8,026 | 8,664 → 7,584 | 7,996 → 7,523 |
| histogram | 2,036 | 2,416 | 2,292 | 2,008 | 2,222 → 2,036 | 2,000 → 1,910 |
| licm-nested | 2,426 | 2,677 | 1,678 | 1,678 | 1,631 | 1,596 |
| licm-traps | 196 | 153 | 153 | 153 | 149 | 142 |
| lz-roundtrip | 28,499 | 33,646 | 34,551 | 33,660 | 28,745 → 26,839 | 28,330 → 25,469 |
| match-enum | 396 | 282 | 251 | 226 | 251 → 231 | 226 |
| my-analysis | 200,696 | 200,975 | 200,975 | 200,795 | 200,966 | 200,618 |
| my-first-pass | 120 | 60 | 50 | 50 | 50 | 50 |
| nested-loops | 2,312 | 2,634 | 2,342 | 2,342 | 2,289 | 2,252 |
| orders | 1,351 | 1,350 | 1,194 | 1,010 | 1,185 → 1,127 | 952 |
| params-demo | 2,021 | 2,697 | 2,299 | 2,090 | 2,289 → 2,090 | 1,891 |
| pressure | 490 | 280 | 240 | 230 | 240 | 230 |
| ramp | 1,120 | 1,180 | 1,040 | 790 | 962 | 780 |
| records | 391 | 260 | 260 | 240 | 260 → 240 | 240 |
| regalloc-lab | 2,028 | 2,614 | 2,614 | 2,462 | 2,051 → 1,970 | 1,716 |
| regex-nfa | 34,041 | 41,650 | 40,212 | 38,745 | 35,638 → 31,587 | 28,128 → 25,650 |
| sha-chacha | 136,109 | 239,636 | 232,820 | 211,526 | 125,491 → 111,277 | 107,102 → 105,620 |
| sort | 3,898 | 5,043 | 5,043 | 4,589 | 4,950 → 4,329 | 4,563 → 4,294 |
| start-here | 3,167 | 4,385 | 3,871 | 3,467 | 2,932 → 2,550 | 2,559 → 2,327 |
| strength | 1,889 | 2,220 | 1,938 | 1,414 | 1,793 | 1,404 |
| strings | 9,392 | 11,895 | 10,833 | 9,282 | 10,283 → 8,100 | 9,262 → 6,558 |
| ui-gallery | 825 | 1,214 | 1,058 | 1,016 | 754 → 606 | 594 → 572 |
| value-numbering | 3,771 | 3,721 | 3,082 | 2,666 | 3,073 | 2,453 |
| wrong-shift | 1,410 | 1,950 | 1,650 | 1,490 | 1,491 | 1,340 |
| **total** | 875,417 | 1,123,009 | 1,090,271 | 1,032,485 | 867,770 → 789,710 | 792,800 → 724,721 |

- 30 of 50 projects change under `speed`; no cell is higher than before; no pass was rejected.
- Totals under `speed`: -9.0% (default options), -8.6% (tuned). O2: identical in all 100 cells.
- `speed` with the default options is at or below the reference in 36 of 50 projects (31 before), with the
  tuned options in 45 (45 before). In total: 789,710 and 724,721 against the reference's 875,417.
- Still above the reference under `speed` tuned: f32-dsp (43,915 against 40,740), heat-lab (7,523 against
  6,758), sort (4,294 against 3,898), bounds-lab (4,426 against 4,234), bounds-offset (1,258 against 894).
- Above r0 under `speed`: div-magic with the default options (739 against 729; 759 before).
- Cost: the list has 26 steps instead of 21, and more of them change the program. The checked pipeline took
  1.2 to 2 times as long on three projects (`various/22-pipeline-time.txt`: regex-nfa 1.8 s to 3.8 s, lz-roundtrip
  1.0 s to 1.7 s, sha-chacha 3.8 s to 4.6 s, second runs, on a loaded machine).

## Where the passes live, and why O2 did not change

- I first built `thread`, the decided checks and the copies as phases of cfg, bce and constprop, so that O2
  would get them. Nine typed tests failed. They pin the book's numbers for O2: Blend 88 bytes and 451
  instructions, Checksum 52 and 366, the `why` tree of `s:blend.15`, the copy `t7 = i` that O2+ removes.
- The phases improve those very programs (Collatz under O2: 7,461 to 5,367; Blend 1,925 to 1,760 over the
  seeded cases), so keeping the book's O2 and adding them to O2 exclude each other.
- The repository already answers this for O2+ ("O2 itself stays as Compiler Workbench defines it, for parity
  with the book"). I followed it: five passes of their own, named only by `speed`.
- `speed` without the new names, and with `subst-mem` read as `subst`, is still inline, inline, O2+, rotate,
  cfg. Two tests assert that.
- What O2 would gain is measured:

50 projects

| Variant of O2 | Default options | Difference | Tuned | Difference |
| --- | ---: | ---: | ---: | ---: |
| O2 | 1,090,271 |  | 1,032,485 |  |
| O2 + the new passes | 1,042,444 | -47,827 | 1,001,200 | -31,285 |

O2 + the new passes: higher than O2: sha-chacha tuned 211,526 -> 211,556

This variant is `speed`'s list without the inlining, the last subst-mem and rotate, cfg. One cell is higher
than O2 (sha-chacha, tuned, by 30).

## Framework changes

| File | Change | Reason |
| --- | --- | --- |
| `src/framework/dataflow/scoped.ts` (new) | `ScopedMap` (writes undone on `close`), `walkDominatorTree(root, children, enter, scopes)` | `guards` and `copies` both need "what holds in the blocks this block dominates". It is the scoped-table walk of SSA renaming and of dominator-based value numbering. Second use today: `copies`. A third exists: `ssaOf` has its own copy of the walk, which I left. |

Nothing else under `src/framework/` changed. `typed.ssa` was already a framework analysis; `typedPass` now
accepts it as a need (`ssa`), which made it a declared need of `guards` and `copies` instead of a private
computation as in `sccp`.

Machinery inside the domain that overlaps a framework concept:

- **The interval facts of `guards`** overlap `typed.ranges`, a framework dataflow analysis (intervals per
  local, edge refinement, widening). I built them in the pass because the facts are per SSA name and scoped by
  dominance, which the dataflow solver (per block, per local) does not express. The framework piece that is
  missing is a sparse analysis over SSA names with scoped refinement; `guards` is its first instance and a
  range-driven `strength` would be the second.
- **`evalRange`** got a fourth parameter, a reader for `get` values, so `guards` uses the same interval
  arithmetic as `typed.ranges` instead of a second copy.

Changes outside the framework:

| File | Change |
| --- | --- |
| `src/typed/missed.ts`, `tools/missed.mjs` (new) | `hotShapes`, `formatHotShapes`, the command line |
| `src/typed/guards.ts` (new) | `threadTests`, `copyReads`, `guardPlan`, `decideCompare`, `narrowBy` |
| `src/typed/passes.ts` | passes `thread`, `guards`, `copies`, `subst-mem`, `identities`; `subst`'s `loads` parameter; `speed`'s list; `ssa` as a need |
| `src/typed/rules/identities.ts`, `evidence-identities.ts` (new), `rules/listing.ts` | the table, its evidence, and the listing of all three tables |
| `src/typed/analyses.ts` | `evalRange(st, id, env, read?)` |
| `tests/typed/guards.test.mjs`, `missed.test.mjs`, `tests/framework/scoped.test.mjs` (new) | 14, 3 and 3 tests |
| `tests/typed/inline.test.mjs`, `tests/workbench/strategies.test.mjs` | the pinned `speed` list and the pinned pass count (15 to 20) |

## Found on the way, not changed

- **bce is unsound without its gate.** It accepts a dominating `i < buf.length` when the index has the same
  *set* of reaching definitions at the branch and at the check. In `scripts/13-probe-bce-same-defs.mjs` the
  only assignment to `i` lies between the two and reaches both. bce removes the check, and the meaning check
  rejects the pass (16 of 40 cases disagree). Comparing SSA names instead of sets would fix it.
- **`typed.ranges` loses a counter's lower bound** under an inner loop (above). It is an O2 analysis, so I did
  not change it; `guards` has its own rule.
- **lvn throws `absent`** on regex-nfa when run a second time before rotate (the ablation skips a pass that
  throws and says so). Where it runs, a second lvn saves 1,324 instructions on the 49 projects (default options).

## Measured and argued

Measured:

- every instruction count in this report (emulator runs; the scripts named with each table);
- that the tables of `hotShapes` sum to the emulator's count (test);
- each pass alone and all together, on the whole corpus (`09-ablation`);
- each rule's verification, and its firings and gain (`11`, `16`, `17`);
- `decideCompare` and `narrowBy` against every value of small intervals (test);
- that `typed.ranges` loses the bound (probe 14) and that bce removes a needed check (probe 13);
- parity, the reference checks, the test suites (below).

Argued, and checked only by the meaning checks of the runs above:

- that a fact about an SSA name holds in every block the walk has it in scope (the dominance argument in
  `guards.ts`);
- the induction for counters;
- that `thread` never lengthens a path (a jump and a branch become a branch): no project is higher, which is
  consistent with it and does not prove it;
- that moving a load is safe when no store, zeroing or call lies between.

## Verification

After `npm run build`, on the final compiler sources (the passes and rules of commit 22bf2f7; later commits
change comments, the recorded evidence, tests and this ticket):

| Check | Result |
| --- | --- |
| `scripts/21-speed-full-check.mjs`: `speed` on all 50 projects, every pass checked on 40 cases per function, then the default and the tuned image against the evaluator at r0 on 100 cases per function | 368 revisions, none rejected; 16,572 of 16,572 decided cases agree, 28 at the limit (`various/21-speed-full-check.log`) |
| `node tools/parity.mjs` (every project's own pipeline) | 50 projects, 135 functions, 8,286 of 8,286 decided cases agree, 14 at the limit, 0 failures (`various/18-parity.log`) |
| `node tools/reference-check.mjs` | reference images: 8,286 of 8,286 agree |
| `node tools/reference-check.mjs --o2` | our O2 images: 8,286 of 8,286 agree |
| `IRWB_FULL=1 node --test tests/typed/speed.test.mjs` | 9 pass (it runs O2+, rotate, cfg, not `speed`; script 21 is the check of `speed`) |
| `node --test tests/typed/*.test.mjs` | 174 tests, 172 pass, 2 skipped, 0 fail |
| `node --test tests/framework/*.test.mjs` | 237 pass |
| `node --test tests/workbench/*.test.mjs` | 25 tests, 24 pass, 1 skipped, 0 fail |
| `node tools/build-site.mjs` | builds |
| `docmgr doctor --ticket IRWB-037-G` | all checks passed |

- wrong-shift's `div-to-shift` is rejected in the parity run, as its `broken` pipeline intends.
- Three pinned expectations changed: `speed`'s list in `tests/typed/inline.test.mjs`, the pass count in
  `tests/workbench/strategies.test.mjs` (15 to 20), and nothing in the corpus.
- The measurement runs check each pass with 5 cases per function (the benchmark run with 20); script 21 and
  parity use the full 40 and 100.
- The typed suite was last run after the recorded evidence was regenerated; parity, the reference checks and
  script 21 ran before that, on the same passes.
- Not run: `npm test` (the brief excludes it), Candela (`IRWB_CANDELA=1`).

## Left out

- A value-level `why` for a hot instruction: statement and node were enough to name shapes.
- Attribution of the remaining instructions to rule ids: firings are counted per rule instead.
- The new passes in O2 (see above), and documentation of them in the book, which describes O2.

## Later

- `if geu(x, load)`, 22,990 instructions after this work: buffer checks against a loaded length.
- `caddr` checks merged across blocks (LZ).
- Congruences: `5 * queue[head] + 3 <u 45` needs "a multiple of 5 below 45 is at most 40".
- A template number over a literal and a constant variable in `rules/form.ts`, so the three identities become
  their families.
- bce by SSA names; `typed.ranges` with thresholds or narrowing; lvn's `absent`.
- A sparse SSA analysis in `src/framework/dataflow`, with `guards` as its first user.
- `copies` and register pressure: it costs in `chacha20Block` when measured alone with coalescing on.
