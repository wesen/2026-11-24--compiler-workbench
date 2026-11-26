---
Title: 'Intern guide: rewrite rules as verified data, and a single-assignment view of typed.blocks'
Ticket: IRWB-006
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/typed/passes.ts
      Note: simplify and fold (the passes B1 turns into tables), typedPass, PASSES, PIPELINES
    - Path: repo://src/typed/tx.ts
      Note: Tx.rewrite, origins and edits; the only way a rule may change a program
    - Path: repo://src/typed/analyses.ts
      Note: cfg, dominators, reaching definitions; what the SSA view is checked against
    - Path: repo://src/framework/ir/patterns.ts
      Note: the framework pattern language a rule's pattern converts to
    - Path: repo://src/framework/ir/rewrites.ts
      Note: the framework rewrite engine, evaluated and not used for parity reasons
    - Path: repo://src/typed/evaluate.ts
      Note: binop and the meaning check; the semantics every rule is verified against
    - Path: repo://src/typed/f32.ts
      Note: f32 semantics on bits (canonical NaN, sign operations) for f32 rule verification
ExternalSources: []
Summary: "For a new intern: the parts of the IR Workbench that IRWB-006 touches (typed.blocks, Tx, provenance, the gates, analyses, the framework rule engine), then the design of three items: simplify and fold as rule tables that reproduce today's revisions exactly (B1), a verifier that records soundness evidence for every rule once (B2), and a single-assignment view of typed.blocks built by dominance frontiers and renaming, validated against reaching definitions, with sparse conditional constant propagation as its first consumer (A1, A2)."
LastUpdated: 2026-11-25T23:59:00-05:00
WhatFor: "Onboarding for IRWB-006 and the reference for its implementation."
WhenToUse: "Before changing simplify, fold, the rule tables, the verifier, the SSA analysis or SCCP."
---

# Intern guide: rewrite rules as verified data, and a single-assignment view of `typed.blocks`

This guide prepares you to work on milestone IRWB-006 of the IR Workbench. The milestone has three items. The first turns the algebraic identities of the `simplify` pass, and the constant-folding cases of `fold`, into a **table of rules**: data that the workbench can list, each rule with a name, a pattern, a guard and a replacement. The second gives every rule **recorded evidence** that it is sound for every input of its declared types, obtained once, independently of any program. The third adds a **single-assignment view** of the compiler's main intermediate representation, in which every assignment has its own name and every read refers to exactly one of them, and uses it in a first sparse optimization.

The guide has five parts. Part 1 explains the parts of the existing system that the milestone depends on, from the code; you need all of it before Parts 2 to 4 make sense. Part 2 designs the rule tables (agenda item B1), Part 3 the verifier (B2), Part 4 the single-assignment view (A1) and its consumer (a first piece of A2). Part 5 is the implementation plan, the tests and the acceptance measurements.

Three conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `420d8e1`, which this guide was written against. Line numbers drift; the symbol named next to them does not.
- **Part 1 describes code that exists.** Interfaces that do not exist yet are marked **Proposed**. Their names are the ones the implementation is expected to use, but an implementer may refine them.
- **The agenda items are those of the IRWB-002 guide** (`ttmp/2026/11/24/IRWB-002--research-agenda-*/design-doc/01-*.md`, Part 2). This guide is self-contained, but that document has the wider context.

# Part 1: The parts of the system you need

## 1. The compiler in one page

The IR Workbench compiles **Typed**, a statically typed subset of JavaScript, to **RV32** machine code (32-bit RISC-V). A vendored front end parses and type-checks the source and emits stack-machine code; `src/typed/lift.ts` lifts that into the main intermediate representation, `typed.blocks`. Optimization passes then turn one revision of the program into the next, and a backend (`src/typed/backend/`) lowers the final revision to an image of machine code.

```text
 main.typed ──front end──► tape ──lift──► typed.blocks r0
                                              │ pass ──► r1 ──► r2 ──► … ──► rN
                                              │        each checked against r0
                                              ▼
                                         rv32.image  (machine code)
```

Two properties of this compiler matter more than any other for this milestone.

The first is that **every pass application is checked**. The framework applies a pass only through `applyPass` (`src/framework/passes/define-pass.ts:190`), which diffs the result against its input, verifies that the pass changed only the kinds of entity it declared, runs the **meaning check** (the new revision must behave like r0 on generated inputs), and verifies the pass's claims about which analyses it leaves valid. A pass that produces a wrong program is rejected, and nothing is published.

The second is that **O2 and the book's numbers are frozen**. The corpus (`corpus/projects/`, 44 projects, 70 functions) comes with a book (`corpus/book/`) from the prototype this compiler was ported from, and the book states exact numbers: revision counts, statement counts, image sizes, instruction counts, and the provenance tree of particular statements node for node. Those numbers are tests. The standard pipeline `O2` must keep producing exactly the same revisions. Four commands guard this; Part 5 lists them. Everything this milestone adds must either reproduce today's revisions bit for bit (B1) or appear in a new pass and a new pipeline (A2).

## 2. `typed.blocks`: what a program is

`typed.blocks` is a **control-flow graph whose statements hold expression trees**. Its types are in `src/typed/model.ts`; its validator and its adapter to the framework are in `src/typed/ir.ts`.

- A **function** `fn:NAME` has parameters, a result type, an array of **locals** and an ordered array of blocks (`FnRec`, `model.ts:123`). Parameters are locals too: the first locals of the array, with `param: true`. A local is identified by its index in the array.
- A **block** `bb:NAME.N` has an ordered array of statement ids and an array of successor block ids (`BlockRec`, `model.ts:137`). The first block of the function is its entry. The last statement of a block is a terminator.
- A **statement** `s:NAME.N` is one of eight operations (`StmtRec`, `model.ts:146`): `set` (assign a value to a local), `store` (write memory), `eval` (evaluate for effect), `br` (jump), `br_if` (branch on a condition), `return`, `trap`, and `zero` (clear part of a frame array). A statement refers to its value trees through the fields `value`, `cond` and `addr`, and to blocks through `to`, `then` and `else`.
- A **value** `v:NAME.N` is one node of an expression tree (`ValueRec`, `model.ts:166`): an operator `op`, an array of operand ids `args`, an optional immediate `imm` (the number of a constant, the index of the local a `get` reads, an offset), and an optional `type: 'f32'` (absent means i32).

Here is the running example of this guide, `corpus/projects/blend/main.typed`, as lifted (r0). Each line is a statement with its id, printed by `listing` (`src/typed/listing.ts`):

```text
function blend(work: buffer, n: i32, a: i32, b: i32): i32
bb:blend.0  -> [.1]
    s:blend.0    scale = (4 * 16)
    s:blend.1    s = 0
    s:blend.2    i = 0
    s:blend.3    goto .1
bb:blend.1  -> [.2, .3]
    s:blend.4    if !((i < n)) goto .2 else .3
bb:blend.2  -> []
    s:blend.14   return (s / 8)
bb:blend.3  -> [.4, .5]
    s:blend.5    t7 = i
    s:blend.6    if (t7 >=u load32[work+0]) goto .4 else .5
bb:blend.4  -> []
    s:blend.7    trap
bb:blend.5  -> [.7]
    s:blend.9    goto .7
bb:blend.7  -> [.1]
    s:blend.10   s = (s + (load16[(work + (t7 << 1))+4] * ((a * b) + scale)))
    s:blend.11   i = (i + 1)
    s:blend.12   goto .1
```

The locals of `blend` are `work`, `n`, `a`, `b` (the parameters, indices 0 to 3), then `scale`, `s`, `i` and `t7`. The condition of `s:blend.4` is a tree of three values: an `eqz` (logical not, printed `!`) whose operand is an `lt` whose operands are two `get` values, one reading `i` and one reading `n`.

Three properties of this representation shape everything in Parts 2 to 4.

**Locals are mutable.** `s` and `i` are assigned in two places each. To know which assignment a read of `i` sees, the compiler must ask an analysis (section 6). This is what the single-assignment view of Part 4 changes, without changing the representation itself.

**A value has exactly one user.** Trees are not shared. The same subexpression written twice is two trees with different ids. A rule that rewrites a tree therefore changes nothing outside that tree, which is what makes a rewrite rule a local operation.

**Ids come from counters stored in the artifact.** `Store.fresh(prefix)` (`model.ts:232`) returns `prefix.N` and increments a counter; the counters are part of the native value (`TypedBlocks.counters`, `model.ts:202`) and therefore part of the revision hash. Running the same pass twice on the same revision allocates the same ids. The consequence for B1 is severe and simple: a table-driven `simplify` produces identical revisions only if it allocates exactly the same ids, **in the same order**, as the hand-written one.

Passes never edit the frozen native value. `Store.from(native)` (`model.ts:254`) makes a mutable working copy; a pass edits it through a transaction; `store.toNative()` (`model.ts:296`) writes back only the live entities, with ids sorted, so equal programs encode equally.

## 3. How a pass changes a program: `typedPass` and `Tx`

### 3.1 `typedPass`

