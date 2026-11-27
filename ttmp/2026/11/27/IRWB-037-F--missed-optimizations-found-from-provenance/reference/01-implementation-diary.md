---
Title: Implementation diary
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
Summary: ""
LastUpdated: 2026-11-27T12:41:37.640700608-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: Baseline, a hot-statement view and a shape census

I measured the three benchmarks again after D1, extended D1's attribution with a view of what is left (the hot
statements of the last revision with their machine instructions and provenance, and the reference image's
instructions per function), and ran a shape census of executed value trees over the corpus. The outcome is three
findings (F1 dominated bounds checks, F2 bcm in no pipeline, F3 constants inside addresses) and a design.

### Prompt Context
**User prompt (verbatim):** "Read the file /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/prompts/typed/d2/claude/IRWB-037-F.md and follow it exactly. It is your whole task: it names your git worktree, the standing instructions and the brief. Read nothing else under that IRWB-019 ticket directory."
**Assistant interpretation:** the brief (D2): find hot instructions no rule or pass improves, using D1's attribution; add verified rules and checked pass changes; measure the corpus against the reference.
**Inferred user intent:** close the gaps to the reference compiler (regex, LZ) with evidence-backed changes, and report the method.
**Commit (code):** 1b71d71 — "IRWB-037-F: ticket, design, baseline benchmark and shape census scripts"

### What I did
- `npm ci`, `npm run build` (the worktree had no node_modules).
- `scripts/01-bench-three.mjs` (regex, LZ, chess as their tickets measured them) -> `various/bench-before.json`.
- `hotSites` in `src/typed/attribute.ts`; `--hot N`, `--reference` and comma-separated pass lists in `tools/attribute.mjs`.
- `scripts/02-shape-census.mjs speed --backend tuned` -> `various/census-speed-before.txt`.
- `scripts/03-corpus-measure.mjs` (IRWB-034-G's script plus a reference column) -> `various/corpus-before.json` (about 25 minutes under load 11).

### What worked
- Benchmarks: regex 8,183 / 6,933 (default) / 5,405 (tuned) / 6,628 (reference); LZ 185,876 / 159,079 / 156,782 / 156,405; chess 14,804,396 / 10,038,193 (tuned) / 10,827,760.
- The hot view on regex shows four checks `if (i >=u 9)` dominated by an identical check (346 instructions); on LZ the three checked addresses of the inlined `hash3` in one block, which bcm would merge but no pipeline runs.
- A probe of `speed` with bcm after bce: LZ tuned 156,782 -> 148,250.
- After bcm the hot view shows `caddr(input, ((p + 1) + -1)) + 2` and `input + ((p + 2) << 1)`: constants the backend cannot fold into the load offset.

### What didn't work
- `node tools/attribute.mjs ... --reference` first failed with `TypeError: img.insns is not iterable`: `lowerToImage` returns an artifact, `imageFromCode` a bare image; fixed with `(img.value ?? img)`.
- A heredoc to `ttmp/.../IRWB-037-F*/scripts/...` did not expand the glob in a redirection (zsh: `no matches found`); I use the full path since.

### What I learned
- Regex's 8,040 was with default backend options; with the tuned options `speed` already beats the reference (5,405). The remaining default-option gap is mostly constants rebuilt before each check (`addi rX, zero, 9`), which `homes` removes.
- bcm (IRWB-001, for Candela) is in no pipeline.
- `Tx.rewrite` visits each node once, bottom-up, with the rebuilt children: a rule's output is not revisited, but its parent sees it.

### What warrants a second pair of eyes
- The existing bce case (a dominating `lt`) accepts equal reaching-definition sets as "same value"; that is not sufficient in general (`A; if (c) i = i + 1; B` in a loop). The new case uses a stronger condition; the old one is unchanged and noted under Later.

## Step 2: bce, the reassoc rules and the verifier

Implemented the three changes of the design: bce removes a check dominated by a check of the same index against
a bound no larger; a rule table `reassoc` with three constant-reassociation rules as a table pass; and two
extensions of the verifier so the rules are proofs rather than samples.

### What I did
- `src/typed/passes.ts`: bce's `checkOf`, `sameDefs` (statement order through dominators; every definition reaching
  the second check runs before the first), `dominatingCheck`; the `reassoc` pass.
- `src/typed/rules/reassoc.ts`: `add-add-const`, `shl-add-const`, `add-inner-const`; listed in `RULE_SETS`.
- `src/typed/rules/verify.ts`: symbolic-linear treats a constant variable without an instance as a degree-one
  symbol, evaluates `{eval: add|sub|mul|shl}` templates symbolically, instantiates shift-only constant variables over
  0..31; the structural check no longer counts a constant variable used on the right as an effect.
- `scripts/04-verify-candidates.mjs`, `scripts/06-record-evidence.mjs` (adds the three records to `evidence.ts`).

### What didn't work
- First verification: `shl-add-const` and `add-inner-const` failed structurally: "the variables x are reordered
  without pure: their effects would change order". The right side uses the constant variable `k` as a tree
  (`{ var: 'k' }`), which the effect sequence counted while the left side's sequence skips constant variables.
- Second: `add-inner-const` failed symbolic-linear with `0 + 1·y + 1·x + 1·#c ≠ 0 + 1·y + 1·x + 1·c`: I had keyed
  symbols `#c` while `{ var: 'c' }` on the right is keyed `c`. Keyed both by the name (names are bound once).

