---
Title: 'Report: missed optimizations found from provenance'
Ticket: IRWB-037-F
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Method (hot statements with provenance, shape census, gap list), five shapes, the rules and pass changes, corpus and benchmark counts before and after against the reference
LastUpdated: 2026-11-27T13:23:40.98689637-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: missed optimizations found from provenance

## Summary

- **Method.** D1's attribution says what each pass did; this stage needed what is left. `hotSites`
  (`src/typed/attribute.ts`; `tools/attribute.mjs <project> <pipeline> <fn> --hot N`) lists the hottest statements
  of the last revision with their machine instructions, their r0 ancestor's count and every edit of the chain that
  names them; `--reference` prints the reference image's count per function and its hottest instructions beside
  them. A shape census of executed value trees over the corpus (`scripts/02-shape-census.mjs`) ranks rule-shaped
  candidates across projects. The second round took the projects still above the reference as its list.
- **Shapes found** (each from the tool's output): dominated bounds checks of the same index, bcm in no pipeline,
  constants inside addresses, buffer lengths reloaded before every check, SHA's choice and majority.
- **Changes.** bce (a dominating check of the same index; indices `x + c`; sees through hoisted lengths), licm
  (buffer lengths, as the pass `licm-lengths`), two verified rule tables (`reassoc`, 3 rules; `bitwise`, 2 rules;
  all five proofs), an extension of the verifier's symbolic-linear method that makes the reassociation rules
  proofs, a fix of a crash in lvn, and `speed` with licm-lengths, bcm, reassoc, bitwise, simplify and lvn.
- **Benchmarks, `speed`:** regex 6,933 → 6,515 with default options (reference 6,628; 5,405 → 5,160 tuned); LZ
  156,782 → 140,105 tuned (reference 156,405; 159,079 → 149,893 default); chess 10,038,193 → 9,955,027 tuned
  (reference 10,827,760).
- **Corpus** (50 projects, the seeded cases `measure` uses): `speed` 867,770 → 847,183 with default options
  (−2.4%) and 792,800 → 772,952 tuned (−2.5%); O2 TOTAL_O2. No cell is higher than before; no pass is rejected.
  The reference compiler: 875,417.
- **Framework:** `src/framework/` is unchanged. Two pieces of domain machinery do what framework concepts should
  (section "Framework changes").

## Before: the three benchmarks after D1

`scripts/01-bench-three.mjs` measures them as their tickets did: regex `[a-c]*[b-d]*a*d` over `abccabbd`; LZ the
100 seed-7 round trips; chess quiet-mate-in-two at depth 3 (fixtures.mjs). "tuned" is chains + coalesce + homes.

| Benchmark | r0 | speed, default | speed, tuned | reference |
| --- | ---: | ---: | ---: | ---: |
| regex | 8,183 | 6,933 | 5,405 | 6,628 |
| LZ | 185,876 | 159,079 | 156,782 | 156,405 |
| chess | 14,804,396 | | 10,038,193 | 10,827,760 |

D1 had taken the regex from 8,040 to 6,933. Its 8,040 is with default options; with the tuned options `speed`
already beat the reference. The gaps left were regex +305 (default) and LZ +377 (tuned).

## Method

1. **Hot statements with provenance.** For the last revision of a chain, per statement: executed instructions
   (summing to the emulator's count, tested), the machine instructions with their counts, the ancestor at r0
   through statement origins and its count there, and the edits that name the statement or an ancestor. A hot
   statement with no decision, or only `retarget`/`move`, whose count did not fall, is code no pass improved.
   With `--reference` the same call runs on the reference image, per function and per hottest instruction, which is
   how a loop is read side by side (the reference image has no statement records, so the comparison is by reading).
2. **Shape census** (`scripts/02-shape-census.mjs`, `various/census-speed-before.txt`): every value-tree node of an
   executed statement, weighted by the statement's executions, grouped by its operator over its operands'
   operators. Top rows before: `add(x, shl)` 35,957, `shl(x, 1)` 26,245, `load(x)` 24,974, `add(x, 1)` 22,537,
   `geu(x, load)` 20,513 (a check against a buffer's length).
3. **Gap list** (`scripts/03-corpus-measure.mjs` adds the reference column to D1's corpus script): projects above
   the reference with tuned options after round one were bounds-offset, sort, heat-lab, f32-dsp and bounds-lab.
4. Each candidate rule is written in the rule language, verified with `verifyRule` (`scripts/04`), recorded
   (`scripts/06`), and kept only when the corpus measurement shows it pays; each pass change is measured by toggling
   it (`scripts/05`, `07`, `13`).

## Shapes found, with their instruction counts

| Shape | Where (tool output) | Instructions | Change |
| --- | --- | ---: | --- |
| `if (i >=u 9) trap` dominated by the same check of `i` | regex `current[first]`, `next[state]` read then written | 346 in the benchmark (default) | bce |
| three checked addresses of the inlined `hash3` in one block | LZ `compress` | 7,491 over the 100 cases (tuned; 0 default) | bcm in speed |
| `caddr(input, ((p + 1) + -1)) + 2`, `input + ((p + 2) << 1)` | LZ after bcm | 5,022 default and tuned (100 cases; 3,348 without the simplify after it) | reassoc |
| `lw t3, 0(a0)` (the length) before each of three checks per iteration | bounds-offset, sort, chess | 14,797 default, 5,652 tuned (corpus, unguarded) | licm-lengths |
| `work[j - 1]` checked twice through two temporaries `t = j - 1` | sort, heat-lab | 1,035 default, 1,131 tuned (corpus) | bce, `x + c` |
| `(e & f) ^ (~e & g)`, `(a & b) ^ (a & c) ^ (b & c)` | sha-chacha | 1,280 (corpus) | bitwise |

Seen and not addressed (under "Later"): constants rebuilt before every check with default options (`addi rX,
zero, 9`; the `homes` option already removes them), the length reloaded inside every `caddr` (the reference
keeps it in a register; it is not a separate IR value), `x * 5` in regex's closure loop, the `&&` value built and
then tested (jump threading), pointer induction variables (the reference's `addi s2, s2, 2` in LZ).

## Rules and pass changes, their verification and gains

Gains are measured by toggling each change in order (`various/variants-corpus.txt`, `variant-*.json`,
`corpus-round*.json`; speed, default/tuned, corpus totals over the projects every run had).

| Change | Verification | Gain (speed, default / tuned) |
| --- | --- | ---: |
| bce: dominating check of the same index | meaning contract on every application; parity; tests (`missed.test.mjs`) | −2,891 / −1,983 (49 projects), regex −346 |
| bcm after bce in speed | its existing checks; contract | −580 / −2,183; LZ tuned −7,491 |
| reassoc + simplify after the last subst | 3 rules, proof (symbolic-linear), recorded evidence; contract | −2,531 / −2,521 |
| lvn after them (with the lvn fix) | contract | −1,384 / −1,384 |
| bce: indices `x + c` | contract; tests | −1,035 / −1,131 |
| licm-lengths (read twice or more, outermost loops) | argument below; contract; parity | see final row |
| bitwise | 2 rules, proof (bitwise-w1), recorded evidence; contract | −1,280 / −1,280 (sha-chacha) |
| **all, final** | | **−20,587 / −19,848** |

### bce: a dominating check of the same index (`src/typed/passes.ts`, bce)

A check `i >=u k` with a trap goes when a dominating check of the same index against `k' ≤ k` (frame arrays:
constants), or against the same buffer's length, has a fall-through arm that dominates it, and the index holds
the same value at both. Unsigned, so no range fact is needed. "Same value": the first check runs before the
second on every path, and no path from the first to the second that does not pass the first again assigns the
local; computed as the blocks reachable forward from the first check's block and backward from the second's, both
without entering the first's block.

- My first condition (every definition reaching the second check runs before the first) rejected the loop's own
  increment at the latch and removed 90 of the 346 instructions. The path condition removed all 346.
- The existing case (a dominating `i < length` branch) compares reaching-definition sets; that is not enough in
  general (`A; if (c) i = i + 1; B` in a loop has one set at A and B). It is unchanged; listed under Later.
- Indices `x + c` (a temporary whose one reaching definition is `x + c`) let `t = j - 1` twice be one index. The
  case `x + c < length` proving `x + c` is implemented but does not fire on bounds-offset, correctly: the range of
  `i + 1` includes the overflow at `i = MAX`, where the check must trap.
- Simplest alternative: global value numbering of checks. More machinery for one target.

### licm-lengths (`src/typed/passes.ts`, licm with `lengths: true`)

`load32[b+0]` for a buffer local `b` the loop does not assign is invariant: no statement writes a length word
(stores into a buffer go through positions checked against the length, at offset 4 and up), and a buffer local
holds a buffer, so the load cannot trap. bce sees through the hoisted local (`lengthBuf`: a local whose one reaching
definition is the length load, the buffer unchanged since).

- Unguarded it gained 14,797 / 5,652 on speed and 13,987 on O2 but raised chess-search under speed tuned (296,935
  → 298,772). Per function (`scripts/13-per-function.mjs`): chessPerft +1,990, small functions +10 to +83. A length
  read once per iteration saves one load per iteration and holds a register across the loop.
- Guard 1, outermost loops only (their bodies hold the inner loops' lengths): no change to the rise. Guard 2,
  only lengths read at least twice in the loop: chessSearch −1,354 and chessPerft −1,130 against lengths off; the
  rise is gone. The threshold is the argument above (two reads save at least two loads per iteration against one
  register), confirmed by the measurement; a count of one was the measured loss.
- It is a pass of its own, `licm-lengths`, which `speed` runs in licm's place, because a pipeline names passes and
  cannot give one a parameter, and with it in licm O2's Blend and Checksum images no longer matched the book
  (Checksum 366 → 326 instructions, pinned in `backend.test.mjs` and chapter 14).

### reassoc (`src/typed/rules/reassoc.ts`, pass `typed.reassoc`)

| Rule | Text | Strength |
| --- | --- | --- |
| add-add-const | `add(add(x, #a), #b) → add(x, #add(a, b))` | proof (symbolic-linear) |
| shl-add-const | `shl(add(x, #a), #k) → add(shl(x, k), #shl(a, k))` | proof (symbolic-linear, 32 instances of k) |
| add-inner-const | `add(y, add(x, #c)) → add(add(y, x), c)` | proof (symbolic-linear) |

The backend folds the outermost `+ c` of an address into the load or store offset; these move constants there.
A separate table pass rather than new simplify rules: simplify's table must give the hand-written pass's
revisions (a B1 test), and simplify runs before subst and bcm build these trees. Firings under speed: 16, 27 and
13, in f32-dsp, lz-roundtrip, chess-search, first-steps, dead-code and regalloc-lab.

### bitwise (`src/typed/rules/bitwise.ts`, pass `typed.bitwise`)

| Rule | Text | Strength |
| --- | --- | --- |
| choice | `xor(and(x, y), and(xor(x, -1), z)) → xor(z, and(x, xor(y, z)))` if pure x, y, z | proof (bitwise-w1) |
| majority | `xor(xor(and(x, y), and(x, z)), and(y, z)) → or(and(x, y), and(z, or(x, y)))` if pure x, y, z | proof (bitwise-w1) |

Found by the census (`xor(and, and)` 1,280, `and(xor, x)` 640). Each removes one operator; sha-chacha −1,280.

### The verifier (`src/typed/rules/verify.ts`)

- symbolic-linear: a constant variable that is not a power of two is a symbol of degree one (before, the method
  was skipped for such rules); `{eval: add|sub|mul|shl}` in a template is the same polynomial in its constant
  variables; a constant variable read only as a shift amount is instantiated over 0..31, since every operator that
  reads it masks it to five bits. Without this the reassoc rules were "sampled".
- structural: a constant variable used as a tree on the right (`{var: k}`) is not counted as an effect (it is
  bound to a constant). Before, `shl-add-const` and `add-inner-const` were rejected as "reordered without pure".
- Checked: the recorded strengths of the 67 existing rules are unchanged (`rules.test.mjs`); a wrong variant
  (`(x + a) << k → (x << k) + a`) is refuted and a nonlinear one (`(x + a) * k`) stays "sampled" (`missed.test.mjs`).

### lvn's stale entries (`src/typed/passes.ts`, lvn)

Running lvn after subst crashed on regex-nfa: `TxError: [absent] v:regexMatch.559 is not used in regexMatch at
this revision`. After a replacement lvn's map of seen trees still named the old id of an enclosing tree; it now
drops the entries of both statements. `scripts/09-debug-shared-values.mjs` ruled out shared value nodes first.

## Instructions per corpus project

Summed over the seeded cases `measure` uses (10 per function, seed 7), `scripts/03-corpus-measure.mjs`, before
(`various/corpus-before.json`, at 2966b9b) and after (`various/corpus-final.json`). A cell with an arrow changed.
"tuned" is chains + coalesce + homes. The reference compiler's image runs the same cases.

CORPUS_TABLE

## Rule firings

`scripts/10-rule-firings.mjs` over the corpus. Under speed before this ticket 14 of simplify's 27 rules fired (13
never) and 6 of fold's 40; under O2, 12 of 27. After: simplify and fold unchanged (14, 6), reassoc 3 of 3, bitwise 2
of 2 (`various/firings-*.txt`). The never-firing simplify rules (`one-mul`, `zero-mul`, the five `*-zero`
identities, `and-zero`, `and-ones`, `not-eq`, `not-ltu`, `not-geu`, `not-not`) have no executed shape in the census
either: no gap points at them.

## New approaches, and what they gave

- **Hot statements with provenance** found the regex shape directly (the four dominated checks, 346 instructions,
  predicted and then measured exactly) and, after bcm, the LZ address shapes.
- **Shape census** found the choice/majority rules and ranked `geu(x, load)` (the length reload) near the top. It
  does not see shapes that cost in the backend without being a tree (the constant rebuilt before each check).
- **Gap to the reference as a work list** (round two) found the length reload and the offset indices. It does not
  say what the reference does differently; reading the reference's hottest instructions beside ours did.
- Negative results: hoisting every length (a regression in one cell, fixed by the read-count guard); outermost-only
  hoisting alone (no effect on that regression); `x + c < length` proving `x + c` (does not fire; correctly).

## Framework changes

None: `src/framework/` is unchanged. Machinery built in the domain that a framework concept should provide:

| What | Duplicates or misses | Why here |
| --- | --- | --- |
| bce's "same value at two statements" (`sameDefs`, a CFG path query) | an available-expressions analysis, as a framework dataflow analysis (forward, must, meet = intersection, killed by an assignment of the local); its second use would be lvn across blocks | bce walks the dominator tree already; one query per candidate pair was enough here |
| the rule verifier and rule tables compiled to `Tx.rewrite` visitors (IRWB-006) | rewrite rules with verification evidence as a framework concept beside `ir/patterns` | the existing design; this stage only extended the verifier |
| `licm-lengths` as a pass name | pipeline entries with pass parameters (a strategy `apply` with arguments) | proposed rather than built: one pass needed it |

## Measured and argued

Measured: every instruction count above (emulator runs, scripts 01, 03, 05, 07, 13, the tool); the attribution sums
(tests); rule firings (script 10); which bce cases fire (script 12); the verifier's verdicts (scripts 04, 06).
Argued, and checked only by the meaning contract on generated cases, parity and the reference checks:

- that bce's path condition implies equal values (the argument in the code comment);
- that a buffer's length word is never written during a call and its load never traps;
- that the verifier's symbolic treatment and the shift-amount instantiation are sound (polynomial identity over
  Z/2^32; every shift masks its amount to five bits);
- that the read-count threshold of two is right beyond the corpus.

## Verification

All on the final compiler (commit FINAL_HASH), after `npm run build`:

VERIFICATION

## Later

- bce's existing branch case compares reaching-definition sets; it should use the path condition.
- Constants in registers by default (`homes`), the length inside `caddr` as a separate value, induction-variable
  strength reduction (the reference's pointer increments), jump threading for `&&` values.
- f32-dsp, heat-lab, sort, bounds-offset and bounds-lab are still above the reference under some options.
- An available-checks framework analysis replacing `sameDefs`; pipeline entries with parameters.
