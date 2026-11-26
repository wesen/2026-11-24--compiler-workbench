---
Title: 'Intern guide: exact checking for edits that cite verified rules, and version 2 of the meaning check for new pipelines'
Ticket: IRWB-008
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: baselineKey, subjectKey and the memo that semantic part keys extend
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass passes input, origin and output to the contract, not the edit report
    - Path: repo://src/typed/evaluate.ts
      Note: meaningKept, version 1 of the check (frozen)
    - Path: repo://src/typed/parts.ts
      Note: closureKey, to gain semanticKey and semanticClosureKey
    - Path: repo://src/typed/rules/compile.ts
      Note: compileRules and evalOp; the validator re-implements matching but shares evalOp
    - Path: repo://src/typed/rules/verify.ts
      Note: 'verifyRule and Strength: the evidence an exact acceptance relies on'
    - Path: repo://src/typed/tx.ts
      Note: Tx.rewrite records one replace edit per field; where citations would be collected
ExternalSources: []
Summary: 'For a new intern: how a pass application is accepted today (revisions and frozen hashes, Tx and provenance, correspondence, the sampled meaning check and its memo, version 2 of the check, the verified rule tables, the mutation measurements), corpus and Candela measurements showing that every simplify and fold edit can be re-derived exactly from its before-tree and the rule data (394 of 394, 838 of 838), and the design that follows: an edit validator, regional obligations through semantic part keys, an evidence-strength order, rule-citing pass variants, a version 3 contract that samples only the residual with version 2, which pipelines adopt it, risks, falsification criteria and a phased plan.'
LastUpdated: 2026-11-26T11:30:00-05:00
WhatFor: Onboarding for IRWB-008 and the reference for its implementation.
WhenToUse: Before changing how a pass application is checked, adding a contract version, adding passes that apply verified rules, or choosing the contract of a new pipeline.
---

# Intern guide: exact checking for edits that cite verified rules, and version 2 of the meaning check for new pipelines

Every optimization in this compiler is accepted by one gate. The new revision of the program is run on a few dozen generated inputs per function and compared with the original program; if every comparison agrees, the revision is published. The gate is sampled, and milestone IRWB-005 measured what sampling misses. It made 1,144 deliberately broken variants of the corpus programs, one small change each, and showed 952 of them to be wrong on some input the project allows. The default gate accepted 43 of those 952, so it misses at least 4.5 % of such faults. It also accepts a float rewrite that is wrong only for NaNs with a non-canonical payload. A stronger version of the check, version 2, accepts 5 of the 43.

At the same time, milestone IRWB-006 turned the identities of `simplify` and the cases of `fold` into tables of rules and verified every rule once, for every input of its types, with recorded evidence. A program produced by applying those rules is correct whatever inputs the gate happens to sample, and checking that a program *was* produced that way is cheap. This guide designs the work that connects the two results:

- an **edit validator** that accepts the edits made by verified rules exactly, by re-deriving each changed expression from its old form and the rule data, with no generated input at all;
- a **regional obligation**: what the validator cannot derive is the **residual**, and only the inputs that can reach the residual are run, under version 2 of the sampled check;
- an **evidence-strength order** that says, for each revision, how strong the weakest evidence it relied on is;
- **pass variants** that cite the rules they applied in the program's provenance, alongside the frozen O2 pipeline rather than inside it;
- a **contract version** that combines the exact part and the sampled residual, and a rule for which pipelines use which contract.

Two measurements made for this guide carry the argument. Every one of the 1,232 edits that `simplify` and `fold` made on the corpus pipelines and on Candela's O2 could be re-derived exactly from its before-tree and the rule tables, by a matcher written independently of the passes (sections 11–12). Re-deriving all 838 such edits on Candela took 22 ms, where the sampled checks of the same three pass applications took 6.2 s (section 14). The same measurements also set the limit of the idea: those edits are 59.8 % of the expression-level edits on the corpus but only 18.6 % of all edits, because most of what `cfg`, `dce`, `licm` and `subst` do is structural.

## How to read this guide

Part 1 explains the parts of the system the design touches, from the code; read it in order, since each section uses the terms of the one before. Part 2 presents the measurements made for this guide. Part 3 is the design. Part 4 covers risks, what would falsify the approach, future work and related work. Part 5 is the implementation plan with its acceptance measurements.

Four conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `a4beda6`, the base of this ticket. Line numbers drift; the symbol named next to them does not.
- **IRWB-005 is not in this ticket's base.** It was merged into `irwb-001/import-v6-prototype` after `a4beda6`. Its code and evidence are cited at its final head, `bff08a6`, and its files are marked "(IRWB-005)". They were read, not run. Its source did not change between `d9cf4e9`, where this guide's reading started, and `bff08a6`; its final measurements did, and the guide uses the final ones.
- **Part 1 describes code that exists.** Interfaces that do not exist yet are marked **Proposed**; their names are the ones the implementation is expected to use, but an implementer may refine them.
- **Every number has a source:** a script of this ticket with its output in `various/`, a test, or a diary step of another ticket with its commit.

The whole proposal in one picture, explained in Part 3:

```text
   r(k-1) ────────────── pass ──────────────► r(k)          (both revisions, hashed)
      │                                         │
      └──────────► deriveRevision(r(k-1), r(k), verified rule tables)          Proposed
                        │                                  │
          every change of f re-derived         some change of f not re-derived
                   "derived"                              "residual"
                        │                                  │
     f's semantic key := the key of f in r(k-1)    cases that can reach f are run
     (no case reaching only such functions         by the sampled check, version 2
      needs to run again)                                  │
                        └────────────────┬─────────────────┘
                                         ▼
            contract typed.optimization, version 3 (Proposed): accepted or rejected;
            evidence: derivations, the residual's sampled counts, the weakest strength
```

# Part 1: The system as it is

## 1. The compiler in one page

The project compiles **Typed**, a statically typed subset of JavaScript, to **RV32** machine code. A vendored front end parses and type-checks the source; `src/typed/lift.ts` lifts its stack-machine output into the main intermediate representation, `typed.blocks`: a control-flow graph whose statements hold expression trees. Optimization passes turn one revision of the program into the next, and the backend (`src/typed/backend/`) lowers the last revision to an image of machine code.

```text
 main.typed ──front end──► tape ──lift──► typed.blocks r0
                                              │ pass ──► r1 ──► r2 ──► … ──► rN
                                              │        each checked against r0
                                              ▼
                                         rv32.image  (machine code)
```

Two workloads exercise the compiler. The **corpus** (`corpus/projects/`) has 44 small projects with 70 functions; a book inherited from the prototype states exact numbers for them, and those numbers are tests. **Candela** (`corpus/candela-gallery/`) is a path tracer of 332 functions with single-precision floats throughout; its r0 revision is `cd36346e…` and O2 takes it to `b33d1737…` in 13 changed revisions.

Four facts about `typed.blocks` matter here (`src/typed/model.ts`).

- A **statement** `s:f.N` is one of eight operations (`set`, `store`, `eval`, `br`, `br_if`, `return`, `trap`, `zero`) and refers to its expression trees through the fields `value`, `cond` and `addr` (`StmtRec`, `model.ts:148`).
- A **value** `v:f.N` is one node of an expression tree: an operator `op`, operand ids `args`, an optional immediate `imm` and an optional `type: 'f32'` (`ValueRec`, `model.ts:168`). **A value has exactly one user**, so trees are never shared and rewriting one tree changes nothing outside it.
- **Locals are mutable variables.** A `get` reads a local by index; a `set` writes one.
- **Ids come from counters stored in the program value** (`TypedBlocks.counters`, `model.ts:199`), so a pass run twice on the same revision allocates the same ids.

## 2. Revisions, frozen hashes, and what lies outside the hash

Every program the compiler produces is an immutable **artifact** (`Artifact`, `src/framework/core/types.ts:10`) whose **revision** is the SHA-256 of a canonical encoding of its kind, schema version and value (`canonical`, `src/framework/core/data.ts:67`; `fingerprint`, `:195`; `createIRArtifact`, `src/framework/ir/adapters.ts:128`). Two artifacts with equal content have equal revisions, so a revision names the program itself, and anything computed from a revision can be cached under it forever.

What exactly is inside the hash decides what this design may change. The value of a `typed.blocks` revision is `TypedBlocks` (`model.ts:199`):

| inside the revision hash | outside it |
|---|---|
| `fns`, `blocks`, `stmts`, `values`, `ops`, `frontEnd` | the pass's edit list (`report.edits`) |
| every record's `origin` array (provenance, section 4) | the correspondence between two revisions |
| `counters` (the id allocators) and `rev` | the contract's evidence (cases, verdicts) |
| | `Program`'s `Revision` record (`program.ts:54`): pass name, time, assumptions |

The consequence is the blocker this design works around. Anything written into an `origin` (for example the name of the rule that made a value) changes the revision hash of every revision from that pass on. Anything written into the edit list or the correspondence does not.

**Why O2 is frozen.** The standard pipeline `O2` (`PIPELINES`, `src/typed/passes.ts:1046`) reproduces the book: its revisions, statement counts, image sizes, instruction counts and the `why` trees of particular statements, node for node. IRWB-006 defined "frozen" as four commands whose results must not change (IRWB-006 guide §5): `npm test`; `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs`; `node tools/parity.mjs` (44 projects, 7,000 cases, 6,986 decided and agreeing, 14 at the step limit); and `ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs`, every project's r0, O2 revisions and O2 image as 12-digit hashes, diffed against a recorded baseline. IRWB-005 adds that the default contract is frozen too: its case generator, count, seed, verdict rules, version string and every decision it makes on the corpus and on Candela (IRWB-005 guide §18). New behaviour therefore goes into new passes and new pipelines.

A **revision number** (r0, r3) is something else: the position of a revision in one program's history, kept in the `Program` class (`src/typed/program.ts`), whose `revisions` array holds one `Revision` record per pass application that changed the program.

## 3. Passes, the transaction, and edit records

A Typed pass is written with `typedPass(spec)` (`passes.ts:166`). A spec names the pass, the analyses it reads, the kinds of thing it writes (`values`, `stmts`, `locals`, `cfg`), the analyses it claims to preserve, and a `body`. The wrapper's `run` makes a mutable working copy of the input, and for every function builds a **transaction** `Tx` (`src/typed/tx.ts:165`), calls the body, and commits. If anything changed, it returns the new native value, a correspondence (section 4) and a `RevisionReport` (`passes.ts:93`) with the edits and the functions touched.

The body never edits tables directly. Every change goes through a `Tx` method, and every method appends an **edit record** (`Edit`, `tx.ts:47`; `Tx.record`, `tx.ts:202`): `{ id, rev, pass, fn, kind, … }`. The kinds that occur, with the passes that make them on the corpus pipelines (measured in section 11):

