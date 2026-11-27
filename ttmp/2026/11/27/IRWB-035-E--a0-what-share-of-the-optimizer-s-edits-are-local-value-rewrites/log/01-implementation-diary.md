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
