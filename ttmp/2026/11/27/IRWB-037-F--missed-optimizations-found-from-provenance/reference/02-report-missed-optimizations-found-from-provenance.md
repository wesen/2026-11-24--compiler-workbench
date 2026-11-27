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
  (−2.4%) and 792,800 → 772,952 tuned (−2.5%); O2 1,090,271 → 1,085,269 (default) and 1,032,485 → 1,028,129 (tuned). No cell is higher than before; no pass is rejected.
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
- Indices `x + c` (a temporary whose one reaching definition is `x + c`) let `t = j - 1` twice be one index.
- Tried and removed: the branch case extended to `x + c < length` proving the index `x + c` (with a range fact
  excluding the overflow). It fired nowhere in the corpus (`scripts/12-bce-notes.mjs`, `various/bce-notes-final.txt`);
  on bounds-offset it correctly does not, since the range of `i + 1` includes the overflow at `i = MAX`, where the
  check must trap.
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

| Project | r0 | O2 | O2 tuned | speed | speed tuned | reference |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| across-calls | 660 | 640 | 630 | 270 | 210 | 700 |
| algebra | 100 | 20 | 20 | 20 | 20 | 170 |
| blend | 2,255 | 1,925 | 1,750 | 1,915 | 1,585 | 1,715 |
| bounds-lab | 5,923 | 5,333 | 4,843 | 5,012 → 4,611 | 4,426 → 4,025 | 4,234 |
| bounds-offset | 1,364 | 1,364 | 1,268 | 1,355 → 1,145 | 1,258 → 1,048 | 894 |
| bounds-param | 502 | 502 | 452 | 499 | 408 | 426 |
| bounds-two | 910 | 810 | 710 | 756 → 711 | 665 → 620 | 675 |
| branches | 165 | 139 | 131 | 139 | 131 | 211 |
| bytecode-vm | 39,954 | 32,295 → 31,667 | 24,750 → 24,436 | 32,295 → 31,353 | 24,750 → 24,122 | 28,889 |
| call-chain | 1,050 | 1,050 | 1,050 | 350 | 290 | 1,120 |
| calls | 651 | 651 | 580 | 288 | 227 | 840 |
| checksum | 1,710 | 1,410 | 1,260 | 1,251 → 1,101 | 1,110 → 960 | 1,170 |
| chess-search | 432,856 | 423,077 → 422,675 | 406,477 → 406,085 | 327,316 → 323,686 | 297,382 → 294,562 | 334,902 |
| collatz | 7,461 | 7,461 | 5,779 | 6,955 | 5,769 | 7,016 |
| constants | 100 | 70 | 70 | 70 | 70 | 160 |
| dead-code | 110 | 30 | 30 | 30 | 30 | 200 |
| diagnostics | 30 | 30 | 30 | 30 | 30 | 90 |
| distinct | 340 | 340 | 340 | 80 | 60 | 700 |
| div-checks | 172 | 162 | 152 | 162 | 152 | 308 |
| div-magic | 729 | 769 | 710 | 759 | 661 | 807 |
| early-exit | 761 | 631 | 559 | 564 → 506 | 557 → 499 | 575 |
| f32-dsp | 49,706 | 49,030 | 47,923 | 46,361 → 41,745 | 44,107 → 39,561 | 40,740 |
| first-steps | 280 | 220 | 220 | 80 → 70 | 80 → 70 | 500 |
| fixed-point | 429 | 411 | 392 | 251 | 242 | 647 |
| fragments | 2,697 | 2,299 | 2,090 | 2,289 | 1,891 | 2,021 |
| gcd | 324 | 324 | 314 | 314 | 265 | 365 |
| heat-lab | 8,832 | 8,832 → 8,136 | 8,026 → 7,330 | 8,664 → 6,918 | 7,996 → 6,250 | 6,758 |
| histogram | 2,416 | 2,292 → 2,044 | 2,008 → 1,760 | 2,222 → 1,798 | 2,000 → 1,576 | 2,036 |
| licm-nested | 2,677 | 1,678 | 1,678 | 1,631 | 1,596 | 2,426 |
| licm-traps | 153 | 153 | 153 | 149 | 142 | 196 |
| lz-roundtrip | 33,646 | 34,551 → 34,195 | 33,660 → 33,304 | 28,745 → 27,124 | 28,330 → 25,416 | 28,499 |
| match-enum | 282 | 251 | 226 | 251 | 226 | 396 |
| my-analysis | 200,975 | 200,975 | 200,795 | 200,966 | 200,618 | 200,696 |
| my-first-pass | 60 | 50 | 50 | 50 | 50 | 120 |
| nested-loops | 2,634 | 2,342 | 2,342 | 2,289 | 2,252 | 2,312 |
| orders | 1,350 | 1,194 | 1,010 | 1,185 | 952 | 1,351 |
| params-demo | 2,697 | 2,299 | 2,090 | 2,289 | 1,891 | 2,021 |
| pressure | 280 | 240 | 230 | 240 | 230 | 490 |
| ramp | 1,180 | 1,040 | 790 | 962 → 892 | 780 → 710 | 1,120 |
| records | 260 | 260 | 240 | 260 | 240 | 391 |
| regalloc-lab | 2,614 | 2,614 | 2,462 | 2,051 | 1,716 | 2,028 |
| regex-nfa | 41,650 | 40,212 → 38,580 | 38,745 → 37,113 | 35,638 → 33,630 | 28,128 → 26,936 | 34,041 |
| sha-chacha | 239,636 | 232,820 → 232,176 | 211,526 → 211,204 | 125,491 → 122,233 | 107,102 → 103,866 | 136,109 |
| sort | 5,043 | 5,043 → 4,647 | 4,589 → 4,193 | 4,950 → 3,959 | 4,563 → 3,572 | 3,898 |
| start-here | 4,385 | 3,871 | 3,467 | 2,932 → 2,811 | 2,559 → 2,438 | 3,167 |
| strength | 2,220 | 1,938 | 1,414 | 1,793 → 1,657 | 1,404 → 1,268 | 1,889 |
| strings | 11,895 | 10,833 | 9,282 | 10,283 | 9,262 | 9,392 |
| ui-gallery | 1,214 | 1,058 | 1,016 | 754 | 594 | 825 |
| value-numbering | 3,721 | 3,082 | 2,666 | 3,073 | 2,453 | 3,771 |
| wrong-shift | 1,950 | 1,650 | 1,490 | 1,491 → 1,341 | 1,340 → 1,190 | 1,410 |
| **total** | 1,123,009 | 1,090,271 → 1,085,269 | 1,032,485 → 1,028,129 | 867,770 → 847,183 | 792,800 → 772,952 | 875,417 |

