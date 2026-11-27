# Report: what provenance found, what was added, and what it bought

Ticket IRWB-037-D (D2). Design: `design/01-design-missed-optimizations-from-provenance.md`.
Every number below was measured on this worktree's build unless it is marked *argued*.

## 1. Method, and what each step produced

| step | script | what it answers |
| --- | --- | --- |
| baseline, re-measured | `scripts/01-baseline-remeasure.mjs` | the three benchmarks the brief names, after D1's fix |
| corpus against the reference | `scripts/05-corpus-vs-reference.mjs` | every project at r0, `O2`, `speed`, and the reference image |
| per-pass credit | `tools/attribute.mjs` (`attributeSteps`, reused unchanged) | which pass already made each step's difference |
| hot sites with provenance | `scripts/02-hot-sites.mjs` | executed instructions per statement at the last revision, marked *edited by a pass's edit record* or not |
| the gap by opcode | `scripts/03-op-histogram.mjs` | the same call on our image and the reference's, counted per RV32 opcode |
| shapes no rule matches | `scripts/06-hot-shapes.mjs` | the hot statements no pass edited, grouped by value-tree shape, corpus-wide |

`attributeSteps` was used as it is; no extension was needed. Two things it does not answer were answered by
the two new scripts: which instructions *no* pass improved, and what the difference against the reference is
made of.

## 2. Baselines (before this stage's changes)

`scripts/01`, `various/01-baseline-remeasure.txt`, reproduced with `corpus/projects/chess-search/scripts/fixtures.mjs measure`:

| benchmark | r0 | `speed` | reference | gap |
| --- | ---: | ---: | ---: | ---: |
| regex-nfa, `regexMatch(/[a-c]*[b-d]*a*d/, "abccabbd")` | 8,183 | 6,933 | 6,628 | +305 (+4.6 %) |
| lz-roundtrip, `roundTrip`, 100 seed-7 cases | 185,876 | 156,782 | 156,405 | +377 (+0.24 %) |
| chess-search, `quiet-mate-in-two` depth 3 | 14,804,396 | 10,038,193 | 10,827,760 | −789,567 (−7.3 %) |

D1's fix had already moved these from 8,040 / 157,682 / 10,079,349 to the numbers above.

Corpus (`scripts/05`, `various/05-corpus-before.json`): r0 1,123,009; `O2` 1,090,271; `speed` 867,770;
reference 875,417. Under `speed` we are already 0.9 % ahead in total, but 22 projects lose, worst
bounds-offset 1.52×, heat-lab 1.28×, sort 1.27×, bounds-lab 1.18×, bounds-param 1.17×.

## 3. The shapes, with their instruction counts

### S1 — a bounds check on an affine index, guarded by a test that compared the same value

