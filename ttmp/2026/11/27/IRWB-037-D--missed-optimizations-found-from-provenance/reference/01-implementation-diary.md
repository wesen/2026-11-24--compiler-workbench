# Diary: IRWB-037-D, missed optimizations from provenance

One session, three hours. Design first (commit `60307df`), then the code, the measurements and this diary.

## Step 1 — the required reading, and the baselines

Read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `src/framework/passes/define-pass.ts`,
`src/typed/strategies.ts`, `src/typed/passes.ts`, IRWB-006 (rules as verified data), IRWB-014/015/017 (the LZ,
regex and chess projects and their numbers) and IRWB-034-G (attribution).

Wrote `scripts/01-baseline-remeasure.mjs` to reproduce the three benchmarks the same way their tickets did:
regex is one `regexMatch` call on the project's benchmark pattern and text with default backend options; LZ is
the 100 seed-7 cases of `roundTrip`, which is the row IRWB-014's diary reports, with `chains`, `coalesce` and
`homes`; chess is `corpus/projects/chess-search/scripts/fixtures.mjs measure`, reused rather than rewritten.
Result: regex 8,183 / 6,933 / 6,628, LZ 185,876 / 156,782 / 156,405, chess 14,804,396 / 10,038,193 /
10,827,760 (r0 / speed / reference). The first two attempts at the LZ figure were wrong (all four functions
summed, 378,170) until I compared against the diary's 185,876 and found that the published row is `roundTrip`
alone.

**Mistake worth recording:** the first thirty minutes of edits were made with `cd /home/manuel/code/wesen/2026-11-24--compiler-workbench`
(the main checkout) instead of this worktree. The main checkout was clean for `src/`, so the baselines I took
there are valid, but the edits belonged to another agent's tree. I copied the three files into the worktree,
`git checkout --`'d the two modified ones and removed the new one in the main checkout (leaving its other
agents' untracked files alone), rebuilt here, and re-ran every measurement in this worktree. From then on
every command ran with the worktree path.

## Step 2 — from hot code to shapes

`scripts/05-corpus-vs-reference.mjs` gave the per-project picture (r0 1,123,009, `O2` 1,090,271, `speed`
867,770, reference 875,417). `tools/attribute.mjs` reproduces D1's per-pass tables unchanged, but it answers
"which pass did what", not "what is left", so I added two views:

- `scripts/02-hot-sites.mjs`: executed instructions per statement at the last revision, each marked `EDIT` if
  any pass's edit record names it, `NEW` if the statement did not exist at r0, blank otherwise. That is the
  "no rule or pass improving it" set.
- `scripts/03-op-histogram.mjs`: the same call on our image and the reference's, counted per RV32 opcode.

The regex call's gap is +305, and +326 of it is `j` (we execute 326 unconditional jumps, the reference none).
`scripts/02` localises them to 183 rotated-latch bottom tests, 56 checks whose trap block is far from them in
`f.blocks`, and the rest if/else diamonds. That is S2 in the design.

`bounds-offset`'s `project.json` names its own miss (`i + c` indices), and the `O2` listing shows it: the test
compares `i + 1`, the checks compare `t3 = i + 1` and `t4 = i`, and `bce` matched only plain locals. That is
S1.

## Step 3 — the layout experiment, measured and dropped

Before writing a pass, `scripts/04-reorder-probe.mjs` rebuilt every function's blocks in the frequency order
`layout.ts` computes and lowered with default options. It wins where loops dominate (bytecode-vm −12 %, the
regex call −3 %) and loses where the allocator's interference order changes (lz-roundtrip +13 % at r0,
histogram +1.5 %, ramp +1 %). Implemented as a default pass it would be a mixed bag, and as an estimate-gated
one it would need the backend inside a pass. Not built, and recorded in the report with its numbers.

## Step 4 — `bce` on affine indices, and the analysis bug it uncovered

Wrote `src/typed/linear.ts` (linear forms over named values, exact modulo 2^32, a read resolved through its
single reaching definition) and rewrote `bce`'s comparison to use it: a check `x >=u len` goes when a
dominating branch proved `x + k <u len` with `k ≥ 0`, the two forms over the same names, `k = 0` or `x ∈ [0,
MAX]` from `ranges`, and the same length value at both sites.

First run: the `i + 1` check went, the `i` check did not. Debugging showed `ranges` giving `[MIN, MAX]` for
*every* local of that function — even `n`, assigned `0` in the entry block. The cause is a monotonicity
defect in the transfer: an empty (bottom) environment was turned into "the assigned local is anything"
because `evalRange` reads a missing key as the full range, so a latch swept before its head wrote `full` into
the head and the join could never descend. `tests/typed/evaluate-analyses.test.mjs` pins blend's `i ∈ [0,
2147483646]`, and blend is unaffected because its order does not hit the case. Fixed with the smallest change
that states the rule: the transfer maps bottom to bottom.

With that, `ranges` sees `i ∈ [0, MAX]`, `i + 1` overflows the signed domain to `full`, and the join at the
head loses the bound again — so the second check still cannot be proven. That is the honest limit, and the
report's "later" says what would close it (an unsigned bound).

Measured: bounds-offset 1,364 → 1,224 under `O2` (−140) and 1,355 → 1,215 under `speed`; bounds-lab 5,333 →
5,109 and 5,012 → 4,788; corpus `O2` 1,090,271 → 1,089,907, `speed` 867,770 → 867,406. Regex, LZ and chess
unchanged (neither has the shape).

## Step 5 — the rule question

`scripts/06-hot-shapes.mjs` groups the hot unedited statements corpus-wide by value-tree shape: 40.9 % of the
executed instructions are charged to statements no pass's edit record names, and the hottest shapes are local
reads, loads with address arithmetic, `add(x, 1)` increments, unconditional `br`s and calls. The one shape a
rule could plausibly take is chess-search's `lt(rem(x, 16), 8)` (12,867 instructions), and it needs an
assumption the rule guard language cannot state (`x ≥ 0`). **No rule was added**; the reason is in the report
with the counts. That is a negative result for the brief's "rules" direction and the reason the work went into
a pass.

## Step 6 — verification and gates

- `tests/typed/bce-offset.test.mjs` (new, 3 tests): which check goes and which stays, the 140-instruction
  difference on the project case, and the form arithmetic (`i + 1` tested vs `i` checked differ by 1; a load is
  not linear).
- `node --test tests/typed/*.test.mjs`: 158 pass, 2 skipped, 0 fail. `tests/framework` + `tests/workbench`:
  258 pass, 1 skipped, 0 fail. `node tools/build-site.mjs` builds.
- Prettier on `src/typed/passes.ts`, `src/typed/analyses.ts`, `src/typed/linear.ts` and the new test (110
  columns, single quotes).

## Step 7 — what I would do with another hour

Take the `rem(x, 16)` finding seriously as a pass (`strength` extension with a signedness fact), and measure
an unsigned bound in `ranges` on the corpus before deciding whether it belongs there or in a second analysis.