| kind | meaning | made by |
|---|---|---|
| `replace` | one statement field (`value`, `cond`, `addr`) now holds a different tree | `fold`, `simplify`, `constprop`, `sccp`, `strength`, `licm`, `lvn`, `subst` |
| `remove` | a statement was deleted (with a required `because`) | `dce`, `subst`, `cfg` |
| `insert`, `local`, `block` | a statement, a local or a block was created | `licm`, `lvn` |
| `retarget`, `unreachable`, `move`, `merge`, `replaceStmt` | control flow changed | `cfg`, `bce`, `licm` |

The method that matters most here is `Tx.rewrite(visit, blocks?, opts?)` (`tx.ts:431`). `simplify`, `fold` and `strength` are each one call to it, and `constprop` calls it once per block:

```text
Tx.rewrite(visit):                                                  tx.ts:431–480
  for each block b, each statement s of b, each field k in [value, cond, addr]:
      n <- walk(s[k])
      if n != s[k]:  record { kind: 'replace', stmt: s, field: k, from: s[k], to: n, text }
                     s[k] <- n
  walk(vid):                                            bottom-up
      args <- [walk(a) for a in vid.args]
      cur  <- vid
      if some argument changed:
          cur <- a fresh copy of vid with the new args
                 origin { from: vid, via: pass, note: 'rebuilt around a changed argument' }
      r <- visit(handle(cur))                           the pass decides
      return r ?? cur                                   r is NOT walked again
```

Three properties of this procedure shape the design.

1. **One edit per statement field.** A `replace` edit records only the old root and the new root of the field. Several rules can fire inside one tree; the edit does not list them.
2. **The replacement is not visited again.** If `visit` returns a new tree, the walk moves on to the parent. A checker that re-derives the result must stop at the same point.
3. **Intermediate trees disappear.** The rebuilt copy of a parent exists only in the working copy; if a rule then replaces it, neither the copy nor anything made for it appears in the output revision.

## 4. Provenance: origins, `because`, `why`, and correspondence

Every statement, value, block and function carries `origin: Origin[]` (`Origin`, `model.ts:103`), written by the transaction (`Tx.origin`, `tx.ts:187`):

```ts
export interface Origin {
  from: string;                    // the entity it was made from
  via: string;                     // the pass that made it
  kind: 'recorded' | 'derived' | 'made';
  rev?: number;                    // the revision it was made at
  because?: string[];              // entities or facts that make the change valid
  note?: string;                   // a sentence
}
```

`because` holds entity ids or free strings. `strength` writes a fact reference such as `fact:ranges(peak)@r5: x in [0, 40]`; `constprop` writes the ids of the `set` statements whose constant it propagated. `Program.why(id)` (`program.ts:457`) follows `origin[0].from` and each `because` entry recursively and prints a tree; an entry that is not an entity is printed as text.

The framework keeps a second record of the same information. `revisionCorrespondence(before, after, edits)` (`passes.ts:117`) groups every new entity under its origin's `from` and every removal under its statement, producing `CorrespondenceEntry` records `{ from: [ids], to: [ids], relation, because?, note? }`. `applyPass` completes them into a total relation between the two revisions' entities (`makeCorrespondence`, `src/framework/ir/correspondence.ts:102`), and `Program.whyChain` (`program.ts:484`) walks chains of them with `whyEntity` (`correspondence.ts:306`).

Here is the running example of this guide, Blend's first `simplify` edit under O2, as printed by `scripts/04-blend-worked-example.mjs` (output `various/06-blend-worked-example.txt`):

```text
edit {"id":"edit:r3.0","pass":"simplify","kind":"replace","stmt":"s:blend.4","field":"cond",
      "from":"v:blend.8","to":"v:blend.35","text":"(i >= n)"}
  before eqz(lt(get#6, get#1))                         !(i < n)
  after  ge(get#6, get#1)                              i >= n
  new root v:blend.35 origin {"from":"v:blend.8","via":"simplify","rev":3,"because":[],
                              "note":"!(<) is >="}
  correspondence {"from":["v:blend.8"],"to":["v:blend.35"],"relation":"simplify",
                  "note":"!(<) is >="}
```

Locals 6 and 1 of `blend` are `i` and `n`. Notice what the provenance says and what it does not: the new value was made from `v:blend.8` by `simplify`, with a note. It does not say which rule. The rule is `not-lt`, and nothing in the revision, the edit or the correspondence names it.

Sometimes the provenance says even less. In the `algebra` project (`various/07-algebra-worked-example.txt`), `simplify` rewrites one statement's value from `add(add(add(a, b), z), sub(x, x))` to `add(add(a, b), z)`. Two rules fired: `sub-self` turned `sub(x, x)` into a new constant 0, then `add-zero` turned the rebuilt `add(…, 0)` into its left operand, an existing value. The constant and the rebuilt parent exist in neither revision (property 3 of section 3), so the correspondence entry of the old root is `{ from: [v:tidy.21], relation: removed, to: [] }`, with no reason at all.

## 5. `applyPass`: the stages every pass goes through

The framework applies a pass with `applyPass(pass, before, options)` (`src/framework/passes/define-pass.ts:190`). Nothing is published unless every stage succeeds:

```text
applyPass(pass, before, { manager, contract, contractInputs: { origin: r0 } }):
  facts   <- the analyses the pass needs, for `before` (cached per revision)
  result  <- pass.run(...)                                      the body, once per function
  after   <- createIRArtifact(adapter, id, result.native)       validate, freeze, hash
  changes <- diff(projection(before), projection(after))
  if nothing changed:                         return { changed: false }
  if changes touch kinds outside pass.writes: throw PassError('undeclaredWrite')
  corr    <- makeCorrespondence(before, after, result.correspondence)
  manager.verifyTransformation({ input: before, ...contractInputs },          :279
                               { output: after }, contract, [semanticCorrespondence(corr)])
      on failure:                             throw PassError('contractRejected')
  for each analysis the pass claims to preserve: check it      PassError('preserveViolated')
  return { changed: true, artifact: after, changes, correspondence: corr, report, contract }
```

Two details matter for this design.

- **The contract sees revisions, not edits.** Its inputs are `input` (the revision before the pass), whatever the caller adds (`origin`, r0), and `output`. The pass's `report` is returned to the caller but is not an input of the contract. `semanticCorrespondence` (`define-pass.ts:170`) passes the correspondence as `{ from, to }` pairs and drops `because` and `note`.
- **The caller chooses the contract.** `Program.apply` (`program.ts:248`) builds `optimizationContract({ inputs, count: 40, seed: 7, roots? })` for every pass. A different contract is a different argument to `applyPass`, which is how IRWB-005 opts into version 2 without touching the default.

## 6. The meaning contract, version 1

A **contract** is a set of conditions on a transformation's inputs and outputs, verified by the `AnalysisManager`. `optimizationContract(params)` (`passes.ts:222`) has one condition: it ensures the invariant `meaningKept(params)` with `origin` bound to r0 and `candidate` bound to the output. The comparison is always with r0, never with the previous revision, so differences cannot accumulate across passes.

`meaningKept` (`src/typed/evaluate.ts:587`) is an instance of the framework's **differential** invariant (`differential(spec)`, `src/framework/contracts/differential.ts:98`). A differential spec (`DifferentialSpec`, `differential.ts:31`) says how to generate cases, how to run one side on one case, how to compare two outcomes, and when an outcome is inconclusive:

```text
runDifferential(spec, { origin, candidate }):                      differential.ts:273
  cases <- spec.cases(...)            meaningKept: casesFrom per function, 40 each, seed 7
  for each case c:
      a <- run(origin, c);  b <- run(candidate, c)                 the evaluator, both sides
      if inconclusive(a) or inconclusive(b):  inconclusive++       a step limit was hit
      else if agrees(a, b):  agree++   else  disagree++  (keep 5 counterexamples)
  status <- disagree > 0 ? 'disagree' : agree > 0 ? 'agree' : 'inconclusive'
  the invariant holds iff status = 'agree'
```

A **case** is one call: a function, arguments and an initial memory image (`casesFrom`, `evaluate.ts:232`). `agrees` (`evaluate.ts:554`) is the verdict for one case: a trap agrees with any trap; otherwise results and the written memory must be equal. Three rules follow from the procedure: one disagreeing case rejects; a case at the step limit decides nothing; a check with no decided case rejects.

The parameters (`MeaningParams`, `evaluate.ts:562`: `count` 40, `seed` 7, the project's `inputs`, `limit` 2e4, optional `roots`) are hashed into the invariant's version string: `1+<hash>`. That string is the check's identity: two checks with the same version are the same check, and `optimizationContract` gives the transformation contract `typed.optimization` the same version. The evidence (`DifferentialEvidence`, `differential.ts:82`) records `method: 'sampled'`, and `assuranceOf(evidence)` (`differential.ts:325`) maps it to `'checked-sampled'`. No Typed check produces `'checked-exact'` today (IRWB-002 guide, item D3).

## 7. The memo: what IRWB-004 stopped re-running

Before IRWB-004, every check evaluated every case on both sides. IRWB-004's item D1 added a memo to `differential` with two optional keys in the spec (`differential.ts:57`, `:63`):

- **`baselineKey(inputs)`**: a key such that the cases and the baseline's outcome on each are a function of the spec and the key alone. `meaningKept` uses the origin's revision. Cases and r0's outcomes are therefore computed once per program.
- **`subjectKey(candidate, case)`**: a key such that the candidate's outcome on a case is a function of the case and the key alone. `meaningKept` uses `closureKey(candidate.value, case.fn)` (`src/typed/parts.ts:241`): a SHA-256 over the **function parts** (one function's records, `partsOf`, `parts.ts:43`) of every function the case's function can reach by calls, and of whether the program has frame arrays.

A decided verdict is kept under `"<case index>\0<subject key>"` inside an entry keyed by `typed.meaning-kept@<version>#<seed>#<count>#<baseline key>` (`prepare`, `differential.ts:166`; `memoKeys`, `:254`). At most four such entries are kept (`REUSE_MAX`, `:151`). A later check replays a verdict instead of evaluating the case when the candidate's closure key for that case is the one it was decided under:

```text
 check of r(k) against r0, case i of function g:
     key <- closureKey(r(k), g)             hash of g and everything g calls
     if memo[i, key] exists:  replay it     g's closure did not change since it was decided
     else:                    run r(k) on case i, compare with r0's stored outcome, store
```

The soundness of a replay rests on one claim, which IRWB-004's diary flags for review: the evaluator's outcome for a case depends only on the case, the step limit and the records reachable through calls (IRWB-004 step 8). On Candela's O2 the memo replays 108,600 of 172,640 case verdicts (63 %), leaving 64,040 subject runs and 13,280 runs of r0 (IRWB-004 step 10; reproduced in section 14). Replay is the mechanism Part 3 extends: a function whose change has been proved harmless should be treated, for this purpose, as unchanged.

