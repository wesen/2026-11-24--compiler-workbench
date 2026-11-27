# Missed optimizations from provenance: method, shapes and the rules and passes they justify

Ticket IRWB-037-D (D2). Status: design, written before any change to `src/`.

## 1. What this stage is for

The earlier stages closed the `speed` gap by adding passes (inlining, copy coalescing, loop rotation,
per-header `licm`). The corpus now beats the reference compiler in total (867,770 instructions against
875,417 under `speed`, measured in `scripts/05-corpus-vs-reference.mjs`), but individual projects still lose,
and 18 of `simplify`'s 27 rules never fire on the corpus. Two facts are therefore unconnected:

- we know, per pass, what each decision cost or saved on one concrete call (`attributeSteps`, IRWB-034-G);
- we do not know which executed instructions no pass or rule ever made better, or which code *shape* they
  come from.

This stage connects them: from executed instructions to the statements that carry them, from those statements
to the shapes no rule matches or no pass improves, from shapes to candidate rules and passes, and from
candidates to measured, verified changes.

### The input domain of everything below

- The 44 corpus projects under `corpus/projects/`, unmodified; the pipelines `O0`, `O1`, `O2`, `O2+`, `loops`,
  `speed`; the seeded case generator (`casesFrom`, 10 cases per function, seed 7) and the RV32 emulator.
- One concrete call per benchmark when attribution is used (`tools/attribute.mjs`), because attribution joins
  the sites of two revisions for one call that finishes on every revision.
- The reference compiler as vendored (`vendor/ds-js-os/compiler/typed/typed-rv32.js`, default policy), used
  only for instruction counts and never as an oracle of semantics.
- `O2` is the book's pipeline and stays as the book defines it. Any new pass therefore joins `O2+`, `loops`
  and `speed`, which IRWB-003 owns, unless it can be shown to leave the five book rows of
  `tests/typed/backend.test.mjs` (blend, checksum, sort, collatz, value-numbering) untouched.

## 2. Method

Four measurements, in this order. Scripts are numbered in the ticket's `scripts/`.

1. **Baseline, re-measured.** `01-baseline-remeasure.mjs` reproduces the three benchmarks the brief names
   (regex one call, LZ `roundTrip` over 100 seed-7 cases, chess `quiet-mate-in-two` depth 3) and
   `05-corpus-vs-reference.mjs` gives every project at r0, after `O2`, after `speed`, and with the reference
   compiler's image. The last column is the gap that hunting starts from.
2. **Attribution, reused.** `node tools/attribute.mjs <project> <pipeline> <fn>` credits each step's
   instruction difference to the pass that made it; it answers "which pass already tried" but not "what is
   left". No change to `attributeSteps` is needed for the rows it produces.