The Typed passes are written with `typedPass(spec)` (`src/typed/passes.ts:165`), a thin wrapper around the framework's `definePass`. A spec names the pass, the analyses it reads (`needs`), the kinds of thing it writes (`writes`: any of `values`, `stmts`, `locals`, `cfg`), the analyses it claims to preserve, and a `body`. The wrapper's `run` makes a working `Store`, and **for every function** builds the fact views the pass asked for and a fresh transaction `tx`, calls `body({ st, f, tx, facts, params })`, and commits the transaction. If any transaction made an edit, `run` returns the new native value, a correspondence (section 4) and an edit report.

Here is `simplify` as it is today (`passes.ts:307`), abridged to three of its cases:

```ts
export const simplify = typedPass({
  name: 'simplify',
  about: 'algebraic identities: x+0, x*1, x*2^k, x-x, !!x and inverted comparisons',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body: ({ tx }) =>
    tx.rewrite(v => {
      if (F32_OPERANDS.has(v.op) || F32_RESULT.has(v.op)) return;
      const [a, b] = v.args,
        k = b && b.isConst ? (b.imm as number) : null,
        ka = a && a.isConst ? (a.imm as number) : null;
      const note = (text: string) => ({ because: v.args.filter(x => x.isConst), note: text });
      switch (v.op) {
        case 'add':
          if (k === 0) return a.id;                         // x + 0  ->  x
          if (ka === 0) return b.id;                        // 0 + x  ->  x
          break;
        case 'mul':
          // … x*1, 1*x, x*0, 0*x …
          if (k !== null && isPow2(k))                      // x * 2^j  ->  x << j
            return tx.make('shl', a.id, tx.const(log2(k)), note(`x * ${k} = x << ${log2(k)}`));
          break;
        case 'eqz':                                         // !(a < b)  ->  a >= b, and seven more
          // … inv = { lt: 'ge', ge: 'lt', … }
          if (inv[a.op]) return tx.make(inv[a.op], a.args[0].id, a.args[1].id,
                                        { note: `!(${SYMBOL[a.op]}) is ${SYMBOL[inv[a.op]]}` });
          // …
      }
    }),
});
```

Notice three things. The pass is a single callback inside `tx.rewrite`. The callback either returns nothing (no change), an **existing** id (an operand of the matched node: the node disappears and its operand takes its place), or the id of a value it has just **made** with `tx.const` or `tx.make`. And the made values carry provenance in an options object: `because` (which entities justify the change) and `note` (a sentence).

### 3.2 The transaction

`Tx` (`src/typed/tx.ts:165`) is the only way a pass changes the working store. Its methods create values (`const`, `make`, `get`), locals (`local`), statements (`set`, `stmt`, `insert`, `remove`, `move`, `replaceStmt`), blocks (`block`), and rewrite trees (`rewrite`, `replace`). Two rules make it more than a convenience:

- **Every method checks the declared write kinds.** `simplify` declares `writes: ['values']`; if its body called `tx.remove`, the transaction would throw `TxError('undeclaredWrite')`.
- **Every created entity gets an origin.** `Tx.origin` (`tx.ts:187`) writes `{ from, via, kind: 'recorded', rev, because, note }`: what the entity was made from, by which pass (`via`), at which revision, which entities or facts make the change valid (`because`), and an optional note.

For a rule table, the method that matters is `Tx.rewrite(visit, blocks?, opts?)` (`tx.ts:431`). Read its body; the whole of B1 depends on it.

```text
Tx.rewrite(visit):
  for each block b, for each statement s of b, for each field k in [value, cond, addr]:
      n <- walk(s[k])
      if n != s[k]:  record edit { kind: 'replace', stmt: s, field: k, from: s[k], to: n, text }
                     s[k] <- n

  walk(vid):                                   bottom-up
      args <- [walk(a) for a in vid.args]
      cur  <- vid
      if some arg changed:
          cur <- a fresh copy of vid with the new args
                 origin { from: vid, via: pass, note: 'rebuilt around a changed argument' }
      this.cur <- cur                          # the origin `from` of anything made in visit
      r <- visit(handle(cur))
      return r ?? cur
```

Three consequences follow, and each is a requirement on the rule table.

1. **The visitor sees the rebuilt node.** When `walk` reaches the `eqz` of `s:blend.4`, its operand has already been visited. A rule therefore matches against a tree whose subtrees have already been simplified.
2. **Anything made inside the visitor has `from: this.cur`,** the id of the node being visited, unless the options say otherwise. A rule's replacement must be made inside the visitor so that its origins are the same.
3. **Ids are allocated in call order.** In `tx.make('shl', a.id, tx.const(log2(k)), note(…))` JavaScript evaluates the arguments first, so the constant receives `v:f.N` and the shift `v:f.N+1`. A replacement template must create its innermost values first, left to right.

The `visit` callback receives a `ValueHandle` (`tx.ts:78`, built by `valueHandle`, `tx.ts:120`): `id`, `op`, `imm`, `args` (as handles), and the predicates `isConst`, `isPure`, `hasEffect`, `isBoolean` (the operator is a comparison, so the value is 0 or 1) and `same(other)`. `same` is **structural** equality (`sameTree`, `tx.ts:95`: equal operator, immediate, type and, recursively, operands), not identity: two operands of one node are always different entities, because a value has one user.

### 3.3 A worked trace: `simplify` on Blend

In O2, `simplify` first changes Blend at r3. It makes one edit, recorded as:

```json
{"id":"edit:r3.0","rev":3,"pass":"simplify","fn":"blend","kind":"replace",
 "stmt":"s:blend.4","field":"cond","from":"v:blend.8","to":"v:blend.35",
 "text":"(i >= n)","because":[]}
```

The walk visits the `get i`, the `get n` and the `lt` (no case applies), then the `eqz` whose operand is `lt`. The `eqz` case finds `inv.lt = 'ge'` and calls `tx.make('ge', <get i>, <get n>, { note: '!(<) is >=' })`. That allocates `v:blend.35` with origin `{ from: 'v:blend.8', via: 'simplify', rev: 3, because: [], note: '!(<) is >=' }`. The two `get` values are reused: they are now operands of `v:blend.35`, and the `eqz` and the `lt` are no longer reachable, so `toNative` drops them.

## 4. Provenance: `origin`, `because` and `why`

Provenance answers the question "why does this entity exist?" for any entity of any revision. Two mechanisms carry it.

**Origins in the native value.** `Program.why(id)` (`src/typed/program.ts:457`) follows `origin[0].from` and each entry of `origin[0].because` recursively and builds a tree. For Blend after O2 (from the IRWB-002 guide, §11):

```text
s:blend.15  inv = ((a * b) + 64)        live · via licm · r6 · hoisted out of loop@bb:blend.1
  made from v:blend.37  ((a * b) + 64)  live · via constprop · r4 · rebuilt around a changed arg
    made from v:blend.25  ((a * b) + scale)   detached · via ingest
      made from op:blend#35  i32.add (line 5)
  because loop:blend@bb:blend.1
```

**Correspondence in the framework.** `revisionCorrespondence(before, after, edits)` (`passes.ts:116`) groups new entities under their origin's `from` and collects each removal's `because`; the framework completes this into a relation between the entities of two revisions, and `Program.whyChain` walks a chain of them (`whyEntity`, `src/framework/ir/correspondence.ts:303`).

What this means for B1 is a useful simplification. **The `why` tree is a function of the chain of revisions.** Everything `why` reads (origins, ids, counters) is inside the native values of the revisions, and `Program.lookup` (`program.ts:421`) resolves an id that no longer exists at the head by searching the earlier revisions of the same chain. A revision hash is a SHA-256 of the canonical encoding of the whole native value (`fingerprint`, `src/framework/core/data.ts`). So if the table-driven `simplify` produces, at every step, a revision with the same hash as the hand-written one, every revision of the chain is the same value, and every `why` tree is identical node for node. The correspondences are identical too, because `revisionCorrespondence` is computed from the two native values and the edit list. The equivalence check of B1 therefore compares revision hashes, and in addition the canonical encoding of each edit list, which carries the edit `text` and is not part of the revision.

## 5. The gates, and what "frozen" means

`applyPass(pass, before, options)` (`define-pass.ts:190`) runs the pass, freezes and hashes its result, and returns it as the next revision only after these stages succeed:

```text
facts   <- the analyses the pass needs, for `before` (cached per revision hash)
result  <- pass.run(...)
after   <- validate, freeze, hash result.native
changes <- diff(projection(before), projection(after))
if no change:                                 return { changed: false }
if changes touch undeclared kinds:            throw PassError('undeclaredWrite')
if a contract is given and it fails:          throw PassError('contractRejected')
for each analysis A the pass claims to preserve, if A is cached for `before`:
    A's transfer verifier, or recompute and compare; on difference throw PassError('preserveViolated')
```

The contract is `optimizationContract` (`passes.ts:221`), which wraps the **meaning check** `meaningKept` (`src/typed/evaluate.ts:564`): evaluate r0 and the candidate on the same generated cases for every function and compare them with `agrees` (`evaluate.ts:531`): a trap agrees with any trap; otherwise the results and the written memory must be equal. The check is sampled. It establishes agreement on the cases it ran and nothing more; how strong that is depends on the case distribution, which IRWB-005 is measuring. This is the reason B2 exists: a rule verified once, for all inputs of its types, does not depend on whether some program happened to exercise its counterexample.

