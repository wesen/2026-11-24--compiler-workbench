---
Title: 'Diary: rules over a term signature (IRWB-060-B)'
Ticket: IRWB-060-B
Status: active
Topics:
    - framework
    - compiler
    - stdlib
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological record of IRWB-060-B: the library src/stdlib/term, Typed's tables and verifier on it, Tix's inline and split-sum as rules, F40, and the measurement."
LastUpdated: 2026-11-28T02:10:00-05:00
WhatFor: "To follow the work, its failures and its measurements in order."
WhenToUse: "Reviewing the lane; continuing it."
---

# Diary

## Step 1 — Orient: the intern guide, the two rule paths, and the pinned behaviour

### Prompt Context

The task, quoted once (the ticket brief):

> You are working in a git worktree of the IR Workbench repository (TypeScript, Node 24). It compiles two languages on
> one IR framework (`src/framework/`: `core`, `ir`, `contracts`, `passes`, `dataflow`, `strategy`):
> - **Typed,** a small statically typed language compiled to 32-bit RISC-V (`src/typed/`; the corpus in `corpus/projects/`);
> - **Tix,** an index-notation tensor language compiled to CUDA (`src/tensor/`; its corpus in `corpus/tensor/`).
>
> Every optimization is a checked pass: a meaning contract compares a pass's output with its input on generated cases, and
> every edit carries a correspondence back to the IR before it.
>
> Your ticket is IRWB-060-B. This is a **library module and two domain ports, with a decision point**, in one session of
> up to three hours. Create your ticket with docmgr under `ttmp/2026/11/28/`. **Read the intern guide first:**
> `ttmp/2026/11/28/IRWB-059--…/design-doc/01-intern-guide-…md` explains the system and this round, including your lane.
> Keep a **detailed diary** in your ticket (`reference/01-diary.md`) as you work, one step per significant action … Write a
> short design note before you change code, and end with a report in the ticket.
>
> ## Your task: rules over a term signature (phase 4, item 4.6), and F40
> Read the R3 synthesis (`ttmp/2026/11/26/IRWB-019--…/various/r3-synthesis/index.html`) library row **terms** and the
> migration step "Rules over a term signature", after the guide.
>
> Typed already keeps its rewrite rules as data (`src/typed/rules/`: the tables in `simplify.ts`, `fold.ts`,
> `identities.ts`; the matcher `matchPat`, `firstMatch`, `indexRules` and guards in `compile.ts`; rule verification in
> `verify.ts`), but the matcher and the verifier are written against Typed's value handles. Tix's `inline` and
> `split-sum` (`src/tensor/passes.ts`) are hand-written rewrites of Tix expressions. Several places compare trees by hand
> (R3 counted `sameTree` twice, LVN and LICM keys, and copies of the matcher in A0's tools).
>
> 1. **`src/stdlib/term/`:** terms over a signature (a small interface a domain implements: operator, arity, children,
>    constant), structural hash and equality, `match` and `instantiate` for patterns with variables, and a rule-verification
>    interface (`verifyRule` over the signature plus a domain-supplied semantics and case generator), stated in standard
>    terms (first-order rewriting; Alive-style validation of a rule by evaluation on generated cases).
> 2. **Typed on it:** the rule tables match and instantiate through the library over Typed's signature, and `verify.ts`
>    verifies through the library's interface with Typed's semantics. The edit records, the derivations (rule ids, 183
>    rule-citing O2 records since IRWB-056-B) and every image must not change.
> 3. **Tix on it:** `inline` and `split-sum` as rules over Tix's expression signature, through the same library.
> 4. **F40:** Tix `inline`'s correspondence still says `removed` for a merged statement (the merge is only in the
>    derivation, `mergedInto`). Record it truthfully as `merged`, as IRWB-056-A did (`git show
>    v7-derivations-g-h/irwb-056-a:src/tensor/passes.ts`), and update the equality test that pinned the old entry.
>
> **Decision point:** measure the rule path against today's compiled matcher on the O2 corpus (interleave both in one
> process; the machine is loaded). If the library path is materially slower (more than about 10% of compile time), keep
> Typed's compiled visitor, share only the matcher and the verifier, and report the numbers.

The acceptance, in one line each: my tests in `tests/stdlib/` (match/instantiate, hash and equality laws, a rule
verified and a wrong rule refused with a counterexample, Tix revisions unchanged on every corpus program, the F40
correspondence test); the coordinator's baselines print `no differences`; the five suites pass; `npm run check`
is clean; `node tools/build-site.mjs` builds.