3. **Hot sites with provenance** (`02-hot-sites.mjs`, and the extension described in §3). At the last
   revision, every instruction is charged to the statement it covers (`attribute.ts`'s site rule), and each
   statement is marked with what the chain did to it: *edited* (some pass's edit record names it), *new*
   (a pass created it) or *untouched* (it is the same statement id as at r0 and no edit names it). The
   untouched and new-but-unrewritten hot statements are the "no rule or pass improving them" set.
4. **Gap to the reference by opcode** (`03-op-histogram.mjs`). The same call is run on our image and the
   reference's, and executed instructions are counted per RV32 opcode. The per-op difference says what kind of
   instruction the gap is made of (a jump, a load, an `addi`), which names the shape to look for. This is a
   coarse but cheap filter: an opcode difference is not yet an explanation.

Candidate shapes are then turned into candidates:

- a **rule** joins `simplify` or `fold` only if `src/typed/rules/verify.ts` proves it (`verdict: sound`, its
  strength recorded in `evidence.ts` through the ticket's verify script) and the rule tables' regression test
  (`tests/typed/rules.test.mjs`, B1: identical revisions to the hand-written passes) still passes;
- a **pass** is written as a `typedPass` with declared `needs`, `writes` and `preserves`, so the meaning
  contract compares its output with r0 on generated cases, unchanged from how every other pass is checked.

Each candidate is then measured the same way as the baseline, and kept only if it pays. A candidate that loses
is reported with its measurement, not deleted from the record.

## 3. The measurements already taken (before any change)

`scripts/01-baseline-remeasure.mjs`, `various/01-baseline-remeasure.txt`:

| benchmark | r0 | `speed` | reference |
| --- | ---: | ---: | ---: |
| regex-nfa, `/[a-c]*[b-d]*a*d/` on `"abccabbd"` | 8,183 | 6,933 | 6,628 |
| lz-roundtrip, `roundTrip`, 100 seed-7 cases | 185,876 | 156,782 | 156,405 |
| chess-search, `quiet-mate-in-two` at depth 3 | 14,804,396 | 10,038,193 | 10,827,760 |

So the D1 fix (`licm` per header, shared invariants) already moved regex from 8,040 to 6,933 and LZ from
157,682 to 156,782; the remaining gaps are +305 (regex, +4.6 %) and +377 (LZ, +0.24 %).

`scripts/05-corpus-vs-reference.mjs`, `various/05-corpus-before.json`: totals r0 1,123,009, `O2` 1,090,271,
`speed` 867,770, reference 875,417. The projects that lose under `speed`, by ratio: bounds-offset 1.52,
heat-lab 1.28, sort 1.27, bounds-lab 1.18, bounds-param 1.17, f32-dsp 1.14, fragments and params-demo 1.13,
bounds-two and blend and bytecode-vm 1.12, strings 1.10, histogram 1.09, checksum 1.07, wrong-shift 1.06,
regex-nfa 1.05.

`scripts/03-op-histogram.mjs` on the regex benchmark call splits the 305 into: `j` +326 (we execute 326
unconditional jumps, the reference none), `addi` +248, `bge`/`blt` ±214 (the same branches, inverted),
`xori`/`xor` ±56, `lw` −92, `bltu` −58, `jal` −117 and `ret` −32 (the call we inlined), `sw` −19, `bne` −17.

## 4. Shapes found, and what each justifies

**S1. A bounds check on an index that is affine in a loop variable, where a dominating test already
established the bound.** `bounds-offset` (`corpus/projects/bounds-offset/main.typed`, whose `project.json`
names the miss) after `O2`:

```
bb:rises.1   s:rises.3   if ((i + 1) >= load32[work+0]) goto .2 else .3     the loop test
bb:rises.3   s:rises.4   t3 = (i + 1)
             s:rises.5   if (t3 >=u load32[work+0]) goto .4 else .7        the check: same value, other id
bb:rises.7   s:rises.9   t4 = i
             s:rises.11  if (t4 >=u load32[work+0]) goto .8 else .11       the check on i: i + 1 < len ⟹ i < len
```

`bce` today only matches a check whose index is a plain local read whose reaching definition is a copy, so
both checks stay although the dominating test proves `i + 1 < len`. Candidate: **extend `bce` to indices that
are linear forms over locals**, with the difference between the tested index and the checked index a
non-negative constant and the checked index provably non-negative. The argument is exact:
`x' <u len`, `x' = x + c` (c ≥ 0, no wrap because `x ∈ [0, 2^31)` from `ranges`) gives `x ≤u x' <u len`.

**S2. A rotated loop's bottom test, and a check whose trap block is not adjacent.** In the regex hot loop
(`bb:regexMatch.62` after `rotate`), `if (state >= stateCount) goto .n5 else .51` costs a branch *and* a jump
per iteration, because under the default backend layout (`layout: 'source'`) the loop body is not the next
block. The same is true for the checks whose trap block sits far from the check. Together these are 183 of the
326 `j`s. The backend's frequency layout (`chains`) fixes this — with `chains`, `coalesce` and `homes` the
same call costs 5,405 — but that is a backend option, not a pass, and making it the default changes every
image revision.

Candidate: **a block-placement pass** that puts a function's blocks in the estimated-frequency order in the
IR, so the default layout benefits. Probed before implementing (`scripts/04-reorder-probe.mjs`): it helps
where the trace is deep (bytecode-vm −12 %, regex's benchmark call −3 %) and hurts where it changes the
register allocator's interference order (lz-roundtrip +13 % at r0, histogram +1.5 %). *Decision: not
implemented as a default pass.* The measurement is in §6 of the report; the reason is that IR-level order
feeds the allocator, so the estimate the backend uses to gate `chains` does not describe the result.

**S3. `x * 5` and similar constant products.** `row = (5 * load32[...])` and `split = (5 * s)` are hot in
regex (310 and 128 instructions). RV32 has `mul` (one instruction, M extension), so replacing it costs two;
no rule is proposed. Worth stating because it looks like a missed strength reduction and is not one.

**S4. Two address computations for one index in a copy loop.** `t46 = (inv10 + (state << 2))` then
`store32[t46+0] = load32[(inv11 + (state << 2))+0]` (256 + 192 instructions in regex): different bases, so no
CSE applies, and the reference pays the same two addresses.

**S5. Hot statements no rule matches** — to be listed, with instruction counts, by the discovery step (§5,
`scripts/06-hot-shapes.mjs`). The list is what decides whether a *rule* (as opposed to a pass) is worth
proposing, and the rules that never fire are checked against it (a rule that never fires because its shape
does not occur differs from one that never fires because a pass rewrote the shape away first).

## 5. The discovery step (new machinery)

`scripts/06-hot-shapes.mjs` is the loop the brief asks for, in one script: for every corpus project at
`speed`, it takes the hot sites of §2.3, keeps those no edit names, and prints each one's value-tree shape
(operator and children operators, with constant operands) with its executed instruction count, largest first,
corpus-wide. Its output is the candidate list for S5; every rule it suggests is then a data change to
`SIMPLIFY_RULES` or `FOLD_RULES`, verified like the existing ones.

## 6. What is not built here

- No new analysis lattice: `ranges` already answers "what is this value's interval at this statement"
  (`rangeView.of`), which is all S1 needs.
- No regalloc- or layout-aware pass (S2, rejected above by measurement).
- No changes to `src/tensor/`, to the corpus programs, or to `O2`.
- Later: an analysis that proves `stateCount ≤ 9` for the regex NFA arrays (constant-bound bounds checks on
  loop indices), which needs relations between locals, not intervals; and a layout pass whose choice is made
  by the allocator's own cost, not by the IR's.

## 7. Deliverables

1. `bce` extended to linear index forms (S1), checked like every pass, measured per corpus project.
2. Any rules the discovery step justifies, verified with `verify.ts`, with the rule tables' regression test
   still passing.
3. `various/06-corpus-after.json` and a per-project table before/after, in the report (`reference/02-report*`).
4. The framework changes, if any, each with its reason.