"Frozen" means that these four commands give the same results before and after this milestone:

| command | what it checks |
|---|---|
| `npm test` | the build and every `tests/**/*.test.mjs` |
| `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs` | the whole corpus: 44 projects, 7,000 cases, 6,986 agree and 14 hit the step limit; every project's O2 image, 5,160 bytes in total against the reference compiler's 7,628 |
| `node tools/parity.mjs` | the corpus against the book's totals |
| `node ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs` | every project's r0, every O2 revision and the O2 image, as 12-digit hashes; diffed against the baseline recorded at the start (`various/01-baseline-corpus-revisions.txt` in this ticket) |

## 6. Analyses and facts

An **analysis** is a versioned function from an artifact to a JSON value, declared with `defineAnalysis` (`src/framework/contracts/definitions.ts:86`). The `AnalysisManager` caches each result under the exact revision hash it was computed for, so a fact can never be stale. The six Typed analyses are collected in `ANALYSES` (`src/typed/analyses.ts:539`). Three of them are the background of Part 4.

**The control-flow graph.** `cfgOf(f)` (`analyses.ts:75`) returns, per function, the successors and predecessors of each block and the **reverse postorder** of the blocks reachable from the entry: a depth-first search from the entry, listing each block after all its successors, reversed. In reverse postorder every block comes before its successors except along back edges. For Blend at r0 it is `bb.0, bb.1, bb.3, bb.5, bb.7, bb.4, bb.2`.

**Dominators.** Block `a` **dominates** block `b` if every path from the entry to `b` passes through `a`. The **immediate dominator** `idom(b)` is the closest strict dominator of `b`; the immediate dominators form a tree rooted at the entry, the **dominator tree**. `dominatorsOf(f)` (`analyses.ts:140`) computes `idom` with the iterative algorithm of Cooper, Harvey and Kennedy, and `domView` (`analyses.ts:174`) adds `dominates(a, b)` and the tree's `children`. For Blend at r0:

```text
 control-flow graph                       dominator tree
                                          
        bb.0                                   bb.0
          │                                      │
   ┌───► bb.1 ───────┐                          bb.1
   │      │          │                         /    \
   │     bb.3       bb.2 (return)            bb.3   bb.2
   │    /    \                               /   \
   │  bb.4   bb.5                          bb.5  bb.4
   │ (trap)   │                              │
   │         bb.7                           bb.7
   └──────────┘
```

**Reaching definitions.** A **definition** of a local is a point where it receives a value. In `typed.blocks` there are two kinds: a `set` statement, identified by its statement id, and the value the local has at function entry, identified as `param:i` for a parameter and `init:i` for any other local (which starts at 0). A definition `d` of local `l` **reaches** a program point `p` if some path from `d` to `p` contains no other definition of `l`. `reachingAnalysis` (`analyses.ts:337`) computes this as a forward dataflow problem over sets of definition ids: the set at the entry is every `param:i` and `init:i`; a `set` of `l` kills the other definitions of `l` and adds itself.

The dataflow solver (`solve`, `src/framework/dataflow/solver.ts:90`) visits only blocks reachable from the entry, and at the entry it joins the boundary set with whatever flows in along edges into the entry (a loop whose header is the entry block). Remember both details; section 18 depends on them.

Facts are stored per block, but passes ask per statement. `reachView(result, st, fname)` (`analyses.ts:360`) replays the transfer function from each block's entry and answers `reachingAt(stmt, local)`: the definitions of `local` that reach the point just before `stmt` executes. `constprop` (`passes.ts:375`) is its main client: a `get` whose reaching definitions all assign the same constant is replaced by that constant.

```text
reachingAt(s:blend.5, 6)   = [ s:blend.11, s:blend.2 ]      local 6 is i: i = i + 1 in bb.7, i = 0 in bb.0
reachingAt(s:blend.14, 5)  = [ s:blend.1, s:blend.10 ]      local 5 is s
reachingAt(s:blend.4, 1)   = [ param:1 ]                    local 1 is the parameter n
```

(The order of the definitions is the iteration order of a set; treat the result as a set.)

The cost of this design is that every question of the form "which assignment does this read see" is a replay of a block's transfer function, and the inverse question, "who reads this assignment", has no fact at all.

## 7. The framework's pattern language and rewrite engine

The framework has a rule engine that no Typed pass uses. It has two parts.

**Patterns** (`src/framework/ir/patterns.ts`) are finite data. A `NodePattern` is one of `entity(kind?, attributes?)`, `op(name, ...operands)` (an entity whose adapter `operation` has this name and whose operands match), `capture(name, inner)` and `sameAs(name)`. Conditions over captures include `distinct`, `equalContent`, `relation` and `where(predicate)`, the last naming a versioned predicate in a registry. `blocksAdapter` (`src/typed/ir.ts:505`) implements `operation` (`ir.ts:533`), so `op('add', capture('x'), entity('value.const', { imm: 0 }))` is a valid pattern over a `typed.blocks` projection.

**Rewrites** (`src/framework/ir/rewrites.ts`) pair a pattern with an optional guard and a `replace` callback (`rewrite(definition)`, `rewrites.ts:57`). Seven schedules apply them (`applyOnce`, `applyAll`, `topDown`, `bottomUp`, `innermost`, `outermost`, `saturate`); `executeRewrites` (`rewrites.ts:331`) runs one. Each application opens an edit on the projected graph and publishes a new artifact.

Three properties of the engine decide how B1 can use it, and section 12 draws the conclusion.

- **It works on the projection, one artifact per application.** On Candela (about 235,000 records) projecting and hashing a revision costs seconds; IRWB-001 measured 18 s for a pass that changes nothing. `simplify` makes hundreds of rewrites on Candela.
- **Its edits do not go through `Tx`.** New entities are created by graph edits, so their ids do not come from the store's counters, and they carry no Typed `origin`. A revision produced this way cannot equal today's.
- **Its notion of equality differs from `simplify`'s.** `sameAs(x)` binds the *same entity* again, and `equalContent` compares one entity's kind and attributes (which include its `origin`), not a subtree. `simplify`'s `x - x` needs structural equality of two different subtrees (`sameTree`).

# Part 2: Rewrite rules as data (B1)

The three items depend on each other in one direction. B1 turns rewrites into data; B2 can verify a rule only once it is data, because a verifier needs the pattern and the replacement as objects it can evaluate, not as code inside a `switch`. A1 is independent of both: it changes how passes find definitions, not how they rewrite trees. Its consumer, SCCP, is a new pass that uses `fold`'s operator semantics, which B1 has by then turned into rules.

```text
 B1  rule form ──► compiled visitor ──► simplify, fold   (identical revisions)
        │
        └──────► B2 verifier ──► evidence per rule        (once, for all inputs)

 A1  dominators ──► frontiers ──► phis ──► renaming ──► typed.ssa  ──checked against──► typed.reaching
                                                            │
                                                            └──► SCCP ──► pipeline O2-sccp
```

## 8. What a rule is

A **rewrite rule** says: wherever a value tree has this shape, and this condition holds, it may be replaced by that tree. It has four parts.