## 8. Version 2 of the meaning check (IRWB-005)

IRWB-005 kept the default frozen and wrote a second version beside it (`src/typed/cases-strong.ts` (IRWB-005): `meaningKeptStrong`, `:369`; `strongOptimizationContract`, `:468`). It has the same id, `typed.meaning-kept`, and differs in four ways.

- **More telling cases.** `strongCasesFrom` (`:329`) returns the 40 default cases unchanged, then `extra` (default 40) **boundary cases** built from pools per parameter: the boundaries of the input specification, the special values of the type (for f32: `F32_EDGES` plus thirteen patterns in `F32_EXTRA`, `:49`, among them a negative quiet NaN and a signalling NaN), and the function's own constants `c − 1, c, c + 1`. Because the default cases come first, every disagreement version 1 finds, version 2 finds too.
- **A divergence rule.** Version 1 counts a case where either side hits the step limit as no verdict, so a candidate that loops forever on some inputs is accepted if the others agree. Version 2 re-runs a candidate that hit the limit at ten times the limit; if it still has not finished while r0 finished, the case disagrees.
- **A layout fix.** The default generator writes a record's words in key order rather than offset order; for Candela's `K` record this scrambles the scene index and other fields in the cases of 168 of its 332 functions (IRWB-005 step 7). Version 2 lays records out by offset (`layout: 'offset'`).
- **Optional coverage-guided selection** of the extra cases (`coverage: true`).

Its version is `2+<hash>` of `{ generator: 'strong-1', count, extra, coverage, divergence, layout, seed, inputs, limit, roots? }`, and `strongOptimizationContract` wraps it as `typed.optimization` of the same version. Nothing calls it by default.

One property matters for cost: **version 2 sets no `baselineKey` and no `subjectKey`**, so it gets none of the memo's replays and evaluates every case on both sides at every check. IRWB-005 measured this on a nine-project sample after merging IRWB-004: the default gate became 2.7 times faster (27.8 s to 10.4 s for 396 mutants) and version 2 did not (IRWB-005 step 16). Its `run` already computes whether the origin finished when the baseline's outcome was replayed instead of run (step 15), which is what giving it keys requires.

## 9. Rules as verified data (IRWB-006)

A **rewrite rule** (`Rule`, `src/typed/rules/form.ts:58`) has a name, a version, a pattern (`lhs`), optional guards (`where`), a replacement template (`rhs`), and the `because`/`note` its outermost made value carries. Rules are frozen, JSON-serializable data:

```ts
rule('not-lt', { a: 'i32', b: 'i32' }, op('eqz', op('lt', v('a'), v('b'))), op('ge', v('a'), v('b')),
     { note: '!(<) is >=' })                                   // eqz(lt(a, b)) → ge(a, b)
rule('sub-self', { x: 'i32' }, op('sub', v('x'), same('x')), c(0),
     { where: [{ pure: 'x' }], because: 'const-args', note: 'x - x' })
```

The `simplify` table (`src/typed/rules/simplify.ts`) has 27 rules and the `fold` table (`src/typed/rules/fold.ts`) 40, one per foldable operator. `compileRules(rules)` (`src/typed/rules/compile.ts:119`) turns a table into a `Tx.rewrite` visitor: rules are indexed by their root operator and tried in table order, the first whose pattern matches (`matchPat`, `:24`) and whose guards hold (`guardHolds`, `:43`) is instantiated inside the visitor (`instantiate`, `:78`). The table passes reproduce the hand-written passes exactly, with identical revisions, edit lists and correspondences, at all 616 `simplify` and `fold` steps of the corpus pipelines and at every such step of Candela's O2 (IRWB-006 steps 4–5). Since commit `711a9a2`, `simplify` and `fold` in `passes.ts:263–286` are these tables.

**Verification.** `verifyRule(rule, opts)` (`src/typed/rules/verify.ts:179`) checks a rule once, for every assignment of values to its variables that satisfies its guards, against the evaluator's semantics (i32 operators at any width in `BIN`, `src/typed/rules/semantics.ts:35`; f32 operators on bits). It applies every method that fits and records each result; a counterexample from any method rejects the rule. The recorded **strength** is that of the strongest passing method:

| strength | method | what it establishes | rules |
|---|---|---|---|
| `proof` | symbolic linear normal forms over ℤ/2³²; or bitwise at width 1 | the rule for every 32-bit input | 15 of `simplify` |
| `exhaustive` | every input at 32 bits (2³² for one variable; small guarded domains) | the same, by enumeration | 4 (`div-one`, `shr-zero`, `shru-zero`, `not-not`) |
| `reduced-width+argument` | every input at 8 bits, a written argument that the law does not depend on the width, and 10⁶ random 32-bit assignments | complete at 8 bits, argued for 32 | 8 (the comparison inversions `not-lt` … `not-geu`) |
| `by-construction` | the replacement is the evaluator's own value of the matched operator; the guard is checked to exclude every trapping input | correct relative to the evaluator | all 40 of `fold` |
| `sampled` | boundary values crossed, then random | agreement on the samples | none in the tables |

The evidence is generated once (`ttmp/2026/11/25/IRWB-006--*/scripts/04-verify-rules.mjs`, 66.6 minutes with `{ random: 1e6, seed: 7, exhaustive32: true }`) into `src/typed/rules/evidence.ts` (`RULE_EVIDENCE`, `:10`). Each record names the rule's version and the **fingerprint** of its canonical data (`ruleFingerprint`, `verify.ts:87`), and `tests/typed/rules.test.mjs` fails when a rule no longer matches its record. Seven deliberately unsound candidates (`src/typed/rules/candidates.ts`), among them `x / 2^j → x >> j` and the four float rewrites wrong over IEEE, are rejected with counterexamples; one of them, `x + (−0) → x`, is wrong only for NaNs with a non-canonical payload and passes on the meaning check's own f32 edge values (`tests/typed/rules.test.mjs:138`).

What the evidence establishes is a claim about the *rule*. Nothing in the system yet uses it to accept an *edit*: every `simplify` and `fold` application is still accepted by sampling, exactly as before the rules existed.

## 10. What the mutation measurements say (IRWB-005)

IRWB-005 measured the gate by **mutation testing**: it manufactured wrong programs by changing one site of an accepted revision (a constant by one, a comparison flipped or weakened, operands swapped, a shift amount changed, a bounds check dropped or weakened, a trapping statement hoisted, an f32 operator or constant changed, a store dropped; `src/typed/mutate.ts` (IRWB-005)), judged each mutant with the gate exactly as a pass is judged, and classified every mutant a gate accepted as wrong or equivalent with a cascade of exhaustive, large-sample and unconstrained searches. The **kill rate** is killed / (killed + accepted wrong); its upper bound excludes mutants presumed equivalent.

The final numbers (IRWB-005 at `bff08a6`; the upper bound of the kill rate, with the number of wrong mutants the gate accepted in parentheses):

| workload | mutants | default gate (v1) | version 2 | source (IRWB-005 diary) |
|---|---:|---|---|---|
| corpus, pipeline heads | 1,144 (952 wrong) | 95.5 % (43) | 99.5 % (5) | step 20, after the deep search |
| corpus, r0 (held out) | 1,231 | 96.2 % (38) | 99.9 % (1) | step 12 (not deep-searched) |
| f32 fixture | 61 | 96.7 % (2) | 100 % (0) | step 10 |
| Candela, 18 functions | 3,931 | 96.8 % (114) | 97.2 % (100) | step 19, after the classification audit |

The lower bounds count every presumed-equivalent mutant as a miss: 83.1 % for the default gate on the corpus heads, and 87.4 % on Candela. On Candela, where the presumed equivalents were not deep-searched, IRWB-005 names the lower bound as the safer figure (step 19). The 100-case check reaches 98.1 % (upper) there.

What survives, and why, is the useful part:

- **On the corpus, divergence and single values.** 33 of the 43 wrong mutants the default accepts loop forever where the original terminates, 30 of them a loop increment `i + 1` turned into `i + 0` (IRWB-005 report §5). The divergence rule alone leaves 10 of the 43. Version 2 leaves 5. Two of them need a relation between two inputs or one particular intermediate value (step 8). The other three were found only by a deep search of 100,000 cases per function, and every gate configuration accepts them (step 20).
- **On Candela, regions of the input space.** Nearly all accepted wrong mutants are float mutants in shading and distance-field code, where a term matters only near a surface (step 18). On the two weakest functions, 400 random cases kill 180 of 242 non-equivalent mutants, version 2 kills 120, and the default 110 (step 21). Boundary values do not reach such a region; more points do.
- **NaN payloads.** `x + (−0) → x` written as a pass is accepted by version 1 (80 of 80 cases agree) and rejected by version 2 (2 of 160 disagree), because version 2's pool contains two non-canonical NaNs (step 14).
- **The facts passes act on hold.** `typed.ranges` claims were checked against executions on every revision of every corpus pipeline: 149,381,636 claim checks, no violation (step 13).

IRWB-005's report (§15) ends with five recommendations, each of which would change the contract's key and so its version string; all five are **undecided and the user's decision**:

1. lay records out by offset in `makeValue`, a correctness fix for the cases of 168 Candela functions;
2. count non-termination within ten times the limit as a disagreement;
3. append boundary cases from the specification and the program's constants;
4. add non-canonical NaNs to `F32_EDGES`;
5. raise the case count for float code, in addition to the others.

This guide does not depend on any of them being applied to version 1. Version 2 already contains the first three, and two of the fourth's three NaNs (the negative quiet NaN and the signalling NaN, not 0x7fc00001). The design adopts version 2 only for new pipelines.

Two consequences carry into the design. A sampled check, however tuned, has a measured miss rate that depends on the workload and on the kind of fault. And a fault class can be invisible to one case distribution entirely (NaN payloads under version 1), which no number of cases fixes. An edit that is accepted by an exact argument has neither problem.

What to carry into Part 2:

- A revision hash covers every origin; edit lists, correspondences and contract evidence are outside it.
- `Tx.rewrite` records one `replace` edit per statement field, with old and new roots; the rules that fired are not recorded, and intermediate trees disappear.
- The contract receives `input`, `origin` and `output`, not the edit report.
- The sampled check replays verdicts per closure key; version 2 has no keys yet.
- Every `simplify` and `fold` rule has evidence pinned by fingerprint, with one of four strengths.

# Part 2: Measurements for this design

The design rests on three questions the code cannot answer by reading: how much of what the pipelines change comes from rule tables, whether every such change can really be re-derived from the rules alone, and what the sampled check costs per pass. Four scripts in this ticket answer them; their outputs are in `various/`. All were run on this worktree's build of `a4beda6`.

