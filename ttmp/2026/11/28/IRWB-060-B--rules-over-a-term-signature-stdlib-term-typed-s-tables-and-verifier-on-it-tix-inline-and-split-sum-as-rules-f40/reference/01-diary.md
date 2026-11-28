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

## Step 2 — The library module: `src/stdlib/term/`

### What I did

Wrote four files and the index exports:

- `signature.ts` — `Signature<T>` (`op`, `args`, optional `constant`), `equalStructure`, `structuralKey` (a
  canonical text), `structuralHash` (FNV-1a over the key, 8 hex digits), `size`.
- `pattern.ts` — `Pattern<T>` (`var`, `const`, `bindConst`, `same`, `op`), `Template<T>` (`var`, `const` with an
  optional computed form, `op`, `build`), `Builder<T>` (`constant`, `operator`, each given `attrs` and `outermost`),
  `match`, `instantiate`, `patternVariables`, `templateVariables`, `patternOp`.
- `rules.ts` — `Rule<T,G>`, `indexRules`, `firstMatch` (with the domain's guard function and equality), the
  `MatchResult` naming the matched node.
- `verify.ts` — `CaseGenerator<V>` (variables, `cases()`, `holds()`), `RuleSemantics<V>` (`evaluate(side, assignment)`,
  `agrees`), `verifyRule` (the Alive-style loop: guard filter, case count, first counterexample, and the one law the
  interface can check — the generator's variables are the rule's pattern variables in order).

### Why

The brief's item 1, and the two hooks (`Builder`, `build`) are what let both domains instantiate without the library
knowing a transaction or a binder. See the design note §1–§2 for what is deliberately absent (a traversal).

### What worked

`npx tsc --noEmit` clean after two fixes: a `Pattern<T>` narrowing (`else` → `else if ('op' in p)`), and replacing a
half-baked `WeakMap` for computed template constants with an explicit `{ compute, reads }` form, so the library can
still see which variables a computed constant reads.

### What didn't work

First draft of `templateVariables` handled a computed constant with a `WeakMap` that nothing ever wrote to, and a
`fail()` helper that threw from inside a `??`. Garbage; removed before it ran.

### What I learned

The signature must be allowed to put *attributes* in the operator label (`load:f/a/2`), because a read's indices are
affine forms, not subterms. That single decision is what makes Tix's signature expressible at all.

### What warrants a second pair of eyes

`structuralKey` builds one string per term: it is the canonical form and the hash input. For Typed's use (matching)
it is never called; for a cache key it is O(size) with allocation. Acceptable here, worth noting for the LVN/LICM
clients R3 named.

### Code review instructions

`src/stdlib/term/{signature,pattern,rules,verify}.ts`. Check `match`'s treatment of a repeated `var` (rebinds, as
Typed's old `matchPat` did) and `instantiate`'s `outermost` flag.

## Step 3 — Typed's tables on the library: `src/typed/rules/compile.ts`

### What I did

- `valueSignature`: a `ValueHandle` read as a term (`op = handle.op`, `args = handle.args`,
  `constant = isConst ? imm : undefined`); `sameHandle = (a, b) => a.same(b)` (sameTree, which also compares a
  value's type — the library's structural equality does not).
- `libraryPattern`/`libraryTemplate`: a Typed `Pat`/`Tpl` as the library's `Pattern`/`Template`, memoised per rule
  (`libraryRule`, a `WeakMap`); a computed template number becomes `{ compute, reads }` where `compute` is the
  existing `numOf`; an f32 constant carries `attrs: { type: 'f32' }`.
- `firstMatch`/`indexRules` are now the library's, with `guardHolds` as the guard function; `matchPat` is gone.
- `instantiate` is the library's, with a `Builder<ValueHandle>` made per firing (`builderFor`): it closes over the
  transaction, the matched node (for `because: 'const-args'`) and the bindings (for the note's `{k}`/`{log2 k}`), and
  it puts the rule's provenance on the replacement's root only — which is what the old `instantiate` did with its
  `prov`/`{}` arguments.
- `src/typed/edit-classes.ts` (the third client, over its own `Tree`) now uses the library's `firstMatch` and
  `instantiate` too, through a `Builder<ValueHandle>` that builds `TreeHandle`s. Its second copy of the template
  semantics is gone.

### Why

Brief item 2: "the rule tables match and instantiate through the library over Typed's signature", and the ids,
derivations and edit records must not move.

### What worked

`node --test tests/typed/rules.test.mjs` passed first time (the 4.3 s test "the tables give the hand-written passes'
revisions, edits and correspondences"), and the baselines still printed `no differences` — so ids, derivations and
edit records are unchanged. The 183-rule-citing test and the O2-correspondence test in
`tests/typed/derivations.test.mjs` also passed untouched.

### What didn't work

- `import ... from '../../stdlib/term/index.js'` — there is no per-module `index.ts` in this library (only
  `src/stdlib/index.ts`); other modules are imported file by file. Fixed by importing `pattern.js`, `rules.js`,
  `signature.js` directly. I did not add a `term/index.ts`, to follow the convention.
- `Bindings` changed from `Record<string, ValueHandle>` to the library's `ReadonlyMap`: `guardHolds`,
  `guardPremises`, `noteOf` and `edit-classes`' `treeBound` all had to change `b[x]` to `b.get(x)`.
  `npx tsc` named every site.
- `compileRules` first looked the typed rule up with `rules.find(r => r.name === m.rule.name)` per firing; replaced
  with a `Map` built once per table.

### What learned

The library's `MatchResult` carries the matched node. Typed does not need it (it already has `v`), but it is what
makes a guard that reads an attribute of the matched term possible — Tix's `singleDimAxis` needs exactly that, and
Typed's guards are all about bound subterms.

### What warrants a second pair of eyes

`builderFor`'s `{ ...root, ...own(attrs) }` — the order matters (the old code wrote `{ ...prov, type }`), and a
future attr called `because` would shadow a rule's `because`. Also, `valueHandle(tx.st, id)` allocates one handle per
made node where the old code passed ids around; the decision point measured that (step 7).

### Code review instructions

`src/typed/rules/compile.ts` beside `git show e01f5cb:src/typed/rules/compile.ts`. Confirm the visit order
(children first, left to right) and that provenance lands on the root only.

## Step 4 — Typed's verifier on the library's interface

### What I did

Methods 5 (`exhaustive-w8`) and 6 (`random-32`/`f32-special`) of `src/typed/rules/verify.ts` now call the library's
`verifyRule` through a local `onCases` adapter: Typed supplies the case generator (its domains, its boundary
crossing, its seeded draws) and the semantics (both sides compiled by `compileSide` at the method's width,
`agreeOutcome`'s comparison), and the library owns the guard filter, the case count and the first disagreement. The
counterexample is translated back into Typed's evidence shape (`method`, `width`, numeric outcomes or `'trap'`).
Methods 1–4 (structural, by-construction, symbolic-linear, bitwise-w1) and 7 (`exhaustive-32`) stay in Typed.

### Why

Brief item 2's second half. `exhaustive-32` stays because its complete enumeration runs a fused loop over one full
32-bit variable and counts cases by arithmetic; the library's case-by-case interface would yield 2^32 assignments.

### What worked

`tests/typed/rules.test.mjs` and `tests/typed/guards.test.mjs` pass unchanged, including the assertions that pin
counterexample *identity* (`div-pow2-shr`'s negative `x`, `fsub-self`'s `0x7fc00000`, `not-flt`'s method
`f32-special`, `fadd-neg-zero`'s NaN payload). The enumeration order is therefore unchanged, which was the risk.

### What didn't work

First version put the library call in a module-level helper that wrote the enclosing function's `counter` variable.
TypeScript said `Cannot find name 'counter'`. Fixed by returning `{ result, counterexample? }` and assigning at the
call site.

### What I learned

The evidence a test pins is not the loop, it is the *order* of the generated cases. Moving the loop is safe only
because Typed kept its generators.

### What warrants a second pair of eyes

Whether `exhaustive-w8` should have stayed in Typed too: it is now a one-line generator handed to the library, which
is the shape the library is for. `exhaustive-32` is the odd one out, and the report says why.

### Code review instructions

`src/typed/rules/verify.ts`, the `onCases` helper and the two call sites; compare with `git show e01f5cb:…`.

## Step 5 — Tix on the library: `src/tensor/rules.ts`

### What I did

New `src/tensor/rules.ts`:

- `exprSignature`: an `Expr` as a term. Labels carry attributes a pattern cannot reach (`load:f/a/2`, `reduce:sum`,
  `op:+/2`, `literal:2`, `shape:N`); `args` are an operator's operands and a reduction's body (an axis is a binder,
  not a child); `constant` is a literal's number.
- `splitSumRule`: `reduce:sum(body)` under the guard `singleDimAxis` (read off the matched node, which is why the
  library passes it to the guard), replaced by a `build` template that makes the nested blocks-and-tail reduction.
- `inlineRule(producer)`: `load:<name>/<arity>` (a leaf) replaced by a `build` template that substitutes the
  producer's axes by the reader's indices. Its side condition (pointwise, read once) is a statement-list fact the
  pass checks before building the rule.
- `rewriteExpr`/`rewriteFn`: `mapExpr` (the domain's walk, bottom-up, replacement not revisited) with the library's
  `firstMatch` + `instantiate`.
- A `Builder<Expr>` whose two hooks throw with a message: a Tix label is not readable back into an expression (a
  read's indices and a reduction's axes are not in it), so every Tix rule template is a `build`.

`src/tensor/passes.ts` now calls those: `inline` uses `rewriteExpr(s.expr, indexOf([inlineRule(p)]))` and `split`
uses `rewriteFn(fn, indexOf([splitSumRule]))`; the two hand-written `mapExpr` bodies are gone.

### Why

Brief item 3.

### What worked

Every Tix corpus program keeps the exact revision the baselines record (my test compares against
`various/baselines/main.json`), and `node --test tests/tensor/passes.test.mjs tests/tensor/r3-tix-in-plans.test.mjs`
passes.

### What didn't work

A first test program was `fn f(x:f32[N]):f32[N]{s=sum(j) x[j];…}` — the Tix parser refuses a statement with no
axes (`1:24 Expected [`, from `dist/tensor/parser.js`). A statement always has axes, so the test uses
`s[i]=sum(j) x[i,j]`.

### What I learned

Two of the three things a rule needs are domain facts, not library facts: the guard reads the *node*, and the
template reads the *binders*. The library's two hooks (`MatchResult.node`, `Template.build`) are exactly those two
seams.

### What warrants a second pair of eyes

That `split-sum`'s guard is in the rule's data (`where: [{ singleDimAxis: true }]`) but `inline`'s side condition is
not (`where` absent): the first is a property of the matched term, the second of the statement list. That asymmetry
is intended; say if it should be stated differently.

### Code review instructions

`src/tensor/rules.ts` beside `git show e01f5cb:src/tensor/passes.ts`; confirm `splitBody` and `replaceIndices` are
the same constructions as before.

## Step 6 — F40: the merged statement's correspondence entry

### What I did

`inlinePass.prepare` now returns correspondence **entries** instead of a derivation: one per merge,
`{ from: ['f/a'], to: ['f/b'], relation: 'merged' }`, resolved to the final survivor of a chain (`mergeEntries`).
`mergedInto` answers from a correspondence's `merged` entries (or, unchanged, from a derivation's `merged` steps).
Updated the test that pinned the old `removed` entry
(`tests/typed/derivations.test.mjs`: "Tix inline says `merged` for the statement it substituted, and names the reader
it went into (F40)"), and added the same assertions to `tests/stdlib/term.test.mjs`, with a chain case
(`f/a → f/c`, `f/b → f/c`) and the negative case (an entry naming a statement the module has not is refused:
`/Unknown source entity f\/zz/`).

### Why

F40. Step 1's finding 1 says the framework cannot produce that entry from a derivation, and a native result carries
one source of correspondence only. The information the derivation carried — which reader absorbed which producer —
is now in the correspondence, where `traceEntity`/`whyEntity` find it.

### What worked

`tests/framework/derivation.test.mjs` still passes (the framework's own behaviour is untouched), the F35 correspondence
test in `r3-defects.test.mjs` passes, and the baselines are unchanged: a correspondence is not part of a revision.

### What didn't work

The old test failed as expected — `TypeError: Cannot read properties of undefined (reading 'steps')` at
`tests/typed/derivations.test.mjs:187` — because `r.derivation` no longer exists for `inline`. That is the update the
brief allows; the test now asserts the entry.

### What I learned

A `merged` step whose target already exists in the input is exactly the case `correspondenceFromDerivation` discards
("a step that carries its entities changes no identity"). The framework's rule is defensible for survival, but it
means "merged" can only come from the domain. That is a framework gap for lane F41 to consider, not a Tix bug.

### What warrants a second pair of eyes

Tix now has no derivation at all (`inline`'s merge link is the correspondence). If K2 coverage of the Tix domain
matters more than a truthful entry, the trade should be revisited in `ir/derivation.ts` (F41's file).

### Code review instructions

`src/tensor/passes.ts` (`mergeEntries`, `inlinePass.prepare`, `mergedInto`) and the two tests named above.

## Step 7 — The decision point: measure the rule path against the pre-change matcher

### What I did

Wrote `scripts/01-rule-path-measurement.mjs` and ran it (output in `scripts/01-rule-path-measurement.output.txt`).
It holds a verbatim copy of the pre-change `compile.ts` matcher (`matchPat`, `instantiate`, `indexRules`,
`firstMatch`, `compileRules`) as a second set of pass bodies over the same specs, runs both paths on the r0 revision
of all 50 corpus projects (fold, simplify, identities, each under its meaning contract, fresh analysis manager), 3
rounds, the order alternating per round and per project, minimum per project; and times the whole O2 pipeline on the
library's path as the denominator. It also checks that both paths compute the same revision.

### Why

The brief's decision point, with its threshold: more than about 10 % of O2 compile time withdraws the Typed port.

### What worked

```
corpus: 50 Typed projects, O2; 3 interleaved rounds, minimum per project
  rule passes (fold, simplify, identities), today's matcher      1665 ms
  rule passes, the library (stdlib/term)                         1625 ms
  difference                                                      -40 ms  (-2.4 % of the rule passes)
  O2 compile time, whole pipeline                               14100 ms
  difference as a share of O2 compile time                    -0.28 %
  the two paths give the same revision on 50/50 projects
```

The library path is **not slower**: −0.28 % of O2 compile time, well inside the threshold. Decision: Typed keeps the
library matcher and instantiator (the port stands). A second run without the revision check gave the same answer
(−0.10 % of O2), so the conclusion does not depend on that overhead. Two runs also show the machine's own variation
(O2 total 18.9 s vs 14.1 s between runs), which is why the number to read is the share, not the absolute.

### What didn't work

- First run of `node --test tests/tensor/*.test.mjs` — the glob matched the five `*-gpu.test.mjs` files and they ran
  (74 tests: 51 domain tests + 23 GPU ones). My brief says not to run them; this was a mistake, it happened once, and
  they passed. Afterwards I ran `ls tests/tensor/*.test.mjs | grep -v -- -gpu` explicitly (51 tests).
- The script's paths: as a file under `ttmp/…/scripts/`, `../../../tools/…` was wrong; it now resolves everything
  from `process.cwd()` (run it from the worktree root) through `pathToFileURL`.

### What I learned

The rule passes are ~11 % of O2 compile time in total and the matcher is a small part of them: the transaction
(`tx.make`, the store, the derivation steps) dominates. So the library's two extra allocations per made node (a Map
for bindings, a `ValueHandle` per node) do not show.

### What warrants a second pair of eyes

Whether measuring through `applyTransformationSync` (which includes the meaning contract, ~89 % of the rule passes'
time) is the right shape. The contract cost is identical on both paths, so the *difference* is clean; the share is
taken against O2's total, which also includes it.

### Code review instructions

`scripts/01-rule-path-measurement.mjs`: check that the copied matcher is the pre-change one (`git show
e01f5cb:src/typed/rules/compile.ts`) and that the two paths really compute the same revisions (the script prints it).

## Step 8 — Acceptance run, report, and what I would tell a reviewer

### What I did

Ran every acceptance check on the working tree and wrote the report (`reference/02-report.md`), this ticket's tasks
and changelog, and the index summary. Prettier on the seven files I touched that were formatted before (the seven
files `npm run format:check` still reports were unformatted at `e01f5cb` and are nobody's here), then
`node tools/build-site.mjs`.

The numbers, all on the last commit: my 9 tests in `tests/stdlib/term.test.mjs` pass; the baselines print
`no differences` (run twice, once after the last code change); `tests/typed` 193 pass / 0 fail / 2 pre-existing skips,
`tests/framework` 266 / 0, `tests/workbench` 24 / 0 / 1 pre-existing skip, `tests/stdlib` 70 / 0, `tests/tensor`
without `*-gpu` 51 / 0; `npm run check` clean; the site builds.

### Why

The brief's acceptance list is judged on the last commit, so it has to be run on the last commit — and the baselines
after the last change to `src/`, not an earlier one.

### What worked

Everything above, and in particular `tests/typed/derivations.test.mjs`'s 183-rule-citing-record test, which is the
sharpest check that the Typed port changed nothing observable.

### What didn't work

Nothing new. The one mistake of the session is recorded in step 7: a glob (`tests/tensor/*.test.mjs`) matched the five
`*-gpu.test.mjs` files and ran them once. The brief says not to; I re-ran only the 51 non-GPU tests afterwards.

### What I learned

That the baselines take two minutes and the whole typed suite two and a half, so running both after every change is
affordable — which is how I caught that the Typed port really did keep the images identical before building on it.

### What was tricky

The `merged` entry, and only that. Everything else had a single obvious shape once the two hooks (`MatchResult.node`
for a guard, `Template.build` for a binder) existed.

### What warrants a second pair of eyes

1. F40's trade (a truthful correspondence entry for Tix's derivation; the brief's literal instruction is impossible
   in this framework — report's "Answers to the lane's open questions").
2. `builderFor` in `src/typed/rules/compile.ts`: provenance on the replacement root only, and `attrs` spread after it.
3. Whether the library should have a traversal (I argue no, one client).
4. The measurement's shape: the meaning contract is ~89 % of the rule passes' time and identical on both paths, so the
   *difference* is clean but the absolute rule-pass times are diluted.

### Code review instructions

Read `reference/02-report.md` first, then in this order: `src/stdlib/term/pattern.ts`, `src/stdlib/term/rules.ts`,
`src/typed/rules/compile.ts` (beside `git show e01f5cb:src/typed/rules/compile.ts`), `src/tensor/rules.ts`,
`src/tensor/passes.ts`, `tests/stdlib/term.test.mjs`. Then run, in the worktree root: `npm run build`,
`node --test tests/stdlib/term.test.mjs`, and the baselines script. The whole diff is 12 files,
+1232/−237 (`git diff --stat e01f5cb -- src tests`).