- A **name**, such as `mul-pow2`, and a version. The name is what the workbench lists and what evidence (Part 3) is filed under.
- A **pattern**, the shape on the left-hand side: `mul(x, k)`. A pattern is an operator applied to sub-patterns. A sub-pattern is a **variable** (`x`: any value tree, bound to it), a **constant literal** (`0`: a `const` value with that immediate), a **constant variable** (`k`: any `const` value, binding `k` to its immediate), a **repeat** of a variable (`sameAs x`: a tree structurally equal to the one bound to `x`), or a nested operator pattern (`eqz(lt(a, b))`).
- A **guard**, a list of conditions on the bindings that the shape cannot express: `pow2(k)` (k is a positive power of two), `pure(x)` (the tree bound to `x` can be evaluated or discarded without effect), `boolean(x)` (the tree bound to `x` is a comparison, so its value is 0 or 1), and for constant folding, `noTrap(a, b)` (the operator would not trap on these constants).
- A **replacement**, the right-hand side, as a template: a variable (return the bound tree's id: no new value), a constant computed from the bindings (`0`, `log2(k)`, or the operator evaluated on constants), or an operator applied to sub-templates.

A rule also carries **side conditions** that are not about shape, and Part 3 checks each of them:

- **Types.** Every variable has a declared type, i32 or f32, determined by the operators it is an operand of. The two sides must have the same result type. An i32 rule must never match an f32 operator; in `typed.blocks` this is guaranteed by the operator names (`add` and `fadd` are different operators) and by the validator, which types every operand (`checkTypes`, `ir.ts:158`).
- **Traps and effects.** A variable stands for a whole subtree, which may trap (a division by zero), read memory or call a function. A rule that drops a variable (`x * 0 → 0`), duplicates it, or reorders two variables changes when or whether those effects happen. Such a rule is sound only with `pure` on the variables concerned.
- **Widths.** A rule's constants and guards are stated at 32 bits. Some evidence in Part 3 is obtained at a reduced width; that requires the rule to be **width-generic**: its constants must be expressible at any width (0, 1, all ones, a power of two given by a guard), not literals such as 255.
- **Provenance.** To reproduce today's revisions, a rule also states what `because` and `note` its outermost made value carries. In `simplify` that is either nothing, or `because` = the constant operands of the matched node in order (the `note(text)` helper), with a note that may mention the bindings (`x * 8 = x << 3`).

## 9. The rule form (Proposed)

The rule form is plain data, JSON-serializable, written with a few builder functions. It lives in `src/typed/rules/form.ts`.

```ts
// Proposed: src/typed/rules/form.ts
export type Pat =
  | { readonly var: string }                       // any tree; binds the name
  | { readonly const: number }                     // a const value with this immediate
  | { readonly constVar: string }                  // any const value; binds its immediate
  | { readonly same: string }                      // structurally equal to an earlier variable
  | { readonly op: ValueOp; readonly args: readonly Pat[] };

export type Guard =
  | { readonly pure: string }                      // isPure(st, binding)
  | { readonly pow2: string }                      // a constVar that is 2^j, 0 <= j <= 30
  | { readonly boolean: string }                   // the binding's operator is a comparison
  | { readonly noTrap: readonly [string, string]; readonly op: 'div' | 'rem' };

export type Num =                                  // a number computed from constVar bindings
  | number | { readonly of: string } | { readonly log2: string }
  | { readonly eval: ValueOp; readonly args: readonly string[] };   // fold: the operator's value

export type Tpl =
  | { readonly var: string }                       // the bound tree itself
  | { readonly const: Num; readonly type?: 'f32' } // tx.const
  | { readonly op: ValueOp; readonly args: readonly Tpl[] };        // tx.make, children first

export interface Rule {
  readonly name: string;  readonly version: string;  readonly about: string;
  readonly types: Readonly<Record<string, 'i32' | 'f32' | 'bool'>>;  // declared variable types
  readonly lhs: Pat & { op: ValueOp };
  readonly where?: readonly Guard[];
  readonly rhs: Tpl;
  readonly because?: 'const-args' | 'args';        // the outermost made value's because
  readonly note?: string;                          // with {k} and {log2 k} placeholders
}
```

A few rules of `simplify`, written in this form (builders `rule`, `op`, `v`, `c`, `kv`, `same` produce the objects above):

```ts
// Proposed: src/typed/rules/simplify.ts (excerpt)
rule('add-zero',   { x: 'i32' }, op('add', v('x'), c(0)), v('x')),
rule('sub-self',   { x: 'i32' }, op('sub', v('x'), same('x')), c(0),
     { where: [{ pure: 'x' }], because: 'const-args', note: 'x - x' }),
rule('mul-pow2',   { x: 'i32', k: 'i32' }, op('mul', v('x'), kv('k')),
     op('shl', v('x'), c({ log2: 'k' })),
     { where: [{ pow2: 'k' }], because: 'const-args', note: 'x * {k} = x << {log2 k}' }),
rule('not-lt',     { a: 'i32', b: 'i32' }, op('eqz', op('lt', v('a'), v('b'))),
     op('ge', v('a'), v('b')), { note: '!(<) is >=' }),
rule('not-not',    { x: 'bool' }, op('eqz', op('eqz', v('x'))), v('x'),
     { where: [{ boolean: 'x' }] }),
```

The full table for `simplify` has 27 rules: two for `add` (`x + 0`, `0 + x`), two for `sub`, six for `mul`, one for `div`, one each for `or`, `xor`, `shl`, `shr`, `shru` with a zero right operand, two for `and`, eight comparison inversions and `not-not`. Their order inside each root operator is the order of the `return` sites in today's `switch` (diary step 2 lists them).

Two details of the form exist only to reproduce today's code exactly, and the implementation must not "improve" them:

- `because: 'const-args'` means `v.args.filter(a => a.isConst)` of the **matched node** (its top-level operands), in operand order, even when the rule's pattern does not mention those constants as such. `sub-self` on `sub(5, 5)` therefore records both constants.
- The `because` and `note` apply to the **outermost** made value only. The inner constant of `mul-pow2` is made with no `because` and no `note`, exactly as `tx.const(log2(k))` is today.

## 10. Applying a table: the rule compiler (Proposed)

`compileRules(rules)` (Proposed, `src/typed/rules/compile.ts`) turns a table into a function from a transaction to a `Tx.rewrite` visitor. It indexes the rules by the operator of their pattern's root, keeping table order within each operator:

```text
compileRules(rules):
  index <- map from root operator to [rules with that root, in table order]
  return tx => (v: ValueHandle) => {
      for rule in index[v.op] ?? []:
          b <- match(rule.lhs, v, {})                 # bindings, or null
          if b and every guard holds for b:
              count[rule.name]++
              return instantiate(rule.rhs, b, tx, provenance(rule, v, b))
      return undefined                                # no rule: keep the node
  }

match(p, h, b):
  { var: x }       -> b[x] = h; ok
  { const: n }     -> h.isConst and h.imm === n
  { constVar: k }  -> h.isConst; b[k] = h (its imm is the number)
  { same: x }      -> h.same(b[x])                    # sameTree: structural
  { op, args }     -> h.op === op and len equal and every match(args[i], h.args[i], b)

instantiate(t, b, tx, prov):                          # prov only for the outermost value
  { var: x }       -> return b[x].id                  # existing value, no allocation
  { const: n }     -> return tx.const(num(n, b), { type, ...prov })
  { op, args }     -> ids <- [instantiate(a, b, tx, {}) for a in args]   # children first
                      return tx.make(op, ...ids, prov)
```

The body of the table-driven pass is then one line, `({ tx }) => tx.rewrite(visitor(tx))`, and it is called inside the same `typedPass` spec as today (name `simplify`, `writes: ['values']`, the same `preserves`). The name matters: it becomes `via` in every origin.

Why does this reproduce the hand-written pass exactly? Because each step corresponds to one property established in section 3:

- The traversal is the same `Tx.rewrite`, so the order in which nodes are visited, the rebuilt copies and their ids are the same.
- `simplify` dispatches on `v.op` and, within a case, returns at the first condition that holds. The index by root operator with first match in table order is the same decision procedure, provided the table lists the cases in the same order. (Across operators, order cannot matter: a node has one operator.)
- `instantiate` calls `tx.const` and `tx.make` inside the visitor, children first and left to right, so the ids, the `from` (`this.cur`) and the counters are the same.
- The guards call the same predicates: `isPure(st, id)`, `sameTree`, `COMPARE.has(op)`, and `isPow2` as `simplify` defines it (`n > 0 && (n & (n - 1)) === 0`, `passes.ts:247`), which excludes −2³¹.
- `simplify`'s first line returns early for any f32 operator. No rule of the table has an f32 root operator, so the index never offers one; the early return is implied, and the table records it as a property of the rule set rather than as a rule.

The compiler can also count how often each rule fires, into a table the caller supplies. The counts are not written into the pass's edit report, so the pass's result stays what it is today; a measurement script supplies the table and produces the firing counts over the corpus and Candela that the agenda's acceptance for B1 asks for, including the rules that never fire.

## 11. `fold` as a table

`fold` (`passes.ts:279`) has three cases: `eqz` of a constant; an f32 operator from `F32_FOLDABLE` whose operands are all constants, evaluated by `f32Op`; and an integer operator from `FOLDABLE` whose operands are constants, evaluated by `binop`, except a division or remainder by zero or of −2³¹ by −1, which is kept so that the program still traps. In the rule form each case becomes one rule per operator:

```ts
rule('fold-add',  { a: 'i32', b: 'i32' }, op('add', kv('a'), kv('b')),
     c({ eval: 'add', args: ['a', 'b'] }), { because: 'args' }),
rule('fold-div',  { a: 'i32', b: 'i32' }, op('div', kv('a'), kv('b')),
     c({ eval: 'div', args: ['a', 'b'] }), { where: [{ noTrap: ['a', 'b'], op: 'div' }], because: 'args' }),
rule('fold-fadd', { a: 'f32', b: 'f32' }, op('fadd', kv('a'), kv('b')),
     c({ eval: 'fadd', args: ['a', 'b'] }, 'f32'), { because: 'args' }),
```

The three cases are mutually exclusive by operator (`eqz` is in neither set, and the two sets are disjoint), so per-operator rules are order-independent. `because: 'args'` is all operands of the matched node, which is what `fold` records. The `{ eval }` number is computed by the evaluator's own functions, `binop` (`evaluate.ts:266`) and `f32Op` (`f32.ts`), so a folded constant is by construction the value the evaluator would compute; Part 3 explains what that does and does not establish.

## 12. Proving equivalence, and when to switch

The hand-written `simplify` stays in place until equivalence is shown. The procedure:

1. Build the table-driven pass under the same name in a new module (`src/typed/rules/passes.ts`, Proposed) that imports `typedPass`. `src/typed/passes.ts` does not import that module, so there is no import cycle.
2. **Corpus.** For every project and every pipeline that contains `simplify` (`O1`, `O2`, `O2+`, `loops`, `checks`), run the pipeline twice: once with the hand-written pass, once with the table pass in its place. At each `simplify` step compare the revision hash, and the canonical encoding of the edit list. Comparing every pipeline matters: `loops` and `checks` run `simplify` before any `fold`, so they exercise the `because`-of-two-constants path that O2 does not.
3. **Candela.** Run O2 once, and at each `simplify` step apply both passes to the same input revision and compare. A single Candela process does both, sequentially.
4. **Switch only on complete equality.** If every compared revision is identical, replace the bodies of `simplify` (and `fold`) in `passes.ts` with the compiled tables. Keep the hand-written bodies in a reference module (`src/typed/rules/handwritten.ts`, Proposed) so a test can keep comparing the two on the corpus.

After the switch, the four frozen commands of section 5 must still pass, and the corpus revisions must equal the baseline.

The framework engine is also evaluated by a measurement rather than by argument alone. `toNodePattern(rule)` (Proposed) converts a rule's pattern to a framework `NodePattern` (a variable becomes `capture`, a constant literal `entity('value.const', { imm })`, an operator `op`); `searchPattern` then counts matches on each corpus project's r0 projection. For rules whose guards are only constants and operators, these counts must equal the compiled matcher's on the same revisions; for `sub-self` they cannot, because the framework has no structural repetition. The script records both counts and the time of each matcher.

**Decision: rules are applied through `Tx.rewrite`, not through the framework's engine.** Context: the framework has a rule engine (section 7). Alternatives: (a) express each rule as a framework `RewriteRule` and run a schedule; (b) compile the rule form to a `Tx.rewrite` visitor. Decision: (b), with a conversion of the pattern part to the framework's `NodePattern` for listing and cross-checking. Rationale: (a) cannot produce identical revisions (ids, origins, counters) and publishes one artifact per application; it also cannot express structural repetition. Consequence: the rule form, not the engine, is the shared asset; a later item (B4, equality saturation) can compile the same rules to a third target.

# Part 3: Verifying a rule once (B2)

## 13. What a rule claims

A rule `L → R` with guard `G` claims: **for every assignment of values to its variables that satisfies `G`, evaluating `R` gives the same outcome as evaluating `L`**. "Outcome" is the meaning check's notion: a value, or a trap. The claim is about values of the declared types, not about any program. If it holds, every application of the rule in every program is correct, and the meaning check's sampling is not what stands between the rule and a wrong program.

The semantics are the evaluator's, because the evaluator is the specification (it was checked against the reference compiler's images on 6,986 corpus cases and 33,200 Candela cases):