| script | what it does | output |
|---|---|---|
| `scripts/01-edit-census-corpus.mjs` | all 44 projects through `O1`, `O2`, `O2+`, `loops`, `checks`, `O2-sccp`; per pass: edits by kind, entity changes, functions touched, pass time, sampled-check time and memo counters; re-derivation of every `simplify`/`fold` edit | `01-edit-census-corpus.{json,txt}`, with `--no-reuse`: `02-…` |
| `scripts/02-evidence-strength-by-firing.mjs` | recorded strength of every rule, weighted by firings | `03-evidence-strength-by-firing.txt` |
| `scripts/03-edit-census-candela.mjs` | measurement 01 on Candela's O2, under the 14 GB memory cap | `04-edit-census-candela.{json,log}`, `05-…-summary.txt` |
| `scripts/04-blend-worked-example.mjs` | one project's `simplify`/`fold` edits in detail | `06-blend-…`, `07-algebra-…` |

The scripts apply each pass with `applyPass` and no contract, then run the sampled check `meaningKept` with the default parameters on (r0, output) through `runDifferentialAsync` and time it apart. It is the invariant the gate runs, on the same ports, so its verdict is the gate's; splitting the two separates a pass's own cost from the gate's.

## 11. Where the edits come from

On the corpus (memo on; `various/01-edit-census-corpus.txt`; "apps" are pass applications, "chg" those that changed the program):

```text
pass        apps chg  edits  ent.chg  fns/tot   pass ms  check ms
cfg          660 193   1060      865  247/319      1467       255
fold         352  52     65      308    56/88       436        29
simplify     440 207    329     1234  259/313      1409       148
constprop    132  39     81      354    42/57       304        22
dce          352  63     86      182    67/97       434        35
licm         176  28    120      204    28/32       198        43
lvn          176  20     96      240    24/32       206        11
strength     132   3      3       30      3/6       284        11
bce          176  40    104      416    52/76       484        37
subst        352  69    146      830   73/106       645        58
sccp          44  13     28      132    14/19        86        14
```

On Candela's O2 (`various/05-edit-census-candela-summary.txt`; 332 functions):

```text
pass       chg  edits replace ent.chg  fns   pass ms  check ms  subj.runs replayed
cfg          1    974       0     882  110      8826     10390      13280        0
fold         1    676     676    3879  103      9156      2597       6920     6360
simplify     1     48      48     264   19      7699      1989       2720    10560
constprop    1    925     925    6548  124     11956      2580       6480     6800
fold         1    114     114    2008   53      7423      1612       3560     9720
dce          1   2164       0    4971  144     10386      2363       7080     6200
cfg          1     18       0       9    3      6708       908        480    12800
licm         1     87      19      97    8      7032      1921       1760    11520
lvn          1    256     128     918   38      7054      1687       5360     7920
subst        1    430     215    2400  160      8429      2459       8280     5000
subst        1    280     140    1570  132      7790      2226       7040     6240
dce          1      2       0       8    2     14488       899        600    12680
cfg          1     20       0      12    2      5987       737        480    12800
```

(`simplify` a second time, `strength` and `bce` change nothing on Candela and are not shown.) Read together, the two tables answer the first question in four ways, depending on what is counted:

| share that comes from `simplify` and `fold` | corpus | Candela O2 |
|---|---:|---:|
| of all edits | 394 of 2,118 (18.6 %) | 838 of 5,994 (14.0 %) |
| of changed entities (the diff of section 5) | 1,542 of 4,795 (32.2 %) | 6,151 of 23,566 (26.1 %) |
| of expression-level (`replace`) edits | 394 of 659 (59.8 %) | 838 of 2,265 (37.0 %) |
| of changed pass applications | 259 of 727 (35.6 %) | 3 of 13 |

The `replace` edits that are not rule-backed split into two groups. **Fact-backed substitutions** replace one value by another on the strength of an analysis fact: `constprop` and `sccp` replace a `get` by the constant all its reaching definitions assign, and `strength` replaces `x / 2^k` by `x >> k` where a range fact proves `x ≥ 0`. They are 112 edits on the corpus (17.0 % of `replace`) and 925 on Candela (40.8 %). The rest come with structural changes: `licm`, `lvn` and `subst` insert, remove or substitute whole statements and locals.

## 12. Every rule-backed edit is an instance of its table

The second question is whether "this edit is an application of verified rules" is checkable from the two revisions alone. The census scripts contain a prototype of the validator Part 3 proposes, written from the rule data and sharing no code with the passes' matcher. For each `replace` edit of `simplify` or `fold`, it takes the tree rooted at the edit's `from` in the input revision and the tree rooted at its `to` in the output revision, normalizes the first with the pass's table, and compares:

```text
normalize(t, table):                                  scripts/01-edit-census-corpus.mjs
    n <- t with every operand normalized first
    for each rule r of table whose root operator is n.op, in table order:
        if match(r.lhs, n, b) and every guard of r holds on b:
            fire(r);  return instantiate(r.rhs, b)     not normalized again (section 3, 2.)
    return n
re-derived  <=>  normalize(before-tree, table) is structurally equal to after-tree
                 (operator, immediate, type and operands, recursively; ids are ignored)
```

The matcher, the guards (`pure` as "no `call`, `load`, `load16u`, `div`, `rem`, `caddr` or `result` in the subtree", `pow2`, `boolean`, `noTrap`) and the instantiation are re-implemented in about 50 lines. Only the operator values come from the evaluator (`evalOp`, `compile.ts:53`, which calls `binop` and `f32Op`), because the evaluator is the specification.

| workload | `simplify` edits re-derived | `fold` edits re-derived | time re-deriving |
|---|---:|---:|---:|
| corpus, 6 pipelines × 44 projects | 329 of 329 | 65 of 65 | 10.8 ms |
| Candela O2 | 48 of 48 | 790 of 790 (676 + 114) | 22 ms |

The rules the re-derivation fires on Candela equal the firings IRWB-006 recorded from the compiled visitor (`ttmp/2026/11/25/IRWB-006--*/various/04-rules-equivalence-candela.json`) rule for rule, for example `fold-fmax` 83 + 202 = 285. On Candela that includes 1,145 folds of f32 operators.

Two things follow. The hypothesis "each such edit is an instance of the table" holds on every edit measured. And the check does not need the pass to say which rules it applied: normalizing with the table re-derives the output from the input. A reader will ask how the validator then knows which table to normalize with. It does not need to know: normalizing with any verified table is sound (section 17), so it can try each. Section 20 returns to what citations are then for.

## 13. Which evidence the edits rely on

Joining each re-derivation's fired rules with their recorded strength (`various/03-evidence-strength-by-firing.txt`):

| rule set | strength | rules | firings, corpus | firings, Candela |
|---|---|---:|---:|---:|
| `simplify` | proof | 15 | 152 | 40 |
| | exhaustive | 4 | 0 | 0 |
| | reduced-width+argument | 8 | 204 | 16 |
| `fold` | by-construction | 40 | 73 | 2,081 |

By edit rather than by firing, the weakest strength each `simplify` edit relied on is `proof` for 125 of 329 corpus edits and `reduced-width+argument` for 204; on Candela, 32 and 16. Every `fold` edit is by-construction. The most frequent rule on the corpus, `not-lt` (192 of 356 `simplify` firings), is one of the eight comparison inversions with the weakest non-sampled strength. A proof for those eight rules would raise the floor of 204 of the 329 corpus edits.

## 14. What the sampled check costs per pass

On the corpus, a check is cheap next to a pass: 663 ms of checks against 5,953 ms of pass time over all six pipelines with the memo, and 3,585 ms of checks without it (`02-edit-census-corpus-no-reuse.txt`). The `simplify` and `fold` applications account for 177 ms of the checks with the memo (26.7 %) and 1,210 ms without it (33.8 %), against 10.8 ms and 17.2 ms to re-derive all their edits.

Candela is where the cost is. Its O2 spent 120.8 s in passes and 32.4 s in checks (21 % of 153.2 s), on 13,280 runs of r0 and 64,040 runs of candidates; 108,600 verdicts were replayed by the memo. That is 0.419 ms per evaluated run. The first check costs 10.4 s, because nothing is in the memo yet; later checks cost 0.7–2.6 s in proportion to the subject runs the memo cannot replay. The three rule-backed applications needed 13,200 subject runs (20.6 %) and 6,198 ms (19.1 %) of checking, against 22 ms of re-derivation. The run took 2 min 44 s with a 3.92 GB peak under the memory cap (diary step 3).

## 15. What the measurements say about the hypothesis

The research framing of this ticket states the hypothesis: *most expression-level edits come from a small set of verified local rules; for those, an edit can be checked as an instance of a rule, and the obligation localized to the changed region; sampling remains for structural passes.* The measurements support it in part.

- **Instance checking works, exactly and cheaply.** 1,232 of 1,232 rule-backed edits re-derive. On Candela, re-deriving them took 22 ms, against 6,198 ms for sampling the same three applications.
- **"Most" depends on what is counted.** Rule-backed edits are the majority of expression-level edits on the corpus (59.8 %) and a large minority on Candela (37.0 %); with fact-backed substitutions treated as rules with a hypothesis, 76.8 % and 77.8 %. They are a small minority of all edits (18.6 % and 14.0 %).
- **The saving is the rule-backed passes' share of sampling**: about a fifth of Candela's subject runs today. Extending the exact part to `constprop` (another 6,480 runs) and, through certificates, to `dce` would roughly double it; the rest belongs to `cfg`, `licm`, `lvn` and `subst`.

# Part 3: The design

## 16. Translation validation, made exact and compositional

**Translation validation** checks one run of a transformation, this input and this output, instead of proving the transformation correct for all programs (Pnueli, Siegel and Singerman, 1998; Necula, 2000). The meaning check is a translation validator that decides by sampling. This design makes it **exact** where a rule-based argument exists, and **compositional** in two directions: per-edit arguments compose into a per-step argument, and per-step guarantees compose along the pipeline.

The argument has four links. Write ⟦t⟧(σ, μ) for the outcome of evaluating tree `t` with locals σ and memory μ: a value, or a trap, together with the effects of any calls inside it, in order.