### What worked
- With both fixes, all three rules: sound, proof (symbolic-linear; `shl-add-const` over 32 instances of `k`).

## Step 3: The first bce condition was too strong; lvn crashed when placed late

The first regex run with the new bce gave -90 instead of the -346 the hot view predicted. The checks of `state` in
the last loop stayed: my "every definition reaching the second check runs before the first" rejects the loop's
own increment at the latch, which reaches both checks but cannot run between them. I replaced it with the path
condition (no assignment on any path from the first check to the second that does not pass the first again,
computed as the blocks forward-reachable from the first and backward-reachable from the second, both without
entering the first's block). Regex then fell by exactly 346, to 6,628, the reference's count.

**Commit (code):** 8526358 — "IRWB-037-F: bce on a dominating check of the same index, the reassoc rules (proved), lvn's stale entries, speed with bcm, reassoc, simplify, lvn; hot statements in the attribution"

### What didn't work
- `sh scripts/07-corpus-variants.sh`: the variant with lvn after reassoc failed on regex-nfa:
  `TxError: [absent] v:regexMatch.559 is not used in regexMatch at this revision` at `Tx.replace` from lvn.
  `scripts/09-debug-shared-values.mjs` showed no shared value nodes at any revision, so the rules were not the
  cause. lvn keeps a map of the trees it has seen; after a replacement it rebuilt the trees of both statements with
  new ids, and an entry for an enclosing tree of the first occurrence still named the old id. Fixed by dropping the
  entries of both statements after a replacement (a pre-existing defect, exposed by running lvn after subst).

### What worked
- Corpus variants (`various/variants-corpus.txt`, speed, default/tuned): base 832,132/764,672 (projects without
  the crash); bce 829,241/762,689; +bcm 828,661/760,506; +reassoc,simplify 826,130/757,985; +lvn 824,746/756,601.
  Each step lowered the total and no project rose, so all four went into `speed`.
- Round 1 measured (`various/corpus-after.json`, `bench-after.json`): speed 867,770 -> 858,456 default,
  792,800 -> 783,617 tuned; O2 1,090,271 -> 1,086,239; regex 6,933 -> 6,523, LZ tuned 156,782 -> 140,105.

### What warrants a second pair of eyes
- `sameDefs` in bce (`src/typed/passes.ts`): the path argument, and that a block reachable both ways is counted
  whole (conservative).

## Step 4: Round two from the gap list: buffer lengths, offset indices, SHA's choice and majority

Projects still above the reference with tuned options: bounds-offset, sort, heat-lab, f32-dsp, bounds-lab. The hot
view of bounds-offset shows `lw t3, 0(a0)` (the buffer's length) before each of three checks per iteration; the
reference keeps the length in a register. In sort, `work[j - 1]` is checked twice through two temporaries
`t = j - 1`, which bce's index identity (a local) did not equate. The census showed SHA's choice and majority.

### What I did
- licm hoists `load32[b+0]` for a buffer local b the loop does not assign (`lengths: false` turns it off).
- bce sees through the hoisted length (`lengthBuf`: a local whose one reaching definition is the length load);
  an index is a local plus a constant (`resolve`), so `t = j - 1` twice is one index.
- `src/typed/rules/bitwise.ts` (`choice`, `majority`, proved at width 1), pass `typed.bitwise`.

### What worked
- Probes: bounds-offset 342 -> 284 (default, one case), sort 2,022 -> 1,571 under speed (reference 1,533).

### What didn't work
- `x + c < length` proving the check of `x + c`: does not fire on bounds-offset, correctly: the range of `i + 1`
  includes the overflow at `i = MAX`, where the check must trap.
- A waiting loop `until ! pgrep -f "10-rule-firings.mjs O2"` matched its own command line and never ended; killed.

## Step 5: The length hoist raised chess-search with the tuned options; two guards

**Commit (code):** 1ea00c1 — "IRWB-037-F: licm hoists buffer lengths read twice or more from outermost loops; bce sees through them and indexes x + c; bitwise rules (choice, majority) in speed; round-2 measurements"

Round two over the corpus (`various/variant-nolengths.json`, `corpus-round2.json`, `variant-bitwise.json`):
hoisting lengths took speed from 857,421/782,486 to 842,624/776,834 (default/tuned) and O2 from 1,085,269 to
1,071,282, but chess-search under speed with the tuned options rose (296,935 to 298,772) and regex-nfa under O2
rose against round one (38,580 to 39,000; still below the 40,212 before this ticket). The bitwise rules took
sha-chacha down by 1,280 in both cells and changed nothing else.

### What I did
- First guard: only an outermost loop hoists a length (its body holds the inner loops' lengths). Measured
  (`various/corpus-round3.json`): no change to either rise (chess tuned 298,982; regex O2 39,000).
- `scripts/13-per-function.mjs chess-search`: lengths on against off, per entry function, tuned options:
  chessPerft +1,990, small functions +10 to +83 each, chessSearch -80. A length read once per iteration saves one
  load per iteration but holds a register across the loop, and small loops lose.
- Second guard: hoist a buffer's length only when the loop reads it at least twice. Per function after it:
  chessSearch -1,354, chessPerft -1,130, five small functions +10 to +48; net -2,373 against lengths off.

### What I learned
- The census's largest check shape, `geu(x, load)` (20,513 weighted executions), was mostly this reload.