- i32 operators: `binop(op, a, b)` (`evaluate.ts:266`), which throws `Trap` on division by zero and on −2³¹ / −1; shift counts are masked to five bits (`MASK = 31`, `evaluate.ts:265`).
- f32 operators: `f32Op` (`src/typed/f32.ts`), on IEEE bit patterns carried as i32. Arithmetic rounds to nearest even and returns the **canonical NaN** `0x7fc00000` for any NaN result; `fneg`, `fabs` and `fcopysign` change only the sign bit and keep NaN payloads; comparisons are false on a NaN except `fne`.

For reduced-width checking, the verifier needs the integer operators at width `w` (Proposed: `binopW(op, a, b, w)` in `src/typed/rules/semantics.ts`): values are `w`-bit two's complement integers, results wrap to `w` bits, shift counts are masked to `log2 w` bits, the trap conditions use −2^(w−1). At `w = 32` `binopW` must equal `binop` exactly; a test checks it on boundary values and random pairs.

## 14. Structural checks: effects, traps, types

Before any evaluation, the verifier checks the rule's form.

- **Effects.** Every variable that occurs on the left but not on the right (dropped), more often on the right than on the left (duplicated), or in a different relative order (reordered) must carry a `pure` guard. Otherwise the rule is rejected without evaluation. `x * 0 → 0` without `pure(x)` is rejected here: with `x` bound to `div(a, 0)` the left side traps and the right side does not. A repeat (`same x`) counts as an occurrence of `x`, so `x - x → 0` drops `x` twice and needs `pure(x)`, which it has. Constant variables (`k` in `mul(x, k)`) are constants and have no effects.
- **Traps.** Both sides are evaluated with trap semantics: an outcome is a value or `TRAP`. The rule is sound only if, for every assignment, the two outcomes agree in the sense of `agrees`: both trap, or neither traps and the values are equal. A variable is a value (it does not trap); a variable's own traps are covered by the effects check.
- **Types.** The verifier infers each variable's type from the operator signatures (`VALUE_SIGNATURES`, `ir.ts:47`), checks it against the declared type, and checks that both sides have the same result type.

## 15. The methods, and how strong each is

There is no single method that is cheap and complete for every rule. The verifier applies, for each rule, every method that applies to it, and records each result. A counterexample from any method rejects the rule.

| method | applies to | what it establishes | strength |
|---|---|---|---|
| symbolic linear | both sides built from `add`, `sub`, `mul` by a constant, `shl` by a constant, constants | the two sides have the same normal form `c₀ + Σ cᵢ·xᵢ` over ℤ/2³² | **proof** at 32 bits |
| bitwise, width 1 | both sides built from `and`, `or`, `xor` and the constants 0 and −1 | the rule holds at width 1; each result bit depends only on the same bit of each operand, so it holds at every width | **proof** at every width |
| exhaustive, 32 bits | one variable of type i32 or f32, or variables with small guarded domains (a boolean, the 31 powers of two) | every input was evaluated | **exhaustive** (complete) |
| exhaustive, reduced width | width-generic rules with up to three variables | every input at width 8 was evaluated | **complete at 8 bits**; transfer to 32 bits only by a stated argument |
| boundary and random, 32 bits | every rule | no counterexample among boundary values crossed with each other, plus N random assignments | **sampled** |
| f32 special values | rules with f32 variables | no counterexample among ±0, ±∞, canonical and non-canonical NaNs, subnormals, extremes, crossed, plus random bit patterns | **sampled** |
| by construction | `fold` rules | the replacement is computed by the evaluator's own operator function; the guard is checked to exclude every trapping input | **by construction**, relative to the evaluator |

Applied to the 27 rules of `simplify`, the strongest applicable method is:

| rules | strongest method | strength |
|---|---|---|
| `add-zero`, `zero-add`, `sub-zero`, `sub-self`, `mul-one`, `one-mul`, `mul-zero`, `zero-mul`, `shl-zero` | symbolic linear | proof |
| `mul-pow2`, `pow2-mul` | symbolic linear, once per power of two (31 instances) | proof |
| `or-zero`, `xor-zero`, `and-zero`, `and-ones` | bitwise, width 1 | proof |
| `div-one`, `shr-zero`, `shru-zero` | exhaustive, 32 bits (2³² inputs) | exhaustive |
| `not-not` | exhaustive over the guard's domain {0, 1} | exhaustive |
| `not-lt`, `not-ge`, `not-gt`, `not-le`, `not-eq`, `not-ne`, `not-ltu`, `not-geu` | exhaustive at 8 bits, with the order-law argument | reduced width + argument, sampled at 32 |

Each method deserves a sentence on why it is as strong as the table says, and no stronger.

**Symbolic linear is a proof.** Over ℤ/2³², `add`, `sub` and multiplication by a constant are ring operations, and `x << j` for a constant `0 ≤ j < 32` equals `x · 2^j` mod 2³². An expression built from these is a polynomial of degree one with coefficients in ℤ/2³², and two such polynomials are equal as functions if and only if their coefficients are equal (over ℤ/2³², a degree-one polynomial that vanishes everywhere has a zero constant term, from x = 0, and zero coefficients, from xᵢ = 1). Normalizing both sides and comparing coefficients therefore decides the rule for every 32-bit input. `x * 2^j → x << j` is checked this way once for each of the 31 values the guard admits (j = 0 … 30), which covers the guard's whole domain.

**Bitwise at width 1 is a proof.** `and`, `or` and `xor` act on each bit position independently, and the constants 0 and −1 have the same bit in every position. A rule built only from these is a statement about one bit position, repeated 32 times; checking all assignments of one bit per variable decides it.

**Exhaustive at 32 bits is complete, and affordable only for one variable.** 2³² inputs, each evaluated on both sides. The rules this covers are `div-one`, `shr-zero` and `shru-zero` (the others with one variable have proofs), and the f32 candidate rules with one variable.

**Exhaustive at reduced width is complete at that width, and its transfer to 32 bits is an argument, not a check.** Exhaustive checking at 8 bits does not by itself imply anything at 32 bits: `x * 256 → 0` holds for every 8-bit `x` and is false at 32 bits. That is why reduced width requires a width-generic rule, and why the evidence must state the argument for each rule that relies on it. For the eight comparison inversions, the argument is: at every width, `lt`, `le`, `gt` and `ge` are the strict and non-strict forms of the signed total order on w-bit integers, `ltu` and `geu` of the unsigned one, and `eq`, `ne` equality and inequality; `eqz(cmp(a, b)) = inv(a, b)` says that `inv` is the complement of `cmp`, which is a property of those relations, not of the width. The exhaustive check confirms that the operator implementations behave as these relations do at width 8, and the 32-bit random check confirms it for the 32-bit operators directly. The evidence records the strength as "complete at 8 bits, argued for 32, sampled at 32".

