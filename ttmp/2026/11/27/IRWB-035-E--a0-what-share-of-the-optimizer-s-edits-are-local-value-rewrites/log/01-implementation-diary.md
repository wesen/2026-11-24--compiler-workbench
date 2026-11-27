# IRWB-035-E implementation diary

## Step 1: the request, the reading, and the design (2026-11-27)

The user's task (verbatim abridged to its operative core):

> Your ticket is IRWB-035-E. ... (A0): what share of the optimizer's edits are local value rewrites?
> Classify every edit that the O2 and `speed` pipelines make on the corpus, using the correspondence and the edit records
> the framework keeps: local rewrite (a value replaced by an equal one, citing or matching a rule); structural (control
> flow, loop-invariant motion, inlining, unrolling, register allocation); other. Define each class precisely enough that
> the classification is reproducible, and say how you decide the borderline cases. The share per pass, per pipeline and
> per project, by edit count and by the instructions the edits affect. Of the local rewrites, what share already cites a
> verified rule, and which rules or rule shapes would cover most of the rest. The classifier is a tool, callable by other
> code, with a test, so later stages can rerun it.

Read first (done): `src/framework/contracts/README.md`, `src/framework/ir/README.md`,
`src/framework/passes/define-pass.ts`, `src/typed/strategies.ts`, `src/typed/passes.ts`, `src/typed/tx.ts`,
`src/typed/model.ts`, the IRWB-006/008/010 tickets (the 008 guide's census and re-derivation prototype are the
direct predecessors), `src/typed/inline.ts`, `src/typed/rotate.ts`, the rule tables.

Probe 1 (`scripts/01-edit-kinds-probe.mjs`): ran O2 and speed over three projects and dumped every (pass, kind)
pair with an example. The kinds observed: replace, remove, insert, local, block, retarget, replaceStmt, move,
merge, unreachable, inline — exactly the table in the design's §2. Timing note: `speed` on `chess-search` alone
takes ~176 s (inline grows the caller past a thousand statements and every later analysis walks it), so the full
census must run in the background.

Design written and committed (design-doc/01). Key decisions, with the alternatives considered there: the motion
test as the local/structural discriminator for `replace` edits (licm/lvn/inline replaces are bookkeeping of code
motion; subst/constprop/strength/fold/simplify replaces are pure value rewrites); dce/subst removals as `other`
(dead statement elimination is neither a value rewrite nor one of the listed structural transformations — and
it is a third, per-site-provable shape worth counting); instruction weight as owned+dropped image instructions
around each edit, using the backend's per-instruction `covers`.

## Step 2: the classifier's three surprises, the test, and the census (2026-11-27)

Implemented `src/typed/edit-class.ts` (classifyApplication, rederive) and `tests/typed/edit-class.test.mjs`
(5 tests, all pass). The test corpus taught the decision procedure three cases the design's first draft missed;
all three are now pinned in the design (§3.4) and handled by rules the edit records prove:

1. **Chained replaces (lvn).** lvn numbers one field twice: its first `replace`'s result tree is itself replaced
   by its second, so one tree exists only in the pass's working copy. The motion test now runs on the chain's
   surviving tree; a chained replace that is not motion bookkeeping is local with justification `none`
   (unverifiable from published data).
2. **A hoist of a hoist (licm on chess-search).** licm can hoist a hoist: the set it moved into an outer loop's
   body is itself hoisted out of that loop, giving a `replace` on a statement that exists in *neither* published
   revision as a pair. An edit on a statement the same application inserted is structural bookkeeping.
3. **Pruned blocks (licm on chess-search, lz-roundtrip, regex-nfa).** licm's own commit can prune the block of a
   statement it just rewrote; the edit is proved part of the pruning by the application's `unreachable` records.

Failure evidence for each was collected with inline probes (the reasons printed by the classifier) before fixing;
the census re-ran the three affected projects (chess-search, lz-roundtrip, regex-nfa) after the fix.

Census 02 ran over all 50 projects x O2/speed (946 s under load average ~37; chess-search alone is ~640 s —
inlining grows one caller past a thousand statements and every later analysis walks it). A second full run added
per-class instruction weights (the first run recorded owned/dropped per pass only, which cannot split subst's
50/50 mixes); the numbers below are from the second run.

Early sanity: no local rewrite is justification `none` anywhere on the corpus, and every fold/simplify replace
re-derives — the classifier agrees with IRWB-008's 394-of-394 measurement on the O2-family pipelines.

## Step 3: the census, the tables, and the report (2026-11-27)

The second census run (with per-class instruction weights) completed over all 50 projects x O2/speed in 594 s.
Probe 01, extended to per-pipeline kind counts, cross-checks the census exactly: O2 2,021 edits, speed 9,736,
the same per-pass kind mixes (e.g. O2 cfg: 486 retarget, 459 unreachable, 65 move, 22 remove, 22 merge,
4 replaceStmt).

Results (03-tables.mjs over the per-project JSONs; full tables in various/03-tables.txt):
- O2: local 19.5 % of edits, structural 72.1 %, other 8.4 %; by instruction weight local 48.1 %, structural
  48.5 %, other 3.4 %.
- speed: local 10.2 % / structural 84.1 % / other 5.6 % by count; 26.5 / 70.4 / 3.1 by weight (chess-search is
  75 % of speed's edits; without it: 15.0 / 76.1 / 8.9 and 39.1 / 56.5 / 4.4).
- Value edits (replace records): 505 on O2, 1,138 on speed; local = 78.2 % and 87.6 % of them; the rest is
  licm/lvn motion bookkeeping.
- Verified-rule coverage of local rewrites: O2 183/395 (46.3 %), speed 362/997 (36.3 %); justification `none` is
  empty everywhere. The rest is exactly three fact shapes: constprop's reaching-constant (399), subst's
  single-use copy (382), strength's non-negative range (66).

The final report (design-doc/02) states the method, the tables, the coverage, the meaning for programme A and
the limits. Framework changes: none were needed. Validation for the last commit: node --test tests/typed
tests/framework tests/workbench (the diary's next step records their result).

## Step 4: validation for the last commit (2026-11-27)

`node --test tests/typed/*.test.mjs`: 156 tests, 154 pass, 0 fail, 2 skipped (the pre-existing conditional
skips). `node --test tests/framework/*.test.mjs`: 234 pass, 0 fail. `node --test tests/workbench/*.test.mjs`:
25 tests, 24 pass, 0 fail, 1 skipped. The new suite `tests/typed/edit-class.test.mjs` is among them (5 pass).
`src/framework/` and `src/workbench/` are untouched, so the site bundle check does not apply; `npm run build`
(tsc) is clean; prettier was run on every file this ticket created or changed.