1. **A verified rule is sound for every instance.** For a rule `L → R` with guards `G`, the verifier established that for every binding β satisfying `G`, ⟦Lβ⟧ and ⟦Rβ⟧ agree, and its structural check established that no impure variable is dropped, duplicated or reordered (IRWB-006 guide §14). Strength aside, this is what the evidence claims.
2. **Congruence.** If ⟦t⟧ = ⟦t′⟧ for all σ and μ, then ⟦C[t]⟧ = ⟦C[t′]⟧ for any tree context `C`. This holds for the evaluator because a tree is evaluated bottom-up from its operands' outcomes, reads locals but never writes them, and its only effects are those of the calls, loads and traps inside it, which rule instances preserve by link 1. By induction on the tree, `normalize(t, table)` agrees with `t` everywhere.
3. **Statements and functions.** A statement whose trees are replaced by trees that agree everywhere has the same effect. A function whose only changes are such replacements, with every block, statement, local and branch target unchanged, agrees with its earlier version on every input. It also takes the same number of steps: the evaluator counts executed statements (`evaluate.ts:454`), and the same statements execute, so the step limit is hit on exactly the same cases and an inconclusive case stays inconclusive.
4. **The chain.** If r(k−1) agrees with r0 on the gate's cases C (it was accepted), and r(k) agrees with r(k−1) on *every* input, then r(k) agrees with r0 on C, with the same counts, and introduces no new risk of its own.

```text
 r0 ──cfg──► r1 ──fold──► r2 ──simplify──► r3 ──constprop──► r4 ──…
      sampled      exact          exact            sampled
     r1 ≈C r0     r2 ≡ r1        r3 ≡ r2          r4 ≈C r0
                  (all inputs)   (all inputs)
```

`≈C` is agreement on the cases C; `≡` is agreement on every input. The chain's guarantee is as strong as its weakest step, and an exact step adds no doubt to it. The precise statement of the gain: on a pipeline mixing both kinds of step, any wrong program the gate accepts was introduced by a sampled step. Rule-backed steps cannot introduce one, whatever the case distribution is, NaN payloads included.

The fourth link seems to need a fact about history: r(k−1) must itself have been accepted. That cannot be assumed. `Program.apply(pass, { check: false })` (`program.ts:256`) publishes a revision without any contract. The design does not need the assumption, because the memo carries the fourth link case by case (section 18). The version 3 check replays a case's verdict only if that verdict was decided on a closure with the same semantic key, that is, on content proved to agree with r(k)'s on every input. Where no such verdict exists, for example after `check: false`, the case is simply run. Every verdict in r(k)'s evidence was therefore decided by an actual run, on r(k) or on code proved equivalent to it.

## 17. The edit validator

The validator decides, for one pass application, which functions changed only by derivable expression rewrites. It is a pure function of the two revisions and the verified rule tables. **Proposed** (`src/typed/rules/derive.ts`):

```ts
export interface FieldDerivation {
  readonly stmt: string;
  readonly field: 'value' | 'cond' | 'addr';
  readonly from: string;                  // root id in the input revision
  readonly to: string;                    // root id in the output revision
  readonly ruleSet: string;               // e.g. 'simplify@1'
  readonly firings: readonly string[];    // e.g. ['sub-self@1', 'add-zero@1'], in firing order
  readonly strength: Strength;            // the weakest of the fired rules (section 19)
}
export interface FunctionDerivation {
  readonly fn: string;
  readonly status: 'unchanged' | 'derived' | 'residual';
  readonly fields: readonly FieldDerivation[];
  readonly reasons?: readonly string[];   // for a residual function: what could not be derived
  readonly strength?: Strength;           // for a derived function
}
export interface DerivationReport {
  readonly functions: readonly FunctionDerivation[];
  readonly ms: number;
}
export function deriveRevision(
  before: TypedBlocks, after: TypedBlocks,
  sets: readonly RuleSet[],              // only sets whose every rule has matching sound evidence
  cited?: (stmt: string, field: string) => string | undefined,   // a citation's rule set first
): DerivationReport;
```

The algorithm:

```text
deriveRevision(before, after, sets):
  for each function f of before or after:
      P <- part of f in before;  P' <- part of f in after             parts.ts:43
      if P' is P, or partHash(P') = partHash(P):     unchanged
      else if f was added or removed:                 residual: 'function added or removed'
      else if skeleton(P) != skeleton(P'):            residual: the first difference
      else for each statement id s of f, each field k in value, cond, addr:
          t  <- the tree of field k of statement s in before
          t' <- the tree of field k of statement s in after
          if t ≅ t':  continue                                       same tree, new ids
          for each set R (the cited set first):
              fired <- [];  if normalize(t, R, fired) ≅ t':  record (s, k, R, fired);  next field
          residual: 'field k of s is not derivable'
      if f has a residual reason:                     residual
      else if no field was recorded:                  unchanged (only ids or origins differ)
      else:                                           derived, strength = weakest fired
```

`≅` is structural equality: operator, immediate, type and operands, recursively; ids and origins are ignored. The **skeleton** of a function is everything about it except its expression trees and its origins: its parameters and result type, its locals (index, name, type), its blocks in order with their successor lists, each block's statement ids in order, and each statement's operation and non-tree fields (the local a `set` writes, branch targets, offsets). Origins are provenance and do not execute; the front-end `ops` records are anchors for source lines and do not execute either; `counters` and `rev` change at every pass and carry no meaning. The prototype in `scripts/01-edit-census-corpus.mjs` implements the inner loop (`normalize`, `match`, `guard`, `inst`); the skeleton comparison is new.

Three properties of the validator are deliberate.

- **A non-derivable change is not an error.** It makes the function residual, and the residual is sampled. The validator never rejects anything, so it can never reject a correct pass; rejection remains the sampled check's job.
- **Any verified set will do.** Normalizing with a set the pass did not use cannot produce a wrong acceptance, because every set is sound; it can only fail to re-derive. A citation (section 20) only tells the validator which set to try first.
- **It is independent of the pass.** It re-implements matching, guards and instantiation over plain trees instead of importing `matchPat` and `guardHolds` from `compile.ts`, and it never uses `Tx`. A bug in the pass's matcher therefore cannot hide in the checker. The shared parts are the rule data, its evidence, and the evaluator's operator functions.

What the validator trusts, and why:

| component | trusted because |
|---|---|
| rule tables and their evidence, pinned by fingerprint | verified once by `verify.ts`; `tests/typed/rules.test.mjs` checks fingerprints and re-runs the fast methods |
| the verifier's semantics (`BIN`, f32 functions) | tested equal to `binop` on crossed boundary values (`tests/typed/rules.test.mjs:83`) |
| `evalOp` (`binop`, `f32Op`) | it is the evaluator, the specification; checked against the reference compiler's images on 6,986 corpus and 33,200 Candela cases |
| `normalize`, `match`, `guard`, `instantiate`, the skeleton comparison | small (the prototype's inner loop is about 50 lines), independent of the pass |
| congruence of the evaluator (section 16, link 2) | trees read locals and memory and call functions; rules keep impure variables in order, by the structural check |
| the memo's subject keys (section 16, link 4; section 18) | `closureKey` captures what an outcome depends on (IRWB-004 step 8); tested by identical evidence with reuse on and off, on the corpus and on Candela |

## 18. Regional obligations: semantic part keys and mixed passes

A derived function agrees with its earlier version on every input. The memo of section 7 already avoids re-running cases whose closure did not change; the natural extension is to let a derived function count as unchanged. **Proposed** (in `src/typed/parts.ts`, additive):

```text
semanticKey(P)       = alias[partHash(P)] ?? partHash(P)
alias[partHash(P')]  := semanticKey(P)        set only by the validator, when P' is derived from P
semanticClosureKey(v, f) = SHA-256 of the sorted lines "name:semanticKey(part)" of every function
                           reachable from f by calls, and the frame-array flag
                           (closureKey, parts.ts:241, with partHash replaced by semanticKey)
```

The sampled check used by new pipelines takes `semanticClosureKey` as its subject key. The consequence is exact: a case whose closure contains only unchanged or derived functions has the subject key it had at the previous step, so its verdict replays, and only cases that can reach a residual function run. That is the **regional obligation**: the correspondence and the parts say where the program changed, the validator discharges part of that, and the sampled check pays only for the rest.

```text
 Candela, simplify at r3: 19 functions changed; all 48 edits derived
   today (v1, closureKey):                 2,720 subject runs, 1,989 ms
   with semantic keys (Proposed):          0 subject runs; every verdict replays
```

Four details make this safe.

- **The alias is a fact about contents.** `partHash` is a hash of the part's records, so `alias[h1] = h0` says "content h1 agrees on every input with content h0", given the rule sets used. That stays true forever, so the map can be global, content-addressed and shared by every program. It is keyed together with the fingerprint of the rule sets that proved it, so changed evidence never reuses an old alias.
- **A lost alias costs time, not soundness.** If the alias map or the memo has evicted an entry, the case runs and is decided as before.
- **A fully derived step needs no special case.** All its verdicts replay, the evidence counts equal the previous step's, and the "no decided case" rule of section 6 is never triggered, because the replayed verdicts are decided ones.
- **Inconclusive stays inconclusive.** A derived function executes the same statements, so a case that hit the step limit before still hits it (section 16, link 3); replaying its "inconclusive" is exact, not an approximation.
- **An unchecked input costs time only.** If r(k−1) was published with `check: false`, no verdict exists under its keys, nothing replays, and the cases of r(k) run as in version 2.
- **The granularity is the function.** A function with one residual change is sampled as a whole, because cases are generated per function and the memo is keyed per closure. Finer obligations would need per-statement case generation, which the evaluator does not offer.

**Mixed passes** follow without further machinery. A pass application that changes some functions only by rule applications and others structurally gets an exact part (the derived functions, free) and a sampled residual (the rest). A future pass that both simplifies expressions and threads jumps, or one that applies rules in some functions and inlines in others (IRWB-003), is checked at the cost of its structural part only.

## 19. The evidence-strength order

A revision should say how strong the weakest evidence it relied on is. The five strengths are ordered, strongest first:

```text
   proof  >  exhaustive  >  reduced-width+argument  >  by-construction  >  sampled
```

| strength | covers | what would have to be wrong |
|---|---|---|
| proof | every 32-bit input, by a symbolic argument the verifier checks | an error in the verifier's normal forms or in `BIN` |
| exhaustive | every 32-bit input, enumerated | an error in `BIN` or the f32 functions |
| reduced-width+argument | every input at 8 bits, plus a written argument for 32 bits, plus 10⁶ random 32-bit samples | an error in the argument |
| by-construction | every input, with the evaluator's own function as the replacement; the guard checked to exclude traps | an error in the evaluator, which no check in the system could see either |
| sampled | the cases run | any fault the cases miss |

The weakest of a set is its minimum. It is recorded at four levels:

- **a derived field**: the weakest of the rules fired in it;
- **a derived function**: the weakest of its fields;
- **a pass application**: the weakest of its derived functions, and `sampled` if any function is residual;
- **a revision's history**: the weakest over the steps from r0.

The last level deserves a warning. The first pass of every O2-family pipeline is `cfg`, which is structural, so the history of every such head is `sampled`. The step level is the informative one, and the workbench must not present a head as "exact" because most of its steps were.

**Where it is recorded** (Proposed): in the evidence of the version 3 check (section 21), as counts per strength and per function; in `Program`'s `Revision` record as a new field `assurance` (outside the hash, `program.ts:54`); in the workbench's Timeline and Checks views at 72 columns; and as a numeric metric (the rank in the order above) that a strategy's `chooseBest` can constrain.

**Decision, open for the user: the order of `reduced-width+argument` and `by-construction`.** The order above follows the listing in this ticket's brief. The two are different kinds of incompleteness: by-construction covers every input but checks nothing about the value independently of the evaluator; reduced-width checks the value independently but covers 32 bits only by an argument. A product of two components (coverage: all inputs / reduced width plus argument / sampled; basis: independent / evaluator) would make them incomparable, and their meet would be a sixth point. No measured edit relies on both, since each edit is normalized by one table (section 13), so the choice changes no number in this guide. The implementation should record the count per strength next to the weakest, so that a stricter policy can be computed later without re-checking.

## 20. Pass variants that cite the rules they applied

Section 12 showed that exact checking does not need citations. They are still worth having, for three reasons:

- **Provenance.** `why` should be able to say "made by rule `not-lt@1`, evidence reduced-width+argument". Today it cannot (section 4), and for edits like `algebra`'s it says nothing at all.
- **Accountability.** A pass that cites a rule it did not apply, or applies one it does not cite, has a bug even when its output is correct. A test can compare citations with the validator's re-derived firings.
- **Passes whose output is not a normal form.** Normalization re-derives the output of a pass that applies a table in one bottom-up walk, as `Tx.rewrite` does. A pass that searches (equality saturation, a superoptimizer, IRWB-010) chooses one of many equivalent forms, and normalization will not reproduce it. For such a pass the citation *is* the argument: a sequence of rule applications at positions, which the validator checks step by step (certificate mode, section 25).

**Where a citation goes.** A citation is a token `rule:<set>/<name>@<version>#<fingerprint prefix>`, for example `rule:simplify/not-lt@1#c0014dc6ccde`, so that it names the exact evidence record. The `algebra` edit decides where it can live: the constant `sub-self` made and the parent `add-zero` collapsed exist in no revision, so a token on made values alone would be lost. The alternatives:

| place | complete? | in the hash? | visible in |
|---|---|---|---|
| (a) `because` of the outermost value a rule makes | no: a rule that returns an existing operand makes nothing | yes | `Program.why` on that value |
| (b) the `replace` edit (`rules: [...]`) and the correspondence entry of the old root (`because`) | yes: one list per statement field | no | `Program.whyChain`, reports |
| (c) an extra origin entry on the statement whose field changed | yes | yes | `Program.why` on the statement |

**Decision (Proposed): the variants write all three.** (b) is what the validator's cross-check and the reports read, and it repairs the `removed`-with-no-reason entries. (c) makes the artifact carry its own provenance, which is the project's principle: for every statement the compiler can answer why, from the revision itself. (a) keeps `why` on a made value informative. Because (a) and (c) are inside the hash, these must be new passes in new pipelines; this is the blocker the brief names, and it applies to provenance only.

The variants (Proposed, `src/typed/rules/cited.ts`):

- `simplify-r` and `fold-r`: the specs of `simplify` and `fold` (same writes, same preserves) under new names, with bodies `tableBody(rules, { cite: true })`.
- `compileRules(rules, firings?, { cite: true })` (Proposed option, `compile.ts:119`): the visitor calls `tx.cite(token)` for every rule it fires.
- `Tx.cite(token)` (Proposed, additive, `tx.ts`): appends the token to the list of the statement field being walked; when `Tx.rewrite` records that field's `replace` edit, it adds `rules: [...]` to the edit and appends `{ from: s, via, kind: 'recorded', rev, because: tokens, note: 'rewrote <field>' }` to the statement's `origin`. A pass that never calls `cite` produces exactly what it produces today, so O2 is untouched.
- `revisionCorrespondence` (`passes.ts:117`) adds an edit's `rules` to the `because` of its old root's group.
- `Program.why` (`program.ts:457`) shows origin entries after the first as "rewritten by"; it reads only `origin[0]` today.

Origins do not influence any pass's decisions (`sameTree` ignores them), so a pipeline built from the variants makes the same programs as O2 up to origins. That gives the variants' acceptance test: strip origins, and every revision of `O2r` equals the corresponding O2 revision; the images are byte-identical.

## 21. The contract: version 3, its keys and names, and which pipelines use it

**Version 3** (Proposed, `src/typed/exact.ts`) is version 2's sampled check, applied only to the residual, with the validator in front:

```ts
export interface ExactParams extends StrongParams {      // StrongParams: IRWB-005's version 2 params
  readonly ruleSets?: readonly RuleSet[];               // default [SIMPLIFY_RULES, FOLD_RULES]
  readonly audit?: number;                              // share of derived functions still sampled; 0
}
export function meaningKeptExact(params?: ExactParams):
  InvariantDefinition<{ origin: typeof BlocksIR; input: typeof BlocksIR; candidate: typeof BlocksIR }>;
export function exactOptimizationContract(params?: ExactParams): TransformationDefinition<any, any>;
```

```text
meaningKeptExact.check({ origin: r0, input: r(k-1), candidate: r(k) }):
  d <- deriveRevision(input.value, candidate.value, verified sets)
  for each derived function f:  alias[partHash(f in candidate)] := semanticKey(f in input)
  e <- runDifferentialAsync(version 2 spec with subjectKey = semanticClosureKey,
                            { origin, candidate })      cases that reach a residual function run;
                                                        the others replay, if a verdict exists
  evidence <- { method: residual functions or runs ? 'sampled' : 'exact',
                derivation: d (summary), sampled: e, strength: weakest (section 19) }
  holds iff e.status = 'agree'
```

The `input` port is the revision the pass was applied to; nothing is assumed about how it was published (section 16).

`assuranceOf` (`differential.ts:325`) then reports `checked-exact` for a fully derived step and `checked-sampled` otherwise, with no change to it. `exactOptimizationContract` ensures the invariant with `origin` bound to `inputs.origin`, `input` to `inputs.input` and `candidate` to `outputs.output`; `applyPass` already passes `input` (section 5), so it needs no change.

**Version 2 first needs memo keys.** For the residual to replay, version 2 must set `baselineKey` (the origin's revision, as version 1) and `subjectKey` (`closureKey`, or `semanticClosureKey` inside version 3). This is sound for the same reason as in version 1, plus one point specific to version 2: its divergence rule depends on whether the origin finished, which is fixed by the baseline key, and its `run` already computes that when the origin's outcome is replayed (IRWB-005 step 15). The keys change which cases run, not any verdict, so version 2's version string does not change.

**How versions are keyed and named.** Each version's string is a major number and a hash of everything that can change a decision, and the transformation contract takes the same string:

| check | version string | key hashed |
|---|---|---|
| `typed.meaning-kept` v1 (frozen) | `1+<hash>` | `{ count, seed, inputs, limit, roots? }` (`evaluate.ts:587`) |
| `typed.meaning-kept` v2 (IRWB-005) | `2+<hash>` | `{ generator: 'strong-1', count, extra, coverage, divergence, layout, seed, inputs, limit, roots? }` |
| `typed.meaning-kept` v3 (Proposed) | `3+<hash>` | v2's key, plus `{ validator: 1, sets: [{ name, version, fingerprint, evidence fingerprints }], audit }` |

Putting the rule sets' and evidence fingerprints into the key means that re-verifying or editing a rule changes the contract's identity, as editing a case parameter does today.

**Which pipelines use which contract.** A pipeline's contract becomes part of its definition (Proposed: `src/typed/pipelines.ts`, a list of `{ name, passes, contract: 'v1' | 'v2' | 'v3' }` outside `PIPELINES`, consulted by `Program.pipeline`; `Program.apply` gains an optional `contract`). The rule is that **existing named pipelines keep version 1 and every pipeline defined from now on uses version 3, or version 2 until version 3 exists**:

| pipeline | contract | reason |
|---|---|---|
| `O0`, `O1`, `O2`, `loops`, `checks`, `broken` | v1 | the prototype's pipelines and the book's numbers: frozen |
| `O2+` | v1 (recommended; decision for the user) | measured results depend on it (IRWB-001's per-scene kernels, IRWB-005's bases) |
| `O2-sccp` (IRWB-006, `src/typed/sccp.ts:171`) | v2, then v3 | new, outside `PIPELINES` |
| IRWB-003's new pipelines, when merged | v2, then v3 | new |
| `O2v2` (Proposed) | v2 | O2's passes under version 2: measures version 2 alone |
| `O2r` (Proposed) | v3 | O2 with `simplify-r` and `fold-r` |

**What version 2 costs, measured and estimated.** On the corpus, IRWB-005 measured it on correct pipelines (step 9): all 44 projects' pipelines take 28.6 s under version 1 and 26.7 s under version 2, accept the same passes and end at the same heads. Measured alone, a check costs in proportion to its cases: 560 ms for version 1's 40 cases per function on all heads, 1,139 ms for version 2's 80 (load average 12.7). On Candela neither version 2's cost nor its acceptance of O2 has been measured, and its layout fix changes the cases of 168 functions. The following are **estimates** from this guide's measurement of 0.419 ms per evaluated run with version 1 (section 14), assuming version 2's runs cost the same:

| Candela O2, checks only | evaluated runs | time |
|---|---:|---:|
| v1 with the memo (measured) | 77,320 | 32.4 s |
| v2 as IRWB-005 ships it, no keys (estimate) | 13 × 2 × 26,560 = 690,560 | about 290 s |
| v2 with memo keys (estimate: twice v1's runs) | 154,640 | about 65 s |
| v3: v2 with keys, the three rule-backed steps derived (estimate) | 154,640 − 2 × 13,200 = 128,240 | about 54 s |

The numbers say what the brief's "stronger guarantees and cheaper passes at once" means here. The rule-backed steps become both stronger (exact) and cheaper (no runs). The pipeline as a whole becomes stronger (version 2 on the residual) at an estimated 1.7 times version 1's checking cost, which is about a fifth of what version 2 would cost without keys. Phases 1 and 2 measure the estimates.

## 22. One application, end to end

`O2r` on Blend, at the `simplify-r` step (r3 in O2's numbering; Proposed behaviour, using the measured data of section 4):

```text
 Program.pipeline('O2r') ──► Program.apply(simplify-r, { contract: v3 })
   applyPass(simplify-r, r2, { contract: exactOptimizationContract(params),
                               contractInputs: { origin: r0 } })
     pass.run: Tx.rewrite with cite
        edit:r3.0 replace s:blend.4 cond v:blend.8 → v:blend.35, rules ['not-lt@1']
        s:blend.4 origin += { via: simplify-r, rev: 3,
                              because: ['rule:simplify/not-lt@1#c0014dc6ccde'] }
     createIRArtifact, diff, undeclared-write check                       as today
     meaningKeptExact.check({ origin: r0, input: r2, candidate: r3 }):
        deriveRevision: blend: field cond of s:blend.4:
            normalize(eqz(lt(get#6, get#1)), simplify) = ge(get#6, get#1) ≅ after   derived
        alias[partHash(blend in r3)] := semanticKey(blend in r2)
        version 2 check: 80 cases of blend; semantic closure key = r2's → 80 replayed, 0 run
                         (r2's verdicts were decided at the fold-r step, or replayed there
                          from r1's, which were run)
        evidence { method: 'exact', strength: 'reduced-width+argument',
                   derived: [blend], residual: [], sampled: 80/80 replayed }
   Revision r3 { pass: simplify-r, assurance: 'reduced-width+argument', … }
 Program.why('s:blend.4') ─► … rewritten by simplify-r at r3
                                because rule:simplify/not-lt@1#c0014dc6ccde
```

At the next step, `constprop` replaces a read by a constant on the strength of reaching definitions. The validator cannot derive that with a rule table, `blend` is residual, and its 80 version 2 cases run against r0's stored outcomes.

# Part 4: Risks, falsification, future work and related work

## 23. Risks

- **A verified rule is wrong.** An evidence record could be wrong (the argument behind a reduced-width rule, an error in `BIN`), and exact acceptance removes the sampled check that might have caught an instance. Mitigations: a shadow phase in which both run (Phase 0); the `audit` parameter, which keeps sampling a seeded share of derived functions; mutated rule tables in the tests; and, later, proofs for the comparison inversions (section 25).
- **The validator accepts something that is not a derivation.** Mitigations: independence from the pass's matcher and from `Tx`; tests that feed it IRWB-005's mutants at rule-backed sites, every one of which must come out residual; a small code size.
- **Congruence fails for some construct.** The argument of section 16 assumes trees have no effects other than those of calls, loads and traps inside them. A future operator with another effect (a write inside a tree) would break it. Mitigation: the skeleton and tree comparisons cover only the current operators, and an unknown operator makes a field residual.
- **The memo's keys miss a dependency.** Replay, which version 3 relies on for every derived function, is sound only if a closure key captures everything a case's outcome depends on. IRWB-004 flagged this for review (step 8): an evaluator that one day reads more of the program (the front end's tables, counters) breaks `closureKey` and `semanticClosureKey` alike. Mitigation: the reuse-on/reuse-off identity test, run on the corpus and on Candela in every phase.
- **Version 2 changes what Candela's O2 does.** Its record layout fix changes the cases of 168 functions, and its divergence rule can reject a correct pass that needs more than ten times the origin's steps. Neither has been measured on Candela's O2. Mitigation: Phase 1 measures it before any pipeline adopts version 2 on Candela.
- **Version 2 without keys is expensive.** Estimated at about nine times version 1's checking on Candela (section 21). The keys are a prerequisite for adoption, not an optimization.
- **Provenance growth.** Extra origin entries on statements make revisions larger and change what `why` prints. Mitigation: they exist only in the variants' pipelines.
- **Overclaiming.** Exact steps make a pipeline stronger, not exact. The workbench, reports and strategies must show the history level of section 19, not only the step level.

## 24. What would falsify the approach

Each criterion is a measurement with a threshold, so that the approach can be dropped on evidence.

| criterion | measured so far | falsified if |
|---|---|---|
| F1: rule-backed edits re-derive | 1,232 of 1,232 (section 12) | any edit of a table pass does not re-derive on the corpus or Candela: the tables would not be the whole of what the pass does |
| F2: exact acceptance agrees with sampling | not yet | in the shadow phase, any application the validator derives is rejected by version 1 or 2: a rule's evidence or the validator is wrong, and adoption stops |
| F3: the exact part is worth having | 20.6 % of Candela's subject runs; 26.7 % of the corpus's check time | on the new pipelines (IRWB-003's, `O2r`), the derived share of subject runs is below 10 % |
| F4: the gate is not weakened | not yet | IRWB-005's kill rate under version 3 falls below version 2's (99.5 % on the corpus heads, 99.9 % held out, 97.2 % on the Candela subset) |
| F5: derivation stays cheap | 22 ms against 6.2 s on Candela | derivation costs more than a tenth of the sampled checks it replaces |
| F6: replay is sound | IRWB-004: identical evidence with reuse on and off, corpus and Candela | under version 3, any check's evidence differs between reuse on and reuse off |

## 25. Future sections

**Rules with fact hypotheses.** `strength` is a rule with a guard the shape cannot express: `div(x, 2^k) → shr(x, k)` if `x ≥ 0`. Verified once with a range guard, and with the guard discharged by the cited range fact, its edits become derivable, relative to the range analysis; C5 found that analysis's claims to hold on 149,381,636 checks. `constprop` and `sccp` need a different argument: a certificate that the cited definitions are exactly the reaching definitions of the read, and that all assign the same constant, which is IRWB-002's item D4. Together these would move another 112 corpus edits and 925 Candela edits, and Candela's `constprop` step with its 6,480 subject runs, into the exact part. The order of the strengths then needs a component for "relative to an analysis fact".

**Calibrated miss probabilities for the residual.** For independent samples from a distribution with no failure observed, the familiar bound is a failure probability below about 3/n at 95 % confidence (Hanley and Lippman-Hand, 1983). It does not transfer to this gate, because faults are not distributed like the cases: under version 1 the probability of a non-canonical NaN argument is zero, and so is the bound's relevance. Calibration has to come from mutation measurements per pass family, fault class and workload, as IRWB-005 measured them, attached to the residual's evidence as an estimate with its source, for example "for residual changes of `cfg` on corpus-like code, version 2 missed at most 0.2 % of mutants".

**A decision procedure.** A bit-vector decision procedure would turn the eight comparison inversions from `reduced-width+argument` into proofs (204 of the 329 corpus `simplify` edits rely on them), verify rules discovered by enumeration (IRWB-002 item B3), and check expression edits that are not instances of any table by deciding ∀ locals. t = t′ under the cited facts. There are two ways to get one. An in-house bit-blaster and SAT solver in TypeScript is a contained project with nothing downloaded (Kroening and Strichman's *Decision Procedures* covers the encoding). Vendoring an SMT solver compiled to WebAssembly, such as a z3-wasm build (de Moura and Bjørner, 2008), is much stronger and is **downloaded code**: whether to vendor it is the user's decision, and under the standing rule nothing from a downloaded archive is run until the user decides.

**Proof-producing e-graphs (IRWB-010).** Equality saturation (Tate, Stepp, Tatlock and Lerner, 2009; Willsey et al., 2021) applies all rules at once and extracts one cheapest form, which is not a normal form of a bottom-up visitor, so re-derivation cannot check it. E-graphs that record why two terms are equal can produce explanations as sequences of rule applications (Flatt et al., 2022). With citations of the form of section 20 extended to positions, the validator would check such a certificate step by step instead of normalizing: certificate mode.

## 26. Related work

Only works whose authors and year are certain are listed.

- **Translation validation.** A. Pnueli, M. Siegel and E. Singerman, "Translation Validation", TACAS 1998, introduced checking each compiler run instead of the compiler. G. C. Necula, "Translation Validation for an Optimizing Compiler", PLDI 2000, applied it to a production compiler's optimizations. J.-B. Tristan, P. Govereau and G. Morrisett, "Evaluating Value-Graph Translation Validation for LLVM", PLDI 2011, measured how often a validator succeeds on real optimizations, the question section 12 asks here.
- **Verified rewrite rules.** N. P. Lopes, D. Menendez, S. Nagarakatte and J. Regehr, "Provably Correct Peephole Optimizations with Alive", PLDI 2015, states peephole optimizations as rules with preconditions and verifies each with an SMT solver once, the model for IRWB-006's tables. N. P. Lopes, J. Lee, C.-K. Hur, Z. Liu and J. Regehr, "Alive2: Bounded Translation Validation for LLVM", PLDI 2021, validates individual compilations with bounded checks.
- **Optimizations proved once.** S. Lerner, T. Millstein and C. Chambers, "Automatically Proving the Correctness of Compiler Optimizations", PLDI 2003, and S. Kundu, Z. Tatlock and S. Lerner, "Proving Optimizations Correct Using Parameterized Program Equivalence", PLDI 2009, prove optimizations written in a restricted language correct for all programs.
- **Verified compilers and validators.** X. Leroy, "Formal Verification of a Realistic Compiler", Communications of the ACM, 2009 (CompCert). J.-B. Tristan and X. Leroy, "Formal Verification of Translation Validators", POPL 2008, verified the validators themselves.
- **Certificates.** G. C. Necula, "Proof-Carrying Code", POPL 1997: the producer supplies a proof that a small checker verifies, the principle behind certificate mode and IRWB-002's item D4.
- **Equality saturation and explanations.** R. Tate, M. Stepp, Z. Tatlock and S. Lerner, "Equality Saturation: A New Approach to Optimization", POPL 2009. M. Willsey, C. Nandi, Y. R. Wang, O. Flatt, Z. Tatlock and P. Panchekha, "egg: Fast and Extensible Equality Saturation", POPL 2021. O. Flatt, S. Coward, M. Willsey, Z. Tatlock and P. Panchekha, "Small Proofs from Congruence Closure", FMCAD 2022.
- **Decision procedures and solvers.** D. Kroening and O. Strichman, *Decision Procedures: An Algorithmic Point of View*, Springer, 2008. L. de Moura and N. Bjørner, "Z3: An Efficient SMT Solver", TACAS 2008.
- **Mutation testing and zero-failure bounds.** Y. Jia and M. Harman, "An Analysis and Survey of the Development of Mutation Testing", IEEE Transactions on Software Engineering, 2011. J. A. Hanley and A. Lippman-Hand, "If Nothing Goes Wrong, Is Everything All Right?", JAMA, 1983.

# Part 5: Implementation plan

## 27. Phases, each with its acceptance measurement

The order follows from section 12. The validator needs neither the variants nor version 2, so it comes first and runs beside the frozen gate, where it can be falsified (F1, F2) before anything depends on it.

**Phase 0: the validator, in shadow mode.** `src/typed/rules/derive.ts` (`deriveRevision`, the skeleton comparison, `normalize` over plain trees) and `tests/typed/derive.test.mjs`. A ticket script runs it on every pass application of every corpus pipeline and of Candela's O2 (under the memory cap), beside the unchanged version 1 gate.
- Acceptance: every `simplify` and `fold` edit derived (394 corpus, 838 Candela, as the prototype measured); for every derived function, version 1's decision is "agree" (F2); unit tests with hand-made non-derivations (a wrong constant, a flipped comparison, a changed branch target, an added statement) all come out residual; the four frozen commands unchanged.
- Also: every IRWB-005 corpus mutant at a site in a `simplify` or `fold` output comes out residual (its harness, `tools/mutation-score.mjs`, is merged; this ticket's branch must first be rebased onto `irwb-001/import-v6-prototype`).

**Phase 1: version 2 with memo keys.** `baselineKey` and `subjectKey` in `meaningKeptStrong` (IRWB-005, merged at `bff08a6`).
- Acceptance: identical evidence with the memo on and off on the corpus; Candela's O2 under version 2, under the memory cap: accepted or not, every check's counts, and the checking time against the estimate of section 21 (about 65 s).

**Phase 2: semantic part keys and version 3.** `semanticKey` and `semanticClosureKey` in `src/typed/parts.ts` (additive); `meaningKeptExact` and `exactOptimizationContract` in `src/typed/exact.ts`; `tests/typed/exact.test.mjs`.
- Acceptance: on the corpus, `O2-sccp` and `O2v2` reach the same heads under version 3 as under version 2; rule-backed applications evaluate 0 cases; identical evidence with reuse on and off (F6); Candela's O2 under version 3: checking time against the estimate (about 54 s); IRWB-005's harness with version 3 as a gate reaches at least version 2's kill rates (F4).

**Phase 3: rule-citing variants and `O2r`.** `Tx.cite`, the `cite` option of `compileRules`, `simplify-r` and `fold-r` (`src/typed/rules/cited.ts`), citations in `revisionCorrespondence`, `why` showing later origin entries, `src/typed/pipelines.ts` with contracts per pipeline, and `Program.apply`'s `contract` option.
- Acceptance: with origins stripped, every `O2r` revision equals O2's, and images are byte-identical on the corpus; every citation equals the validator's re-derived firings; `why` on `algebra`'s `s:tidy.3` names `sub-self` and `add-zero`; O2's revisions unchanged (the four frozen commands).

**Phase 4: strengths, recorded and shown.** `Revision.assurance`, the per-strength counts, the Timeline and Checks views, and a strategy metric.
- Acceptance: listings at 72 columns; a strategy constraint on the strength metric rejects a candidate chain with a sampled step; the history level is shown next to the step level.

**Phase 5: research.** Rules with fact hypotheses (`strength` first, then `constprop` by certificate); calibrated miss probabilities from IRWB-005's harness; a decision procedure (after the user's decision on vendoring); certificate mode for IRWB-010.
- Acceptance: each extension reports the share of subject runs it moves into the exact part, against the thresholds of section 24.

## 28. Files

| file | status | contents |
|---|---|---|
| `src/typed/rules/derive.ts` | new | `deriveRevision`, `normalize`, skeleton comparison |
| `src/typed/exact.ts` | new | `meaningKeptExact`, `exactOptimizationContract` |
| `src/typed/parts.ts` | changed, additive | `semanticKey`, `semanticClosureKey`, the alias map |
| `src/typed/cases-strong.ts` (IRWB-005) | changed | `baselineKey`, `subjectKey` |
| `src/typed/tx.ts` | changed, additive | `Tx.cite`; citations in `Tx.rewrite` |
| `src/typed/rules/compile.ts` | changed, additive | the `cite` option |
| `src/typed/rules/cited.ts` | new | `simplify-r`, `fold-r` |
| `src/typed/passes.ts` | changed, additive | `rules` into the correspondence's `because` |
| `src/typed/pipelines.ts` | new | pipelines with their contracts |
| `src/typed/program.ts` | changed | `apply`'s `contract` option, `Revision.assurance`, `why` on later origin entries |
| `tests/typed/derive.test.mjs`, `tests/typed/exact.test.mjs` | new | Phases 0–3 |

`src/framework/**` does not change. IRWB-009 (a function-incremental framework) also changes how parts and closure keys are computed, and its owner should agree on `semanticKey` before Phase 2.

## 29. Decisions and open questions

| decision | status | reason |
|---|---|---|
| The validator re-derives; it does not trust citations | Proposed | 1,232 of 1,232 measured edits re-derive without them; normalizing with any verified set is sound |
| The validator is independent of `compile.ts` and `Tx` | Proposed | a checker that shares the pass's matcher cannot find the matcher's bugs |
| A non-derivable change is residual, never rejected | Proposed | the validator can then never reject a correct pass |
| The obligation's granularity is the function | Proposed | cases and the memo are per function and closure |
| Citations go in edits, the correspondence and statement origins | Proposed | the `algebra` edit shows that made values alone lose them |
| Existing pipelines keep version 1; new pipelines use version 3 (version 2 until it exists) | Proposed | frozen results stay frozen; recorded results keep their meaning |
| Version 2 gets memo keys before adoption | Proposed | estimated nine times version 1's checking on Candela without them |

Open questions, and who decides:

1. **The order of `reduced-width+argument` and `by-construction`** (section 19). The user's.
2. **A decision procedure: in-house, or a vendored SMT solver such as a z3-wasm build** (section 25). The user's, because a vendored solver is downloaded code.
3. **Whether `O2+` moves to version 2.** The user's or the coordinator's; recommended: no.
4. **The `audit` share during adoption** (sampling a seeded share of derived functions anyway). The user's; recommended: 1.0 during Phase 0 (shadow), 0.05 for the first pipelines under version 3, then 0.
5. **Pass and pipeline names** (`simplify-r`, `fold-r`, `O2r`, `O2v2`). The coordinator's.
6. **IRWB-005's five recommendations for version 1** (its report §15; section 10 here). The user's. None of this design depends on them: version 1 stays frozen and version 2 already carries the first three. If the first (records laid out by offset) is applied to version 1, Candela's checks under O2 change, and the Candela numbers of this guide's section 14 must be measured again.

## 30. Where to look

| question | file |
|---|---|
| How is a pass applied and gated? | `src/framework/passes/define-pass.ts` (`applyPass` :190, the contract call :279), `src/typed/program.ts` (`apply` :248) |
| What does a pass record? | `src/typed/tx.ts` (`Edit` :47, `Tx.origin` :187, `Tx.record` :202, `Tx.rewrite` :431), `src/typed/model.ts` (`Origin` :103, `TypedBlocks` :199) |
| How is provenance turned into correspondence? | `src/typed/passes.ts` (`revisionCorrespondence` :117, `typedPass` :166), `src/framework/ir/correspondence.ts` |
| What is the meaning check? | `src/typed/passes.ts` (`optimizationContract` :222), `src/typed/evaluate.ts` (`meaningKept` :587, `agrees` :554, `casesFrom` :232) |
| How is a sampled check run and memoized? | `src/framework/contracts/differential.ts` (`DifferentialSpec` :31, `prepare` :166, `runDifferential` :273, `assuranceOf` :325), `src/typed/parts.ts` (`closureKey` :241) |
| What is version 2? | `src/typed/cases-strong.ts` (IRWB-005, `meaningKeptStrong` :369) |
| What is a rule, and how is it applied and verified? | `src/typed/rules/form.ts` (`Rule` :58), `compile.ts` (`compileRules` :119), `verify.ts` (`verifyRule` :179, `Strength` :63), `evidence.ts` (`RULE_EVIDENCE` :10) |
| The measurements of this guide | this ticket's `scripts/` and `various/`, and `log/01-exact-checking-diary.md` |
| The evidence this guide builds on | IRWB-004, IRWB-005 and IRWB-006 diaries (`ttmp/2026/11/25/IRWB-00{4,5,6}--*/log/`) |

**Existing functions the implementation calls** (signatures abridged; Proposed changes are in section 28):

| function | signature | role here |
|---|---|---|
| `applyPass` | `(pass, before, { manager, contract?, contractInputs?, params? }) => Promise<PassResult>` | applies a pass; the contract receives `{ input, ...contractInputs }` and `{ output }` |
| `differential` | `(spec: DifferentialSpec) => DifferentialInvariant` | builds a sampled invariant; `baselineKey`, `subjectKey`, `decide` are optional spec fields |
| `differentialSpec` | `(inv) => DifferentialSpec` | the spec of an invariant (used by the census scripts and workers) |
| `runDifferentialAsync` | `(spec, inputs, seed?, maxCx?) => Promise<DifferentialEvidence>` | runs a spec with the memo; `setDifferentialReuse(false)` turns the memo off, `differentialStats()` counts runs and replays |
| `assuranceOf` | `(evidence) => 'checked-sampled' \| 'checked-exact'` | by `evidence.method` |
| `meaningKept`, `optimizationContract` | `(params?: MeaningParams) => …` | version 1 |
| `meaningKeptStrong`, `strongOptimizationContract` | `(params?: StrongParams) => …` | version 2 (IRWB-005) |
| `partsOf`, `partHash`, `closureKey` | `(v: TypedBlocks) => Map<fn, FunctionPart>`; `(p) => string`; `(v, fn) => string` | function parts and the memo's subject key |
| `tableBody`, `compileRules`, `evalOp` | `(rules, firings?) => body`; `(rules, firings?) => (tx) => visitor`; `(op, args) => number` | rule tables as passes; the evaluator's operator values |
| `RULE_EVIDENCE`, `ruleFingerprint`, `verifyRule` | `Record<name, RuleEvidence>`; `(rule) => string`; `(rule, opts?) => RuleEvidence` | the recorded evidence, its pin, the verifier |
| `Tx.rewrite`, `Tx.record` | `(visit, blocks?, opts?) => void`; `(kind, detail) => Edit` | where citations will be collected |
| `revisionCorrespondence` | `(before, after, edits) => CorrespondenceEntry[]` | where citations will enter the correspondence |

## 31. Glossary

| term | meaning here |
|---|---|
| edit | one record of a `Tx` method (`replace`, `remove`, …), in the pass's report, outside the hash |
| re-derivation, `normalize` | applying a rule table to an edit's before-tree in one bottom-up walk and comparing with its after-tree (section 12) |
| derived, residual | a function whose changes all re-derive; a function with any change that does not (section 17) |
| skeleton | everything about a function except its expression trees and origins (section 17) |
| semantic key, alias | a function part's key for the memo, equal to its predecessor's when the part was derived from it (section 18) |
| regional obligation | the cases that must run: those whose closure reaches a residual function |
| strength | the recorded kind of evidence for a rule, ordered in section 19 |
| citation | a token `rule:<set>/<name>@<version>#<fingerprint>` recorded by a citing pass (section 20) |
| version 1, 2, 3 | the meaning check: frozen default; IRWB-005's strong cases and divergence rule; Proposed exact part with version 2 on the residual |