**Sampling is what it is.** For every rule the verifier also runs boundary values (0, 1, −1, 2, −2³¹, 2³¹−1, −2³¹+1, 2³¹−2, powers of two and their neighbours, alternating bit patterns) crossed with each other, plus N random assignments from a seeded generator, at 32 bits. For a rule with a proof this is a check of the semantics functions; for a rule without one it is the only 32-bit evidence and is reported as sampled.

**f32 rules need their own values.** IEEE arithmetic differs from real arithmetic exactly on −0, ±∞ and NaN, and the bit-exact semantics of this compiler add a fourth case: NaN payloads. `x + (−0) → x` holds for every number, both zeros and both infinities, and for the canonical NaN; it fails for a NaN with any other payload, because arithmetic returns the canonical NaN. The meaning check's f32 edge set (`F32_EDGES`, `evaluate.ts:194`) contains only the canonical NaN, so a sampled check built on it would accept that rule. The verifier's f32 special values therefore include non-canonical quiet NaNs, a signalling NaN and negative NaNs, and the one-variable f32 rules are also checked exhaustively over all 2³² bit patterns.

**By construction is relative.** A `fold` rule replaces `op(a, b)` by the constant `binop(op, a, b)`. Its soundness relative to the evaluator holds because it *is* the evaluator's function; evaluating both sides would compare `binop` with itself. What can be checked is the guard: that under `noTrap`, `binop` never throws, and that every input it excludes is one where `binop` throws or which `fold` keeps deliberately (`rem(−2³¹, −1)`, which `binop` evaluates to 0 but `fold` leaves to run time, a conservative choice the evidence records). Whether the evaluator agrees with the target is a separate question, answered by the oracles of IRWB-001.

## 16. Evidence records, and rules that must be rejected

**Proposed** (`src/typed/rules/verify.ts`):

```ts
export interface MethodResult {
  readonly method: 'structural' | 'symbolic-linear' | 'bitwise-w1' | 'exhaustive-32'
                 | 'exhaustive-w8' | 'random-32' | 'f32-special' | 'by-construction';
  readonly verdict: 'pass' | 'fail' | 'n/a';
  readonly cases?: number;             // assignments evaluated
  readonly instances?: number;         // guard instances (e.g. 31 powers of two)
  readonly ms?: number;
  readonly detail?: string;
}
export interface RuleEvidence {
  readonly rule: string;  readonly version: string;
  readonly fingerprint: string;        // SHA-256 of the rule's canonical data
  readonly verdict: 'sound' | 'unsound';
  readonly strength: 'proof' | 'exhaustive' | 'reduced-width+argument' | 'sampled' | 'by-construction';
  readonly methods: readonly MethodResult[];
  readonly argument?: string;          // why reduced-width evidence transfers, when used
  readonly counterexample?: { readonly bindings: Record<string, number>;
                              readonly lhs: number | 'trap'; readonly rhs: number | 'trap';
                              readonly method: string };
}
export function verifyRule(rule: Rule, opts?: { random?: number; seed?: number;
                                              exhaustive32?: boolean }): RuleEvidence;
```