changed: 19 projects; rose: none
rejected passes after: none

- 19 of 50 projects change; no cell is higher than before and no pass is rejected in either pipeline.
- O2 changes only through bce (the length hoist is `licm-lengths`, which O2 does not run).
- Above the reference under speed with the tuned options, only bounds-offset is left (1,048 against 894; before
  this ticket: bounds-lab, bounds-offset, f32-dsp, heat-lab, sort, my-analysis). With default options 14 projects
  are above it (blend, bounds-lab, bounds-offset, bounds-param, bounds-two, bytecode-vm, f32-dsp, fragments,
  heat-lab, my-analysis, params-demo, regalloc-lab, sort, strings); there the constant rebuilt before each check,
  which `homes` removes, is the shape the tool shows first.

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
  hoisting alone (no effect on that regression); `x + c < length` proving `x + c` (fired nowhere; removed).

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

All on the final compiler (compiler sources at commit FINALSRC: 2c913eb plus the removal of the unused bce case, which fired nowhere, so the corpus counts are 2c913eb's; checked again below), after `npm run build`:

| Check | Result |
| --- | --- |
| `node tools/parity.mjs` | 50 projects, 135 functions, 8,286 of 8,286 decided cases agree, 14 at the limit, 0 failures (`various/parity-after.log`); wrong-shift's `div-to-shift` rejected, as its `broken` pipeline intends |
| `node tools/reference-check.mjs` | reference images: 8,286 of 8,286 agree |
| `node tools/reference-check.mjs --o2` | our O2 images: 8,286 of 8,286 agree |
| `node --test tests/typed/*.test.mjs` | 163 tests, 161 pass, 2 skipped, 0 fail |
| `node --test tests/framework/*.test.mjs` | 234 pass |
| `node --test tests/workbench/*.test.mjs` | 25 tests, 24 pass, 1 skipped, 0 fail |
| `IRWB_FULL=1 node --test tests/typed/speed.test.mjs` | 9 pass: every project agrees with r0 under each backend option and all together |
| `IRWB_FULL=1 node --test tests/typed/backend.test.mjs` | 14 pass, after re-measuring nine projects' O2 image bytes (`scripts/15-o2-bytes.mjs`): six were already stale at the base (bytecode-vm, chess-search, lz-roundtrip, orders, regex-nfa, sha-chacha; `various/o2-bytes-base.txt`), three changed here (heat-lab, histogram, sort, 24 bytes each) |
| `node tools/build-site.mjs` | builds |
| `tools/format-docs.mjs --check`, `tools/format-corpus.mjs --check` | no file would change |

Tests changed: `missed.test.mjs` (new, 6 tests); `inline.test.mjs` (speed's pass list); `backend.test.mjs` (the
book's sort row 2,022 → 1,842 under O2, and 5,160 → 5,084 bytes); `corpus-expectations.mjs` (nine O2 byte counts);
`workbench/strategies.test.mjs` (18 passes). The book (chapter 14: the sort row and the byte total) and the notes
of regex-nfa and chess-search (their speed counts) say the new numbers.

## Later

- bce's existing branch case compares reaching-definition sets; it should use the path condition.
- Constants in registers by default (`homes`), the length inside `caddr` as a separate value, induction-variable
  strength reduction (the reference's pointer increments), jump threading for `&&` values.
- bounds-offset is above the reference with the tuned options (pointer induction variable, the `i + 1` check the
  reference also keeps); 14 projects are above it with default options (constants in registers).
- An available-checks framework analysis replacing `sameDefs`; pipeline entries with parameters.