### What I did

Read the intern guide in full (both halves), then the lane's sources: `src/typed/rules/{form,compile,verify,semantics}.ts`,
`src/tensor/passes.ts`, `src/tensor/model.ts`, `src/tensor/ir.ts`, `src/framework/ir/derivation.ts`,
`src/framework/passes/{transformation,define-pass}.ts`, `src/framework/ir/correspondence.ts`, and the tests that pin
the behaviour I must not change (`tests/typed/rules.test.mjs`, `tests/typed/guards.test.mjs`,
`tests/typed/derivations.test.mjs`, `tests/framework/{derivation,one-runner,r3-defects}.test.mjs`). Read the R3
synthesis's library row `terms` and its migration step, and 056-A's `src/tensor/passes.ts` from the branch
`v7-derivations-g-h`.

Then confirmed the starting state: `npm run build` (9.9 s) and
`node ttmp/2026/11/27/IRWB-039--…/scripts/02-baselines.mjs check` → `no differences` (2 min 0 s).

### Why

The baselines are the oracle for "nothing else moved", and a lane that starts from a red tree spends its time on
the wrong question. Also, three of the four task items are constrained by what existing tests pin, so I need the
pinned assertions in front of me before choosing the shape of the port.

### What worked

- The guide's lane 4.6 section is accurate about the files; `wc -l src/typed/rules/*.ts` shows where the weight is
  (`verify.ts` 594 lines, `evidence.ts` 2086 lines of recorded data, `compile.ts` 188).
- `git log --oneline -5` puts the worktree on `e01f5cb` (the intern guide), one commit after the coordinator's
  baselines commit `f341706`, so the oracle and my tree agree.

### What didn't work

Nothing yet. Two findings from reading, though, both of which decide the design:

1. **A derivation cannot produce F40's entry.** `correspondenceFromDerivation` (`src/framework/ir/derivation.ts`)
   contributes an entry only for a step that makes an entity the output *did not have*
   (`fresh = produced.filter(id => !source.has(id))`), and drops a `merged` step whose target already existed
   (`if (step.relation !== 'removed') continue`). `tests/framework/derivation.test.mjs:207` pins exactly that:
   a `merged` step's entry is `{from: ['squareCopy'], to: [], relation: 'removed'}`. And `prepareNative`
   (`src/framework/passes/define-pass.ts:205`) throws `badResult` when a native result gives *both* a derivation
   and correspondence entries. So "record it as `merged`" and "keep the derivation" cannot both hold without
   changing `src/framework/ir/derivation.ts`, which my brief puts out of scope (it is lane F41's file).
2. **`sameTree` is not the library's structural equality.** `sameTree` (`src/typed/tx.ts`) compares `op`, `imm`,
   `type` and the arguments; the library's takes `op`, `constant` and the arguments. A `{same: x}` pattern in
   `sub-self` therefore has to keep using `handle.same`, not the library's equality, or a pattern could start
   matching (or stop matching) something it did not.

### What I learned

- Typed's value ids are allocated by `Tx` (`st.fresh`), in the order `Tx.rewrite` walks: children first, left to
  right, and the visitor runs at each node after its children are rebuilt. So an instantiation that makes its
  nodes children-first left-to-right keeps every id, and therefore every derivation step and edit record,
  identical. That is the invariant to hold, not merely "the same output value".
- `verifyRule`'s evidence is pinned in two tests by verdict, strength and counterexample identity
  (`fadd-neg-zero`'s NaN payload, `div-pow2-shr`'s negative `x`, `fsub-self`'s `0x7fc00000`), so the enumeration
  order of the methods cannot change, only where the loop lives.

### What was tricky

Deciding what "the rule path" and "today's compiled visitor" mean, since today's table passes *are* the compiled
visitor and there is no second implementation lying around: the comparison has to be made against a copy of the
pre-change matcher kept in the ticket's `scripts/`, running the same pass specs over the same revisions.

### What warrants a second pair of eyes

- The F40 resolution (correspondence entries instead of a derivation; see step 3) — it trades a K2 record for a
  truthful correspondence entry, and the reverse trade is what 056-B chose.
- Whether the library should own a traversal; I argue not, for one client (design note §1).

### Code review instructions

No code yet. Review the design note beside this step
(`design/01-design-note-rules-over-a-term-signature.md`), especially §4 (why `exhaustive-32` stays in Typed) and
§6 (F40).
