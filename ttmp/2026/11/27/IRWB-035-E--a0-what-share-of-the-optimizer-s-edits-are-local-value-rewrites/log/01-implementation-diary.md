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