The evidence is computed once by a script (in this ticket's `scripts/`) and recorded in a generated module, `src/typed/rules/evidence.ts`, keyed by rule name, version and fingerprint. A test checks that every rule in the `simplify` and `fold` tables has an evidence record whose fingerprint matches the rule as it is now, with verdict `sound`. A rule that is edited without re-running the verifier fails that test: evidence is attached to exactly one version of a rule.

The same test re-runs the fast methods (structural, symbolic, bitwise, reduced width, a smaller random sample) and compares their verdicts with the record, and it runs the verifier on **candidate rules that are deliberately unsound**, each of which must be rejected with a counterexample:

| candidate | why it is wrong | expected rejection |
|---|---|---|
| `div(x, 2^j) → shr(x, j)` | rounds toward −∞ for negative `x` (the corpus's `div-to-shift`) | `x = −1, j = 1`: −1/2 = 0, −1 >> 1 = −1 |
| `mul(x, 0) → 0` without `pure(x)` | drops a subtree that may trap | structural |
| `fadd(x, +0) → x` | `−0 + +0 = +0` | `x = −0` |
| `fmul(x, +0) → +0` | `NaN · 0 = NaN`, `∞ · 0 = NaN`, `−1 · 0 = −0` | `x = NaN` or `−1` |
| `fsub(x, x) → +0` | `∞ − ∞ = NaN` | `x = ∞` |
| `eqz(flt(a, b)) → fge(a, b)` | both false on a NaN | `a = NaN` |
| `fadd(x, −0) → x` | arithmetic canonicalizes NaN payloads | `x = 0x7fc00001` |

The first five rows come from the project's own history: the corpus's wrong pass and the four float rewrites that IRWB-001 wrote as deliberately unsound passes (the IRWB-002 guide, §10). The last row is the case the f32 edge set of the meaning check would miss.

# Part 4: A single-assignment view of `typed.blocks` (A1)

## 17. Why a view, and what it is

In **static single assignment** (SSA) form, every assignment defines a new name and every read refers to exactly one name. Where control flow joins and different names reach the join along different edges, a **phi** at the join defines a new name whose value is the name that arrived along the edge actually taken. With SSA, "which assignment does this read see" is a lookup, and "who reads this assignment" (the **def-use chain**) is a list.

The IRWB-002 agenda records two decisions that fix the shape of this item (§22). "The primary IR stays a CFG with expression trees; SSA ... are views": `typed.blocks` is not converted, and passes keep editing it through `Tx`, because parity with the book depends on its ids and shapes. And "New facts get new analysis definitions": the existing analyses do not change. The SSA form is therefore an **analysis result**, computed from a revision and cached under its hash like any other fact, with a new id, `typed.ssa`. It is not added to `ANALYSES`: a test asserts that list is exactly the six existing names (`tests/workbench/strategies.test.mjs:111`), and the workbench lists it.

## 18. Dominance frontiers

The construction this item uses is the classic one of Cytron, Ferrante, Rosen, Wegman and Zadeck: place phis at the **iterated dominance frontiers** of each local's definitions, then **rename** by a walk over the dominator tree.

The **dominance frontier** of block `X`, DF(X), is the set of blocks `Y` such that `X` dominates a predecessor of `Y` but does not strictly dominate `Y`. Informally, DF(X) is where `X`'s dominance ends: the first blocks reachable from `X` along some path that can also be reached along a path avoiding `X`. A definition in `X` is the only one that can reach anything `X` dominates, and DF(X) is exactly where it may meet another definition.

The frontiers can be computed from the immediate dominators alone (Cooper, Harvey and Kennedy):

```text
for each block Y with two or more predecessors:
    for each predecessor P of Y:
        runner <- P
        while runner != idom(Y):
            DF(runner) <- DF(runner) ∪ {Y}
            runner <- idom(runner)
```

Two details of `typed.blocks` need care, both established in section 6.

- **The virtual entry.** Every local has a definition at function entry (`param:i` or `init:i`). The construction places those definitions in a **virtual entry block** `^entry`, the immediate dominator of the real entry, with one edge `^entry → entry`. If the entry block has predecessors (a loop whose header is the entry), it is then a join like any other, and its phis have an argument for the virtual edge. `dominatorsOf` sets `idom(entry) = entry`; the SSA construction treats the entry's immediate dominator as `^entry` instead.
- **Reachable blocks only.** The dominator tree covers the blocks reachable from the entry, and so does the reaching-definitions solver (section 6). Predecessors that are not reachable are ignored. `Tx.commit` removes unreachable blocks (`tx.ts:503`), so a published revision should have none; the validation counts them.

On the corpus at r0 neither case occurs: a scan of all 70 functions found no unreachable block and no entry block with a predecessor (and no local name containing a `.`, which section 20 relies on). The construction handles both cases anyway, because a pass may produce them and Candela has not been scanned.

For Blend at r0, the only join is `bb.1` (predecessors `bb.0` and `bb.7`). From `bb.0` the runner stops at once (`idom(bb.1) = bb.0`). From `bb.7` it climbs `bb.7 → bb.5 → bb.3 → bb.1` and stops at `bb.0`, adding `bb.1` to the frontier of each block it passes:

```text
DF(bb.7) = DF(bb.5) = DF(bb.3) = DF(bb.1) = { bb.1 }        all other frontiers empty
```

## 19. Placing phis

A local needs a phi at `Y` if two different definitions of it can reach `Y` along different edges. Placing a definition's phi creates a new definition, which may need phis in turn, so the placement iterates:

```text
for each local l:
    work <- the blocks containing a `set` of l          (the virtual entry needs no phi: DF(^entry) = ∅)
    placed <- ∅
    while work is not empty:
        X <- take(work)
        for Y in DF(X) where Y ∉ placed:
            add phi(l) at Y;  placed <- placed ∪ {Y}
            if Y has no `set` of l: work <- work ∪ {Y}   # the phi is a new definition in Y
```

This places phis wherever two definitions *can* meet, whether or not the local is read afterwards. That is **minimal SSA**. A **pruned** variant would place a phi only where the local is live on entry to the block. The view uses minimal SSA, because it is a function of the control-flow graph and the definitions alone and needs no liveness; the measurements report how many of its phis are dead, so a consumer can decide whether pruning is worth it.

In Blend, `s` and `i` are set in `bb.0` and `bb.7`, so each gets a phi at `bb.1`. `scale` is set only in `bb.0`, whose frontier is empty: no phi. `t7` is set in `bb.3`, whose frontier is `{bb.1}`: minimal SSA places a phi for `t7` at `bb.1`, although `t7` is always assigned in `bb.3` before it is read and is not live at `bb.1`. That phi is dead; pruned SSA would not place it.

## 20. Renaming

Renaming gives each definition its name and each read the name it sees. It walks the dominator tree from `^entry` in preorder, keeping a stack of names per local; the top of a local's stack is the name that reaches the current point.

```text
rename(block B):
    pushed <- []
    for each phi(l) at B:              name <- fresh(l);  def[name] <- phi;  push(l, name)
    for each statement s of B, in order:
        for each get g in s's trees (value, cond, addr):   use[g] <- top(l of g)
        if s is `set l`:               name <- fresh(l);  def[name] <- s;  push(l, name)
    for each successor S of B (in the control-flow graph):
        for each phi(l) at S:          phi.args[B] <- top(l)
    for each child C of B in the dominator tree:  rename(C)
    pop everything pushed in B

start: at ^entry, for each local l push its entry name l.0 (def = param:i or init:i),
       fill the virtual-edge arguments of the entry block's phis, then rename(entry).
```

Every read in a statement is resolved before the statement's own assignment is pushed, which matches `reachingAt(stmt, l)`, the definitions that reach the point just *before* `stmt`. Names are `<local>.<n>`, numbered per local in the order the walk creates them, with `.0` the entry definition; a `.` cannot occur in a Typed identifier, so names are unique. The walk is iterative, not recursive, because Candela's dominator trees are deep enough to make recursion a risk.

For Blend at r0, with the dominator tree's children in reverse postorder (`bb.0, bb.1, bb.3, bb.5, bb.7, bb.4, bb.2`), the walk produces:

```text
^entry   work.0 n.0 a.0 b.0 (param)   scale.0 s.0 i.0 t7.0 (init)
bb.0     scale.1 = (4 * 16)    s.1 = 0    i.1 = 0
bb.1     s.2 = φ(bb.0: s.1, bb.7: s.3)    i.2 = φ(bb.0: i.1, bb.7: i.3)    t7.1 = φ(bb.0: t7.0, bb.7: t7.2)
         if !((i.2 < n.0)) goto bb.2 else bb.3
bb.3     t7.2 = i.2
         if (t7.2 >=u load32[work.0+0]) goto bb.4 else bb.5
bb.7     s.3 = s.2 + load16[work.0 + (t7.2 << 1) + 4] * ((a.0 * b.0) + scale.1)
         i.3 = i.2 + 1
bb.2     return (s.2 / 8)
```

(Treat these names as the design's prediction; the implementation's output is the authority, and the test pins it.)

## 21. The result, and the mapping back

**Proposed** (`src/typed/ssa.ts`). The analysis result is finite JSON, keyed by function name like every Typed fact:

```ts
export interface SsaDef {
  readonly local: number;
  readonly kind: 'param' | 'init' | 'set' | 'phi';
  readonly block: string;              // '^entry' for param and init
  readonly stmt?: string;              // the `set` statement            (kind 'set')
  readonly value?: string;             // the value tree it assigns       (kind 'set')
  readonly def?: string;               // 'param:i' | 'init:i' | the stmt id: reaching's id
}
export interface SsaPhi { readonly name: string; readonly local: number;
                          readonly args: Readonly<Record<string, string>> }  // pred block -> name
export interface SsaFn {
  readonly entry: string;
  readonly names: Readonly<Record<string, SsaDef>>;      // every SSA name -> its definition
  readonly phis: Readonly<Record<string, readonly SsaPhi[]>>;  // block -> phis, by local index
  readonly uses: Readonly<Record<string, string>>;       // every `get` value id -> the name it reads
  readonly defs: Readonly<Record<string, string>>;       // every `set` statement id -> its name
  readonly frontier: Readonly<Record<string, readonly string[]>>;
  readonly unreachable: readonly string[];               // blocks outside the dominator tree
}
export const ssaAnalysis: AnalysisDefinition<TypedBlocks, Record<string, SsaFn>>;  // id 'typed.ssa'
export function ssaOf(st: Store, f: WorkFn): SsaFn;
export function ssaView(fact: SsaFn): {
  defOf(get: string): SsaDef;                // the definition a read sees
  usersOf(name: string): { gets: string[]; phis: { block: string; name: string }[] };
  phisOf(block: string): readonly SsaPhi[];
  reachingDefs(name: string): string[];      // expand phis to reaching's definition ids
};
```

The **mapping back** is complete in both directions. Every SSA name maps to a definition record that names a `set` statement and its value tree, an entry definition (`param:i`, `init:i`), or a phi (a block and a local; a phi is not a statement of `typed.blocks`, it is a property of the block's entry). Every `get` value maps to the name it reads, and every `set` statement to the name it defines. So a consumer can go from any SSA name to the entities a pass can edit, and from any entity to its SSA name.

## 22. Validation against reaching definitions

The SSA view and the reaching-definitions fact describe the same relation, and that is what makes the validation exact rather than approximate. Define, for an SSA name `n`, its **expansion** `E(n)`:

```text
E(n) = { def[n] }                          if n is defined by a `set` or at entry
E(n) = ∪ over the phi's arguments a: E(a)  if n is a phi     (with a visited set for loops)
```

The claim is: **for every `get` g of local l in a reachable statement s, E(use[g]) = reachingAt(s, l)** as sets of definition ids. The argument, in outline: `use[g]` is the name on top of `l`'s stack at `s`, which is the nearest definition or phi of `l` on the dominator-tree path to `s`. If it is a definition, no phi of `l` intervenes, which by the placement means that every path from the entry to `s` passes through that definition with no other definition of `l` after it: the definition is the only one that reaches. If it is a phi at `Y`, each argument is the name that reaches the end of one predecessor of `Y`, and by induction its expansion is the set of definitions that reach the end of that predecessor; the union over predecessors is what reaches the entry of `Y`, and nothing between `Y` and `s` redefines `l`. Minimal placement guarantees a phi wherever two different definitions meet, so no union is lost.

The validation does not rely on the argument. It checks the claim directly, on every `get` of every function:

```text
checkSsa(st, f, ssa, reach):
    for each reachable block, each statement s, each get g in s:
        expect <- set(reach.reachingAt(s, local(g)))
        got    <- set(E(ssa.uses[g]))
        if expect != got: record mismatch (function, statement, local, expect, got)
    also check the SSA invariants:
        every name is defined once
        every phi at Y has exactly one argument per reachable predecessor of Y (and ^entry)
        a definition dominates every use (same block: it comes earlier)
    report: functions, gets, (definition, use) pairs, phis, dead phis, unreachable blocks, mismatches
```

Acceptance is zero mismatches on every corpus function (70) and on every function of Candela at r0 (332), and the time to compute `typed.ssa` against `typed.reaching` on Candela r0.

## 23. The first consumer: sparse conditional constant propagation

`constprop` replaces a read whose reaching definitions all assign the same literal constant. Two things limit it. It looks only at literal constants (`t = 2 + 3` is not a constant to it until `fold` has run), and it cannot see that a branch is decided: in

```text
x = 1
if (x == 1) { y = 7 } else { y = 9 }
return y
```

both assignments of `y` reach the `return`, so `constprop` does nothing to `y` until `fold` and `cfg` have removed the dead arm, which in O2 happens only in a later round. **Sparse conditional constant propagation** (SCCP, Wegman and Zadeck) propagates constants and the executability of edges together, so it finds `y = 7` in one run.

The algorithm keeps one lattice value per SSA name, **⊤** (no information yet: the definition has not been seen to execute), a **constant** `c` (of type i32 or f32 bits), or **⊥** (varies), and one flag per control-flow edge (executable or not):

```text
sccp(f, ssa):
    L[n] <- ⊤ for every name;  L[param.0] <- ⊥;  L[init.0] <- 0 (of the local's type)
    executable <- { ^entry -> entry }
    repeat until nothing changes:
        for each block B in reverse postorder that has an executable incoming edge:
            for each phi n at B:  L[n] <- meet of L[arg] over the args whose edge is executable
            for each statement s of B:
                if s is `set`:     L[def(s)] <- eval(s.value)
                if s is `br_if`:   c <- eval(s.cond)
                                   c constant  -> mark the edge to (c ≠ 0 ? then : else)
                                   c is ⊥      -> mark both edges;  c is ⊤ -> mark nothing yet
                if s is `br`:      mark the edge to s.to
    eval(tree):  const -> its value;  get g -> L[use[g]]
                 an operator `fold` folds, all operands constant -> the folded value (binop, f32Op;
                     a division that would trap -> ⊥)
                 any operand ⊥ -> ⊥;  else any operand ⊤ -> ⊤
                 call, load, load16u, caddr, aaddr, result -> ⊥
    meet(⊤, x) = x;  meet(c, c) = c;  otherwise ⊥
```

Values only move down the lattice (⊤ → constant → ⊥) and edges only become executable, so the iteration terminates; each name changes at most twice.

The **pass** `sccp` (Proposed, `src/typed/sccp.ts`) then rewrites, like `constprop`, every `get` in an executable block whose name has a constant value into that constant, with the local's type. Its `because` lists the `set` statements in the name's expansion restricted to executable edges (the same kind of entity `constprop` cites, so `why` reaches them), or the `local:… starts at 0` text for an initial value. It writes only `values`, preserves `cfg`, `dominators` and `loops` (as `constprop` does), and leaves the folding of the now-constant conditions and the removal of dead arms to `fold` and `cfg`, which follow it in a pipeline.

**The pipeline.** `sccp` goes into a new pipeline, `O2-sccp`: O2 with each `constprop` replaced by `sccp`. It is defined in `src/typed/sccp.ts` and run through `Program.apply`, which accepts a pass object (`program.ts:248`), so neither `PASSES` nor `PIPELINES` changes. What to measure against `constprop`:

- at the same input revision (O2's r3, before the first `constprop`): how many reads each makes constant, and whether `sccp`'s set contains `constprop`'s;
- over a whole pipeline, `O2-sccp` against `O2` and `O2+` on every corpus project: statements, image bytes and instructions (`measure`, `src/typed/strategies.ts:66`: ten seeded cases per function), with every revision checked by the meaning contract;
- in particular the `constants` project, which runs 42.9 % fewer instructions under O2 applied twice than under O2 once (IRWB-001 report 2), because its constants cascade through more rounds of `constprop`, `fold` and `cfg` than O2 contains.

# Part 5: Implementation plan, tests and acceptance

## 24. Files

| file | status | contents |
|---|---|---|
| `src/typed/rules/form.ts` | new | the rule form (section 9), builders, `ruleText` (a rule as one line, `mul(x, k) → shl(x, log2 k) if pow2 k`), `toNodePattern` |
| `src/typed/rules/compile.ts` | new | `matchRule`, `compileRules` (section 10), firing counts |
| `src/typed/rules/simplify.ts`, `fold.ts` | new | the two tables |
| `src/typed/rules/handwritten.ts` | new | today's `simplify` and `fold` bodies, moved verbatim after the switch |
| `src/typed/rules/passes.ts` | new | the table passes for the equivalence check (imports `typedPass`) |
| `src/typed/rules/semantics.ts` | new | `binopW`, rule evaluation at width w, f32 special values |
| `src/typed/rules/verify.ts` | new | `verifyRule` and the methods of section 15 |
| `src/typed/rules/evidence.ts` | generated | the recorded evidence, written by a ticket script |
| `src/typed/ssa.ts` | new | `ssaOf`, `ssaAnalysis`, `ssaView`, `checkSsa` |
| `src/typed/sccp.ts` | new | the SCCP lattice, the `sccp` pass, the `O2-sccp` pipeline and its runner |
| `src/typed/passes.ts` | changed, minimally | after equivalence: the bodies of `simplify` and `fold` call the compiled tables |
| `tests/typed/rules.test.mjs`, `tests/typed/ssa.test.mjs` | new | section 25 |
| `src/workbench/workbench.ts` | changed, one method | `wb.rules()`: the rules listing (name, rule, strength), one rule per line, at 72 columns |

How the new modules depend on each other and on existing code (an arrow means "imports"):

```text
 passes.ts ──► rules/compile.ts ──► rules/form.ts
     ▲              │
     │              └──► tx.ts, analyses.ts (isPure), listing.ts (COMPARE)
     │
 rules/passes.ts ──► rules/simplify.ts, rules/fold.ts, rules/handwritten.ts
 rules/verify.ts ──► rules/semantics.ts ──► evaluate.ts (binop), f32.ts (f32Op)
 ssa.ts ──► analyses.ts (cfgOf, dominatorsOf)
 sccp.ts ──► ssa.ts, passes.ts (typedPass), evaluate.ts, f32.ts
```

`passes.ts` imports only the compiler and the tables, never a module that imports `passes.ts`, so there is no import cycle.

`src/framework/**` does not change (IRWB-004 owns it), nor does the contract's case generation (IRWB-005 owns it). IRWB-003 adds passes to `src/typed/passes.ts` in parallel, which is why the changes there are limited to two pass bodies and their imports.

## 25. Tests

- **Rules, equivalence.** On a subset of projects by default and on all 44 with `IRWB_FULL=1`: for every pipeline containing `simplify` or `fold`, the table passes and the hand-written passes give identical revision hashes and edit lists.
- **Rules, evidence.** Every table rule has evidence with a matching fingerprint and verdict `sound`; the fast methods re-run and agree; `binopW(·, ·, ·, 32) = binop`; the unsound candidates of section 16 are rejected, each with the expected kind of counterexample.
- **Rules, listing.** The rules listing fits 72 columns.
- **SSA.** Blend's phis and names as in section 20 (as implemented); zero mismatches against reaching definitions on every corpus function at r0 and at every O2 revision; the invariants of section 22.
- **SCCP.** On the example of section 23 and on `constants`: `sccp` finds the constants `constprop` misses; `O2-sccp` is accepted by the meaning contract; O2 is unchanged.

## 26. Order of work

1. B1 first: the form, the compiler, the `simplify` table, corpus equivalence. Then `fold`. Then Candela equivalence, then the switch. Each step is a commit, and after the switch the corpus revisions are diffed against the baseline.
2. B2: semantics, verifier, the evidence script, the tests with unsound candidates.
3. A1: `ssaOf`, the analysis, the validation on the corpus, then one Candela run (SSA on r0 against reaching, with timings).
4. A2: SCCP, the pipeline, the measurement against `constprop` on the corpus.
5. The rules listing in the workbench, the frozen gates, the report.

Candela runs are limited to the `simplify` equivalence check and the SSA validation, one process at a time, with `--max-old-space-size` at most 12288.

## 27. Acceptance

| item | measurement | target |
|---|---|---|
| B1 | revisions (and edit lists) of the table passes against the hand-written ones: every corpus project, every pipeline; Candela O2 | identical; then `simplify` (and `fold`) switched |
| B1 | firing count of every rule over the corpus and Candela | reported, including rules that never fire |
| B2 | evidence for every rule, with method and strength | recorded; the unsound candidates rejected in a test |
| A1 | SSA def-use against reaching definitions: corpus (70 functions), Candela r0 (332) | zero mismatches; `ssa` time against `reaching` reported |
| A2 | `sccp` against `constprop`; `O2-sccp` against `O2` on the corpus | measured and reported |
| all | the four frozen commands; corpus revisions against the baseline | identical |

## 28. Decisions

| decision | reason | consequence |
|---|---|---|
| Rules are applied through `Tx.rewrite`, compiled from data | the framework engine cannot reproduce ids, origins or counters, and publishes an artifact per application | the rule form is the shared asset; the engine stays available for other uses |
| The table reproduces today's provenance exactly, including `because: 'const-args'` | the revision hash covers every origin | the rule name is not yet cited in `because`; a future pass variant can add it |
| Evidence is generated once and pinned by a fingerprint | verification at 32 bits takes minutes for some rules | an edited rule fails its test until re-verified |
| Minimal SSA, with a virtual entry definition | a function of the CFG and definitions alone; one-to-one with reaching definitions | dead phis exist and are counted |
| `typed.ssa` is a new analysis outside `ANALYSES`; `sccp` and `O2-sccp` outside `PASSES`/`PIPELINES` | the six-analysis list is asserted by a test; registering passes changes `actions()` and the strategy registry | the coordinator can register them after merging with IRWB-003 |

## 29. Glossary

| term | meaning here |
|---|---|
| rule | a name, a pattern, a guard and a replacement over value trees (section 8) |
| pattern variable, constant variable | a sub-pattern that matches any tree, or any constant, and binds it |
| guard, side condition | a condition on the bindings; a condition on types, traps, widths or effects |
| evidence, strength | the recorded result of verifying a rule, and how much it establishes (section 15) |
| width-generic | a rule whose constants and guards make sense at every width |
| dominator, immediate dominator, dominator tree | section 6 |
| dominance frontier, iterated | section 18 |
| phi | a definition at a join whose value is the name that arrived along the edge taken |
| minimal, pruned SSA | phis wherever definitions meet, or only where the local is live |
| expansion E(n) | the definitions an SSA name stands for, through phis (section 22) |
| SCCP | sparse conditional constant propagation (section 23) |
| lattice ⊤, ⊥ | no information yet; varies |