The `O2` IR listing of `bounds-offset` at `speed` (`bounds-offset`'s own `project.json` asks for this; the
listing is `src/typed/listing.ts`'s):

```
bb:rises.1  if ((i + 1) >= load32[work+0]) goto .2 else .3     the loop test
bb:rises.3  t3 = (i + 1)
            if (t3 >=u load32[work+0]) goto .4 else .7          the check: the tested value, another id
bb:rises.7  t4 = i
            if (t4 >=u load32[work+0]) goto .8 else .11         the check on i: one below the tested value
```

`bce` matched a check against a branch only when both indices were the *same local*, resolved through a copy.
Here the tested index is a value (`i + 1`), so neither check went. Cost: two checks per iteration of a 20-cell
loop.

### S2 — the block layout: 326 of the 305-instruction regex gap is `j`

`scripts/03-op-histogram.mjs` on the regex call: executed instructions per opcode, ours minus the reference's:

| op | ours | reference | gap |
| --- | ---: | ---: | ---: |
| `j` | 326 | 0 | **+326** |
| `addi` | 1,989 | 1,741 | +248 |
| `bge`/`blt` | 253 / 84 | 39 / 298 | ±214 (the same branches, inverted) |
| `bgeu`/`bltu` | 58 / 803 | 0 / 861 | ∓58 |
| `xori`/`xor` | 82 / 0 | 26 / 56 | ±56 |
| `lw` | 612 | 704 | −92 |
| `jal` (calls) | 0 | 117 | −117 (we inlined `inRange`) |
| `ret` | 1 | 33 | −32 (same inlining) |
| `sw`, `bne` | 360, 299 | 379, 316 | −19, −17 |

Where the `j`s are (`scripts/02`): 183 are the bottom tests of rotated loops (`rotate` duplicates the header
into the latch, which pays a branch *and* a jump unless the latch's exit follows it in the emitted order), 56
are a check whose trap block sits far from it in `f.blocks`, and the rest are if/else diamonds.

**Measured, not adopted.** `scripts/04-reorder-probe.mjs` rebuilds every function's blocks in the order the
backend's own frequency estimate uses (`frequency.ts` + `layout.ts`, the `chains` option's order) and lowers
with default options: bytecode-vm −12 %, regex's benchmark call −3 %, but lz-roundtrip +13 % at r0, histogram
+1.5 %, ramp +1 %. The reason is that the IR's block order feeds the register allocator's interference order,
which the backend's estimate does not model. The `chains` option avoids that by choosing the layout *after*
allocation, and with `chains`, `coalesce` and `homes` the regex call is 5,405 instructions. Changing the
default layout is out of scope: it changes every image revision, and `O2` is the book's pipeline.

### S3 — the hot shapes no rule can reach

`scripts/06-hot-shapes.mjs` (`--limit 30`), 40.9 % of the executed instructions under `speed` are charged to
statements no pass's edit record names. The hottest shapes:

| instructions | shape | why no rule fits |
| ---: | --- | --- |
| 37,493 | `set x` (a local read) | not a rewrite |
| 25,323 | `set load16u(add(x, shl(x, 1)))` | a load: rules rewrite value trees, and dropping or reordering a load needs purity |
| 21,882 | `set add(x, 1)` | a loop increment; `x` is unknown, nothing to fold |
| 17,744 | `br` (unconditional) | control flow — this is S2 |
| 12,867 | `set lt(rem(x, 16), 8)` | would need `assume x ≥ 0` (then `rem(x,16)` is `and(x,15)`, and the test is `and(x,8) == 0`); the rule language has no range guard, and `strength`/`bce` already own facts |
| 8,777 | `set add(x, x)` | `x + x → shl(x, 1)` is one instruction either way on this target |
| 7,648 | `store load16u(add(x, shl(x, 1)))` | a load and a store |

**No rule was added.** The verified rule tables rewrite a value tree to another value tree with a guard that is
structural (pure, pow2, boolean, no-trap); every hot unedited shape is either a memory operation, a call, a
control-flow statement, or arithmetic with nothing to fold, and the one genuinely promising candidate
(`rem(x, 16)` under a non-negativity fact) is not a rule but a fact-driven pass. That is a negative result and
it is the reason the work went into a pass.

## 4. What was added

### 4.1 `bce` compares linear forms, not local numbers (`src/typed/passes.ts`, `src/typed/linear.ts`)

The check `x >=u buf.length` is dropped when a dominating branch proved `x + k <u buf.length`, where

- the branch's index and the check's index are **linear forms over the same named values**, named by the
  statements that reach each read (`reaching` facts), and the difference of the two forms is a constant `k`;
- `k ≥ 0`, and either `k = 0` (then the two indices are the same value: no further side condition) or
  `ranges` puts the checked index in `[0, MAX]`, so `x + k ≤ 2^32 − 2` cannot wrap and `x ≤u x + k <u len`;
- the buffer length reads the same value at both sites, and the check's then-arm is a trap, as before.

The linear forms are `const`, `get`, `add`, `sub`, `mul` by a constant and `shl` by a constant, exact modulo
2^32; a read is resolved to the value of its single reaching definition, so `t3 = i + 1` and `t4 = i` expand to
forms over `i`'s reaching definitions.

Verification: it is a `typedPass` like every other pass, so the meaning contract compares its output with r0 on
generated cases at every pipeline step (`parity` shows no rejection and no disagreement on all 44 projects),
and `tests/typed/bce-offset.test.mjs` pins the behaviour (which check goes, which stays, the 140-instruction
difference, and the form arithmetic). All 158 typed, 258 framework and workbench tests pass.

Gains (`scripts/05`, before → after, 10 seed-7 cases per function):

| project | `O2` | `speed` |
| --- | --- | --- |
| bounds-offset | 1,364 → 1,224 (−140, −10.3 %) | 1,355 → 1,215 (−140, −10.3 %) |
| bounds-lab | 5,333 → 5,109 (−224, −4.2 %) | 5,012 → 4,788 (−224, −4.5 %) |
| **corpus total** | 1,090,271 → 1,089,907 (−364) | 867,770 → 867,406 (−364) |

Measured after the change, and unchanged because neither project has the shape: regex-nfa's benchmark call
6,933, lz-roundtrip's `roundTrip` 156,782, chess-search `quiet-mate-in-two` 10,038,193. So the three
benchmarks the brief names still stand where D1 left them; the gain is in the two bounds projects.

The check on `i` in bounds-offset stays: `i + 1 < len` does imply `i < len`, but only if `i` is not huge, and
`ranges` cannot say so — see 4.2.

### 4.2 `ranges` keeps bottom at bottom (`src/typed/analyses.ts`)

Found while trying to prove `i ≥ 0` for 4.1. The block transfer mapped an empty (bottom) environment to "the
assigned local is anything", because `evalRange` reads a local the environment does not hold as the full range.
With the round-robin sweep, a latch visited before its head had facts therefore wrote `i: full` into the head,
and no join or widening can descend from `full`. In a function shaped like `bounds-offset`'s (`for (i = 0; i + 1 <
len; i = i + 1)`) that left every local of the whole loop without a bound. The transfer now returns bottom for
bottom.

Measured effect on the corpus: none by itself (the fix is what lets `ranges` see `i ∈ [0, MAX]` instead of
nothing; no project's instruction count moved, because the sharper bound does not survive the next step — see
below). It is kept because it is a monotonicity fix with a stated second use (`strength` and the backend's
`useRanges` read the same facts), and because the old behaviour was order-dependent.

What is still missing for the second check: with `i ∈ [0, MAX]`, `i + 1` leaves the signed interval domain
(`fits` returns `[MIN, MAX]`), the join at the head gives `full`, and the bound is lost again. Proving
`i <u len` from `i + 1 <u len` needs an *unsigned* bound (`i ≤u 2^31 − 1`), which the signed interval domain
cannot express. That is the analysis change this ticket leaves for later, and it is why the second check stays.

## 5. Framework changes

None. The two changes are in `src/typed/` (a pass body and an analysis transfer) and in a new domain module
(`src/typed/linear.ts`). `src/framework/` was not modified, and `node tools/build-site.mjs` still builds.

Domain-side machinery that duplicates an existing concept: `bcm` (`src/typed/passes.ts`) already builds linear
forms over values, with names for definitions inside one block. `linear.ts` is the factorisation of that shape
for `bce`, parameterised by a reader; `bcm` was left alone because its naming is different (in-block
definitions, not reaching definitions) and rewriting it would have meant re-verifying a pass this ticket does
not otherwise touch. Unifying them is one follow-up line in "later", below.

## 6. Measured vs argued

Measured: every instruction count and byte count in §2, §3 and §4; the pass and analysis effects; the tests;
the allocation and layout effects of the reorder probe; the rule-table shapes.

Argued, not measured: that `chains`+`coalesce`+`homes` close the regex gap (only one call was measured:
6,933 → 5,405); that the `rem(x, 16)` shape would pay if a range guard existed (the 12,867 instructions are its
upper bound, in `chess-search` only); that the 183 rotated-latch jumps would go with a layout pass (the probe
measures the whole-order change, not that one component).

## 7. Later

- An unsigned (or sign-aware) bound in `ranges`, so `i + 1 < len` proves `i < len` and the second check in
  `bounds-offset` goes (one line, one pass, one analysis).
- A fact-driven pass for `rem(x, 2^k)` under non-negativity in *tests* (chess-search's `rem(x, 16)`), rather
  than a rule.
- A layout pass or backend option that chooses the block order *after* allocation (the only way to keep the
  `j`s down without disturbing spills).
- `bcm` rewritten on `linear.ts`.
