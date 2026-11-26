---
Title: 'Sketch guide: rewrite search on SSA and verified rules'
Ticket: IRWB-010
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Intern-grade sketch: the system parts rewrite search needs (value trees, Tx provenance, the meaning gate, rule tables with evidence, the SSA view, the RV32 backend), e-graphs, explanations and superoptimization from scratch, measured shapes and heat of noise3 and fbm3, the design space, first experiments with stop criteria, and open questions.'
LastUpdated: 2026-11-26T10:02:52.18704216-05:00
WhatFor: ""
WhenToUse: ""
---

# Sketch guide: rewrite search on SSA and verified rules

This guide records a research direction so that it is not lost, in a form a new member of the project can pick up. The direction is to let the compiler *search* for better programs instead of only applying the rewrites someone wrote by hand, while keeping the property that makes this project unusual: every change the compiler publishes is checked data. Three searches are proposed, in increasing distance from today's code:

1. **Rule discovery.** Enumerate small expressions, group those that behave alike, propose rewrite rules between them, and keep only the rules the existing verifier accepts (agenda item B3 of IRWB-002).
2. **Equality saturation.** Apply many verified rules to a value tree at once in a structure that keeps every equivalent form, then pick the cheapest form by the RV32 backend's cost (B4).
3. **A window superoptimizer.** For short runs of hot machine instructions, search for a shorter equivalent sequence (B5).

The target is Candela's procedural-noise functions `noise3` and `fbm3`. The research question behind all three is whether "checked data" scales from one hand-written pass to a search that tries thousands of candidates: whether a verifier, provenance and a meaning check can keep up.

This is a **sketch**. Nothing here is implemented. The weight is on the parts of the system you need, the background, the design space, the first experiments with criteria for continuing or stopping, and the open questions. Part 1 explains the system; Part 2 the techniques, from scratch; Part 3 the design space; Part 4 the experiments; Part 5 risks, open questions and how this connects to the other tickets.

**Conventions.**

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `a4beda6`. Line numbers drift; the symbol named next to them does not.
- **Everything in Part 1 exists in the code.** Anything that does not is marked **Proposed**.
- **Numbers cite their source.** The ticket's own measurements are scripts in `ttmp/2026/11/26/IRWB-010--*/scripts/` with outputs in `various/` beside them. Other numbers come from the diaries of IRWB-001, IRWB-003, IRWB-005 and IRWB-006, named where used. IRWB-003 and IRWB-005 are not merged; their numbers are read at commits `90fed9c` and `d9cf4e9`.

> **The direction in one screen.**
> - The ingredients exist. `simplify` is a table of 27 rules and `fold` one of 40. Every rule carries recorded evidence of soundness, and the verifier rejects all seven deliberately unsound candidates. A single-assignment view `typed.ssa` is checked against reaching definitions on all of Candela.
> - What does not exist is search. Of `simplify`'s 27 rules, 18 never fire on the corpus's O2, and no rule at all applies to an f32 operator. Section 8 shows what that leaves in `noise3`: constants rebuilt on every use, and multiply-then-add pairs.
> - The proposal is a loop. Hot instructions whose provenance shows no rule fired yield shapes. Candidate rules are enumerated for those shapes, verified, and added to a table. An e-graph applies the table and extracts by RV32 cost, and its result is one ordinary, checked revision whose explanation cites only verified rules.

# Part 1: The parts of the system you need

## 1. The compiler in one page

The project compiles **Typed**, a statically typed subset of JavaScript, to **RV32** machine code for the PicoCalc, a handheld whose processor executes 32-bit RISC-V with the single-precision float extension (RV32F). The compiler is built on a framework that treats every step as data:

```text
 main.typed ──front end──► tape ──lift──► typed.blocks r0 ──pass──► r1 ──pass──► … rN
                                              │                                   │
                                              │ meaning check: every rK against r0 │
                                              ▼                                   ▼
                                     evaluator(r0) ═══ compared on generated cases ═══ evaluator(rK)
                                                                                  │
                                                              select · allocate · encode
                                                                                  ▼
                                                                        rv32.image (each
                                                                        instruction lists
                                                                        what it covers)
```

- A **revision** is an immutable artifact whose identity is the hash of its content. Two equal programs have equal revision hashes, whoever made them.
- A **pass** turns one revision into the next. It declares what it may change, and every entity it creates records where it came from and why.
- The **meaning check** (`typed.meaning-kept`) runs the candidate revision and r0, the program as lifted, on the same generated inputs and requires equal results. Nothing is published until it agrees.
- The **backend** lowers a revision to an image in which every instruction names the IR value and statement it implements (`covers`). Execution counts on the emulator can therefore be attributed back to statements and source lines.

IRWB-002's guide, Part 1 (`ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md`, sections 1–17), explains all of this at length. The rest of this part covers only what rewrite search touches.

## 2. Value trees: the unit everything here rewrites

The main IR, `typed.blocks` (`src/typed/model.ts`), is a control-flow graph of blocks. A block holds statements, and a statement holds **value trees**. A statement is one of eight operations (`set` a local, `store` to memory, `eval`, `br`, `br_if`, `return`, `trap`, `zero`). A value is a node with one of 54 operators (`ValueOp`, `model.ts:35`): `const`, `get` (read a local), integer arithmetic and comparisons, loads, `call`, the f32 operators and a few addressing forms.

Three properties of value trees decide what kind of search fits.

- **A value has exactly one user.** Trees are not shared. The same subexpression written twice is two trees. Sharing is expressed only through locals.
- **Floats are bit patterns, and float operators have their own names.** An f32 value is stored as its IEEE-754 bits read as a signed 32-bit integer (`1.0` is `0x3f800000`), and its record carries `type: 'f32'`. An f32 addition is `fadd`, never `add`. An integer rule such as `x + 0 → x` therefore cannot match a float addition, where it would be wrong for `x = −0`.
- **Purity is a property of operators.** Calls, loads, divisions and checked addresses may trap or read memory. A rewrite that drops or duplicates such a subtree is wrong.

Here is one statement of `noise3`'s source (`corpus/candela-gallery/kernel.typed:155`), the smoothing weight of one axis, as the compiler lists it:

```text
source:   (f.x * f.x) * (3.0 - (2.0 * f.x))
listing:  ((x *. x) *. (3f -. (2f *. x)))          (*. and -. are fmul and fsub)
tree:     fmul ─┬─ fmul ─┬─ get x
                │        └─ get x
                └─ fsub ─┬─ const 3.0f
                         └─ fmul ─┬─ const 2.0f
                                  └─ get x
```

(The listing is the output of `scripts/04-phase-order-example.mjs` on that expression as a one-line function; `various/04-phase-order-example.txt`.)

Because each tree has one user, rewriting a tree is a local operation, and the cost of a tree is the sum of the costs of its nodes. Section 11 returns to why that matters for extraction.

## 3. How a pass changes a program, and what it must record

A Typed pass is written with `typedPass` (`src/typed/passes.ts:166`). For every function it builds a working copy and a transaction `Tx` (`src/typed/tx.ts:165`), and calls the pass's `body` once. The body never edits tables directly. It calls methods of the transaction:

| method | line | effect |
|---|---|---|
| `tx.rewrite(visit)` | `tx.ts:431` | rebuild every statement's trees bottom-up; `visit(handle)` may return a replacement value |
| `tx.const(n, opts)` | `tx.ts:217` | make a constant |
| `tx.make(op, ...args, opts)` | `tx.ts:236` | make an operator node |
| `tx.replace(old, next, opts)` | `tx.ts:482` | replace a value |

Every created entity gets an **origin** `{ from, via, rev, because, note }` (`model.ts:103`): what it was made from, by which pass at which revision, which entities or facts justify it, and a short note. `Program.why(id)` (`src/typed/program.ts:457`) follows these records back to a source line. After a pass, `typedPass` converts the edits into a framework **correspondence** between the two revisions (`revisionCorrespondence`, `passes.ts:117`). The backend's `covers` extend the same chain into machine code.

One rule governs the whole design space of Part 3: **a pass application produces at most one new revision**. Whatever a pass does internally (one rewrite or a thousand), what leaves it is one revision with one edit list and one correspondence, and that is what the gate checks.

## 4. The gate: what "checked" means today

`applyPass` (`src/framework/passes/define-pass.ts:190`) publishes a pass's output only if every stage succeeds: the output validates, the diff touches only the kinds the pass declared, the contract holds, and every analysis the pass claims to preserve really is preserved. The contract for every Typed pass is `optimizationContract` (`passes.ts:222`), which wraps `meaningKept` (`src/typed/evaluate.ts:587`).

`meaningKept` generates cases per function from a seed (`casesFrom`, `evaluate.ts:232`), evaluates r0 and the candidate on each, and compares with `agrees` (`evaluate.ts:554`): equal results and equal written memory. For f32 that is **bit equality**. For functions with f32 parameters, the first quarter of the cases sweeps fifteen edge values (`F32_EDGES`, `evaluate.ts:196`: NaN, both infinities, both zeros, the smallest subnormal, the largest finite value and others). The comparison is always with r0, so errors cannot accumulate from pass to pass.

A sampled check establishes agreement on the cases it ran, no more. IRWB-005 measured how strong this gate is by injecting faults into pass outputs. On 18 Candela functions the default gate accepted 85 wrong mutants of 3,931, 83 of them float mutants (IRWB-005 diary step 18, at `d9cf4e9`). For rewrite search this has a precise consequence. The gate is the last line of defence, not a proof. Section 12 proposes producing a proof alongside it.

## 5. Rules as data, with evidence (IRWB-006)

IRWB-006 turned `simplify` and `fold` into tables of rules. A rule is a frozen JSON-serializable record (`src/typed/rules/form.ts:58`):

```ts
// src/typed/rules/simplify.ts:38-48
rule('mul-pow2', { x: 'i32', k: 'i32' },
     op('mul', v('x'), kv('k')),               // pattern: x * k, k any constant
     op('shl', v('x'), c({ log2: 'k' })),      // template: x << log2(k)
     { where: [{ pow2: 'k' }],                 // guard: k = 2^j
       because: 'const-args', note: 'x * {k} = x << {log2 k}' })
```

- **A pattern** is built from `var`, `const`, `constVar`, `same` and operator nodes. **A guard** is one of `pure`, `pow2`, `boolean` or `noTrap`. **A template** is built from `var`, `const` (a number, `log2` of a constant variable, or an `eval` of an operator) and operator nodes. All of these are defined in `form.ts:30–56`.
- **The compiler** (`src/typed/rules/compile.ts`) indexes the rules by root operator (`indexRules`, `:108`), tries them in table order (`firstMatch`, `:93`), and instantiates the first match inside `Tx.rewrite` (`compileRules`, `:119`; `tableBody`, `:133`). Both tables reproduce the hand-written passes exactly: 1,232 comparisons on the corpus and the four `simplify`/`fold` steps of Candela's O2, identical in revision hash, edits and correspondence (IRWB-006 diary steps 4–5).
- **Rule firings were counted.** On the corpus's O2, 9 of the 27 `simplify` rules fire and 18 never do; 5 of the 40 `fold` rules fire. On Candela's O2, `simplify` fires four rules (`add-zero` 1, `mul-pow2` 39, `not-le` 4, `not-lt` 12) (IRWB-006 diary steps 4 and 5).
- **No rule has an f32 root operator.** This is a declared property of the set (`simplify.ts:79`). The real-number identities are wrong for IEEE floats: `x + 0` for `x = −0`, `x · 0` for NaN or ∞, `x − x` for ∞, `!(a < b) → a ≥ b` for NaN.

One detail matters for proof-producing search. The provenance a rule application writes is `because` (the matched node's constant operands) and `note` (the filled-in text). **It does not record the rule's name or version** (`compile.ts:72–76`). That is deliberate, because it keeps O2's revisions identical to the hand-written passes'. A pipeline that wants explanations citing rules has to add that citation, and its revisions will then differ from O2's. That pipeline therefore needs a name of its own (section 20).

**The verifier.** `verifyRule(r, opts): RuleEvidence` (`src/typed/rules/verify.ts:179`) checks a rule independently of any program, by eight methods (`verify.ts:39–47`):

| method | what it does | strength it can give |
|---|---|---|
| `structural` | dropped, duplicated or reordered variables need `pure`; types from the operator signatures | (a precondition) |
| `by-construction` | for `fold`: the replacement is the evaluator's own value of the matched operator; guards exclude every trapping input | `by-construction` |
| `symbolic-linear` | both sides as normal forms `c₀ + Σ cᵢ·xᵢ` over ℤ/2³², once per guard instance | `proof` |
| `bitwise-w1` | rules built from `and`, `or`, `xor`, checked on one bit | `proof` |
| `exhaustive-w8` | every assignment at 8 bits, plus a width-transfer argument where one exists | `reduced-width+argument` |
| `random-32`, `f32-special` | boundary or special values crossed, then N random assignments at 32 bits | `sampled` |
| `exhaustive-32` | every value of a single 32-bit variable (2³² inputs), and small domains always | `exhaustive` |

Recorded evidence (`src/typed/rules/evidence.ts`, generated by IRWB-006's `scripts/04-verify-rules.mjs`):

- `simplify`: 15 rules at `proof`, 4 `exhaustive`, 8 `reduced-width+argument`.
- `fold`: all 40 `by-construction`.
- All seven unsound candidates of `src/typed/rules/candidates.ts:12` rejected, each with a counterexample. For example, `div-pow2-shr` fails at 8 bits on `{x: −127, k: 2}`, and `fadd-neg-zero` fails on `x = 0x7fc00001`, a NaN with a non-canonical payload.

A test pins each record to `ruleFingerprint(rule)` (`verify.ts:87`), so editing a rule without re-verifying it fails the suite. The cost of the strong methods is real. One exhaustive 2³² check of `div-one` took 50 s in a fresh process, and the two sound f32 candidates (`fneg-fneg`, `fabs-fneg`) took 306 s and 623 s (IRWB-006 diary steps 6 and 10). Any search that verifies many candidates has to budget for this (section 23).

## 6. The single-assignment view and SCCP (IRWB-006)

Locals in `typed.blocks` are mutable variables. To know which assignment a read sees, a pass must ask reaching definitions. `typed.ssa` (`src/typed/ssa.ts`) is a **single-assignment view**: a fact computed for a revision, not a new IR. It gives every assignment of every local its own name, places φ-nodes where control flow joins, and maps every `get` to the name it reads. A φ-node is a definition at a join block that selects the value arriving from each predecessor.

```ts
// src/typed/ssa.ts:42-57 (abridged)
interface SsaFn {
  entry: string;
  names:   Record<string, SsaDef>;          // 'x.3' -> { local, kind: 'param'|'init'|'set'|'phi', block, stmt?, value? }
  phis:    Record<string, SsaPhi[]>;        // block -> its phis, each { name, local, args: pred -> name }
  uses:    Record<string, string>;          // get value id -> the name it reads
  defs:    Record<string, string>;          // set statement id -> the name it defines
  idom:    Record<string, string>;  frontier: Record<string, string[]>;  unreachable: string[];
}
```

`ssaOf(st, f)` (`ssa.ts:60`) builds it with the Cytron–Ferrante–Rosen–Wegman–Zadeck construction. `ssaView(fact)` (`:243`) answers `defOf`, `usersOf`, `phisOf`, `reachingDefs` and `dominates`. `checkSsa` (`:325`) compares the view with reaching definitions. On Candela r0 the view has 23,850 names and 4,245 phis, 2,840 of them dead, and **0 mismatches** with reaching definitions (IRWB-006 diary step 7). The first consumer is `sccp` (`src/typed/sccp.ts`), sparse conditional constant propagation. In the pipeline `O2-sccp` (`sccp.ts:171`) it brings the corpus project `constants` from 70 to 40 instructions (IRWB-006 diary step 8).

The SSA view matters for search for two reasons. First, a tree's leaves become SSA names instead of mutable locals. Two trees in different statements that read the same name read the same value, so an e-graph can merge across statements without asking reaching definitions. Second, SSA names make sharing expressible. That is the first step from per-tree rewriting towards global value numbering, and it is where tree extraction stops being exact (section 11).

## 7. The backend: tiles, costs and covers

`src/typed/backend/` lowers each function in four steps: `select` (tiling value trees onto virtual registers, `select.ts`), `allocate` (linear scan, `regalloc.ts`), `finish` (frames, spills, `compile.ts`), and `encode`. The public entry is `lowerToImage(artifact, options?, facts?)` (`compile.ts:429`). It returns `{ image, correspondence }`, and `image` is an artifact of IR `rv32.image` whose value lists every instruction as an `ImageInsn` (`image.ts:32`) with `fn`, `offset`, `op`, `text`, and `covers`: the value and statement it implements.

The f32 tiles are fixed (`select.ts:11–20`, `:107–126`): `fadd.s`, `fsub.s`, `fmul.s`, `fdiv.s`, `fsqrt.s` with round-to-nearest-even named in the instruction, and sign injection for `fneg`, `fabs` and `fcopysign`. **No fused multiply-add is ever emitted**, although the vendored interpreter executes `fmadd.s`, `fmsub.s`, `fnmsub.s` and `fnmadd.s` with one rounding (`vendor/ds-js-os/bench/host/rv32-interp.js:134–147`, `:379–383`). **An f32 constant is rebuilt at every use**: its bits go into an integer register with `lui` (and `addi` if needed), then into a float register with `fmv.w.x`.

The cost of a tree is therefore easy to measure. `scripts/04-phase-order-example.mjs` compiles one-line functions through O2 and the backend (`various/04-phase-order-example.txt`):

| expression | O2 tree | instructions (without `ret`) |
|---|---|---:|
| `x * 2.0` (f32) | `x *. 2f` | 3: `lui`, `fmv.w.x`, `fmul.s` |
| `x + x` (f32) | `x +. x` | 1: `fadd.s` |
| `(x*x) * (3.0 - 2.0*x)` (f32) | unchanged | 8: three `fmul.s`, one `fsub.s`, two constants of two instructions each |
| `a + (b - a) * t` (f32) | unchanged | 3: `fsub.s`, `fmul.s`, `fadd.s` |
| `(x * 2) * 3` (i32) | `(x << 1) * 3` | 3: `slli`, `addi t1, zero, 3`, `mul` |
| `x * 6` (i32) | `x * 6` | 2: `addi t0, zero, 6`, `mul` |

Two observations carry into Part 3. Exact algebra on f32 can pay in this backend: `x * 2.0 → x + x` holds for every bit pattern (section 18) and saves two instructions per execution, because the constant disappears. And the integer row shows the phase-ordering problem of section 9 on a real compile.

**Heat.** `runImage(image, fname, args, mem, { counts: true })` (`src/typed/backend/run.ts:74`) counts executions per instruction word. `heat(store, image, counts)` (`run.ts:175`) attributes them to statements and source lines through `covers`. This ticket's `scripts/03-heat.mjs` uses the same attribution per function and per covered value (section 8).

**Machine code is not an artifact.** Between `select` and `encode` the code is an internal array (`MInsn[]`). No pass, contract or strategy can act on it (IRWB-002 item A5). A window superoptimizer (section 14) needs either that artifact or a way to rewrite the finished image. Section 22 discusses both.

## 8. The target: `noise3` and `fbm3`, measured

MEASURE-PLACEHOLDER

# Part 2: Background, from scratch

## 9. Rewriting and the phase-ordering problem

A **rewrite rule** `l → r` says that any term matching the pattern `l` may be replaced by the corresponding instance of `r`. A rewriting pass applies rules and keeps only the result. This is **destructive** rewriting: once a term has been replaced, the original is gone, and any rule that needed the original shape can no longer fire.

Section 7's integer row is a small instance. Take `(x * 2) * 3` and two rules: `mul-pow2` (`x * 2^k → x << k`, in the table) and a reassociation rule `(x * c1) * c2 → x * (c1·c2)` (**Proposed**; exact modulo 2³², because multiplication in ℤ/2³² is associative).

```text
bottom-up, mul-pow2 first:    (x * 2) * 3  →  (x << 1) * 3        reassociation no longer matches: 3 instructions
reassociation first:          (x * 2) * 3  →  x * 6                                                2 instructions
```

`Tx.rewrite` visits children before parents, so `mul-pow2` sees the inner product first. Today's O2 has no reassociation rule at all, and the measured output is `(x << 1) * 3` (`various/04-phase-order-example.txt`). With both rules, the result depends on their order. This is the **phase-ordering problem** at the scale of one expression. O2's hand-scheduled sequence `fold, simplify, constprop, fold, simplify` approximates "apply until nothing changes" by repetition. IRWB-002 measured the same problem at the scale of passes: one extra `subst` after O2 improved 11 of 44 corpus projects (IRWB-002 guide section 12.1).

## 10. E-graphs and equality saturation

An **e-graph** stores many equivalent terms at once, without choosing among them. It has two kinds of object:

- **An e-node** is an operator applied to e-classes, for example `mul(c1, c2)`, where `c1` and `c2` are classes, not terms. Constants and leaves are e-nodes with no children.
- **An e-class** is a set of e-nodes known to compute the same value. Its identity is maintained by a **union-find** structure: merging two classes is `union(a, b)`, and `find(a)` gives the class's current representative.

An e-graph **represents** a term if, starting from the term's root class, you can choose one e-node per class recursively until you reach leaves. One e-graph of a few dozen nodes can represent thousands of terms.

Three operations make it work.

1. **Hash-consing.** Adding an e-node first canonicalizes its children (`find` on each). If an identical e-node already exists, the existing class is returned. Equal subterms are therefore stored once.
2. **E-matching.** To apply a rule `l → r`, search the e-graph for all `(class, substitution)` pairs where `l` matches some e-node in the class. Then add `r` under each substitution and `union` its class with the matched class. The left-hand side is never removed.
3. **Rebuilding (congruence closure).** After unions, two e-nodes may have become equal because their children are now equal: if `a ≡ b`, then `f(a) ≡ f(b)`. `rebuild` re-canonicalizes e-nodes and merges such parents until the invariant holds again.

**Equality saturation** repeats match, apply and rebuild until no rule adds anything (the graph is *saturated*) or a budget on nodes, iterations or time runs out. A cost-based **extraction** then picks one term per class (section 11). The idea was introduced by Tate, Stepp, Tatlock and Lerner (*Equality Saturation: a New Approach to Optimization*, POPL 2009). The `egg` library of Willsey, Nandi, Wang, Flatt, Tatlock and Panchekha (*egg: Fast and Extensible Equality Saturation*, POPL 2021) introduced rebuilding as a separate, batched step and **e-class analyses**: a value per class (a constant, an interval), merged when classes merge, which guards can read. Congruence closure itself goes back to Nelson and Oppen (*Fast Decision Procedures Based on Congruence Closure*, JACM 1980).

Here is the example of section 9 in an e-graph. The rules are `mul-pow2` and the proposed reassociation, and the classes are numbered:

```text
 start:   c1 = {x}   c2 = {2}   c3 = {mul(c1, c2)}   c4 = {3}   c5 = {mul(c3, c4)}

 mul-pow2 matches mul(c1, c2) in c3 (k = 2):          add shl(c1, c6) with c6 = {1};  union(c3, ·)
          c3 = {mul(c1, c2), shl(c1, c6)}
 reassociation matches mul(c3, c4) via mul(c1,c2)∈c3:  add c7 = {6}, mul(c1, c7);  union(c5, ·)
          c5 = {mul(c3, c4), mul(c1, c7)}
 saturated: no rule adds a new e-node

 c5 represents  (x * 2) * 3,  (x << 1) * 3,  x * 6
 extraction (instruction counts of section 7):  x * 6  — 2 instructions
```

Nothing was lost by applying `mul-pow2` first. Both shapes stay in `c3`, and reassociation still finds the multiplication.

**Why the restricted scope.** In production compilers the full program does not usually go into an e-graph. Cranelift's design, called an *ægraph*, keeps the control-flow graph and all side-effecting instructions as a fixed skeleton and lets only pure value computations into the graph. IRWB-002 item B4 proposes the same split here, and the IR makes it natural: pure value trees are exactly the unit Section 2 described. Two dangers are well known. Rules for associativity and commutativity make the graph grow exponentially, and a graph without a budget may never saturate. Both are reasons for the budget in the pseudocode of section 17.

## 11. Extraction, and why one-user trees make it easy

**Extraction** chooses, for each class reachable from a root, one e-node, so that the resulting term minimizes a cost. With an additive cost (the cost of a term is the cost of its root e-node plus the costs of the terms chosen for its children), a bottom-up fixpoint gives the optimum for *trees*:

```text
best(c) = min over e-nodes n in c of   cost(n) + Σ best(child class of n)
iterate until no best(c) changes (classes can be cyclic; costs are positive, so this terminates)
```

The well-known weakness is **sharing**. If the extracted program uses one class in two places, a DAG pays for it once but the formula counts it twice. Optimal DAG extraction is NP-hard in general. In `typed.blocks`, a value has one user, so the program is a set of trees and the tree formula is the true cost. This holds as long as the e-graph's input is one tree per statement and its output is written back as one tree per statement. It stops holding as soon as the graph spans statements through SSA names (section 17), because then one extracted class may serve two statements.

**The cost has to be the backend's.** Counting nodes is not enough, because the RV32 tiles of section 7 make costs non-uniform: a 12-bit constant operand of an integer add is free (`addi`); a larger one costs `lui` plus `addi`; every f32 constant costs two or three instructions at each use; `x * 2^k` costs one `slli`; a comparison feeding a branch is fused into the branch. Some tiles span several nodes (a load with its offset folded in, a compare fused into `blt`), so a per-node cost is an approximation. Two remedies are open (section 19). One is a cost per e-node that looks one level down, at whether a child class contains a suitable constant. The other is to lower the few best candidates and count real instructions. **Execution frequency** matters too. A statement in `fbm3`'s octave loop runs many times per call, so the cost a search minimizes should be weighted by heat (section 8).

## 12. Explanations: an e-graph that produces its proof

Each `union(a, b)` in an e-graph has a reason. Either a rule instance (rule `r` with substitution `σ` matched in `a` and produced `b`) or congruence (`f(x) ≡ f(y)` because `x ≡ y` was established earlier). If every union records its reason, then for any two terms the graph considers equal, the graph can produce an **explanation**: a sequence of rewrite steps, each one an instance of a rule or a congruence step, leading from one term to the other. Nieuwenhuis and Oliveras showed how congruence closure can produce such proofs (*Proof-Producing Congruence Closure*, RTA 2005). `egg` provides explanations (Willsey et al., POPL 2021), and Flatt, Coward, Willsey, Tatlock and Panchekha studied how to make them short (*Small Proofs from Congruence Closure*, FMCAD 2022).

What this offers the project is a proof object for the whole extracted tree, not just a sampled verdict:

```text
explanation for  (x * 2) * 3  =  x * 6 :
   step 1  rule reassoc-mul-const@1  σ = { x: x, c1: 2, c2: 3 }      evidence: <fingerprint>, strength S1
   (one step; if mul-pow2 had been applied first, the chain would be:
    (x*2)*3 ← (x<<1)*3 is not needed: extraction never chose that e-node)
check(explanation):
   for each step: the rule is in the table at that version; its evidence record's fingerprint matches;
                  the substitution instantiates the rule's lhs to the step's input and its rhs to the output;
                  its guards hold on the substitution (pow2, pure, noTrap: decidable on the tree)
   congruence steps: structural (same operator, children equal by earlier steps)
   the tree's assurance = the weakest strength on the chain
```

Two properties make this a good fit.

- **Only verified rules may merge classes** (section 18). Every link of every explanation is then a rule with a fingerprinted evidence record. The extracted function has a checkable equivalence proof whose strength is the minimum of the strengths of the rules it uses: `proof` if all are proofs, `sampled` if one is sampled.
- **The checker is small and independent.** It needs to match patterns and compare trees. It does not need the e-graph. This is the shape of IRWB-002 item D4 (passes that carry their proof) and of IRWB-008's exact checking for edits that cite verified rules (section 26).

## 13. Discovering rules by enumeration

Rules can be generated rather than written. The method of Nandi, Willsey, Zhu, Wang, Saiki, Anderson, Schulz, Grossman and Tatlock (*Rewrite Rule Inference Using Equality Saturation*, the Ruler system, OOPSLA 2021) has three steps, and the project already has the third:

1. **Enumerate** every term up to a size over a chosen set of operators, variables and constants.
2. **Fingerprint** each term by its values on a fixed set of inputs. Ruler calls this a characteristic vector. Terms with equal fingerprints are candidate equalities, and each pair becomes a candidate rule from the costlier term to the cheaper.
3. **Verify** each candidate and keep those that hold. Then **minimize**: drop a rule if the rules already kept can derive it. Ruler does this with an e-graph, by saturating with the kept rules and checking whether the candidate's two sides fall into one class.

IRWB-002 item B3 sketches this with `verifyRule` as step 3:

```text
terms  <- all trees of size <= n over ops O, variables {a, b}, constants K
for t in terms:  fp[t] <- outcomes of t on 64 fixed inputs (boundary values + random)
for each group G of equal fp:
    r <- cheapest member of G by backend cost
    for t in G, t != r:  candidate t -> r
keep candidates with verifyRule(...).verdict = 'sound'; drop those derivable from kept ones
```

The fingerprint inputs decide what you find. For f32 they must include the special values (`F32_SPECIALS`, `src/typed/rules/semantics.ts:168`: 25 bit patterns including non-canonical NaNs), or every real-number identity will look like a candidate and the verifier will spend its budget rejecting them.

## 14. Superoptimization

A **superoptimizer** searches for the shortest (or cheapest) instruction sequence equivalent to a given one, instead of improving the given one by rules. Massalin coined the term and searched exhaustively over short sequences (*Superoptimizer: A Look at the Smallest Program*, ASPLOS 1987). Later systems made the search practical:

- **Learned peephole rules.** Bansal and Aiken harvested short windows from real programs, superoptimized them offline, and stored the results as a table of peephole rules (*Automatic Generation of Peephole Superoptimizers*, ASPLOS 2006).
- **Stochastic search.** STOKE, by Schkufza, Sharma and Aiken, searches by Markov-chain sampling (*Stochastic Superoptimization*, ASPLOS 2013).
- **Goal-directed search with e-graphs.** Denali, by Joshi, Nelson and Randall, used equality reasoning to enumerate candidate machine programs (*Denali: a Goal-Directed Superoptimizer*, PLDI 2002).
- **Synthesis at the IR level.** Souper, by Sasnauskas, Chen, Collingbourne, Ketema, Lup, Taneja and Regehr, synthesizes replacements for LLVM IR fragments and was used to report missed optimizations to LLVM (*Souper: A Synthesizing Superoptimizer*, arXiv preprint 1711.04422, 2017).

The common structure, applied to this project's machine code:

```text
window W = k consecutive instructions in one block, no branch or label inside (k <= 4)
live_in  = registers W reads before writing;  live_out = registers read after W (machine liveness)
tests    = 32 register states: boundary values and random values for live_in
for n = 1 .. k-1:
    for each sequence S of n instructions over W's registers and immediates:
        if S agrees with W on tests (for live_out and memory):
            if S agrees with W on 10^6 states (or exhaustively, or by a decision procedure):
                record peephole W -> S   (canonical up to register renaming)
```

Testing first and verifying second is what makes this affordable: almost every candidate fails on the first test state. The output is not a new program but a **rule over machine code**, verified once and applied by an ordinary pass. That is why B5 depends on machine code becoming an artifact (section 22).

## 15. Related work, collected

| work | what to take from it | cited in |
|---|---|---|
| Nelson and Oppen, JACM 1980 | congruence closure | §10 |
| Massalin, ASPLOS 1987 | superoptimization by exhaustive search | §14 |
| Joshi, Nelson and Randall, PLDI 2002 (Denali) | e-graph reasoning to enumerate machine code | §14 |
| Nieuwenhuis and Oliveras, RTA 2005 | proof-producing congruence closure | §12 |
| Bansal and Aiken, ASPLOS 2006 | peephole rules harvested and superoptimized offline | §14, §22 |
| Tate, Stepp, Tatlock and Lerner, POPL 2009 | equality saturation for optimization | §10 |
| Schkufza, Sharma and Aiken, ASPLOS 2013 (STOKE) | stochastic superoptimization | §14 |
| Lopes, Menendez, Nagarakatte and Regehr, PLDI 2015 (Alive) | peephole rules verified once, as data | §18 |
| Willsey et al., POPL 2021 (egg) | rebuilding, e-class analyses, explanations | §10, §12 |
| Nandi et al., OOPSLA 2021 (Ruler) | rule inference: enumerate, fingerprint, verify, minimize | §13 |
| Flatt et al., FMCAD 2022 | short explanations from congruence closure | §12 |
| Sasnauskas et al., arXiv 2017 (Souper) | IR-level synthesis; missed optimizations reported to a compiler | §14, §21 |

Cranelift's ægraph is a design in a production compiler, documented in that project's own design notes rather than in a paper this guide can cite with certainty; it is mentioned for its scope (pure values only), not for details.

# Part 3: The design space

## 16. The whole loop

```text
   ┌────────────────────────────── heat (03-heat) ────────────────────────────────┐
   │                                                                               │
   ▼                                                                               │
 hot statements ──provenance: which rule touched this tree?──► "no rule fired" set  │
   │                                                                               │
   ▼                                                                               │
 shapes (02-value-tree-shapes) ──► targeted enumeration (B3) ──► candidates        │
                                                                    │              │
                                                     verifyRule (B2) ▼              │
                                                  sound ──► rule table @version     │
                                                  unsound ─► rejected, with counterexample
                                                                    │              │
   typed.blocks rK ──► eqsat pass (B4): per tree, saturate with the table,          │
                       extract by RV32 cost, write ONE revision whose edits         │
                       cite rule@version#fingerprint and carry the explanation      │
                                                                    │              │
                       gate: meaning-kept vs r0 (+ explanation check, IRWB-008)     │
                                                                    │              │
                       backend ──► rv32.image ──► window superoptimizer (B5) ───────┘
                                                  (peephole table over machine code)
```

Each arrow is a separate, measurable step, and each has its own experiment in Part 4. The loop is closed by heat: after the new rules and the e-graph pass, the hot statements are measured again, and the ones that are still hot and still untouched are the next targets.

## 17. Decision: what enters the e-graph

| scope | leaves are | sharing | extraction | fits today's IR | cost |
|---|---|---|---|---|---|
| **one statement's tree** | `get` of locals, constants | none | exact (tree) | yes: replace the tree in place | small graphs; one per statement |
| one block's trees | the same, with locals assigned in the block as barriers | through locals only | exact per tree | yes | larger graphs, still bounded |
| an SSA region | SSA names; φ as opaque leaves | through names | DAG: tree formula overcounts | needs temporaries to express sharing | the GVN step; needs `typed.ssa` |

**Recommendation for the first experiment: one statement's tree.** It needs nothing that does not exist, every result is a drop-in replacement for one tree, extraction is exact, and the explanation is per statement. Per block adds little for `noise3`, whose straight-line code is a sequence of independent assignments. The SSA region is the research step. It needs a way to write a shared class back (a new local assigned once, which `lvn` already does within a block), and a different extraction (greedy DAG, or integer programming).

```text
eqsat(tree t, table T, budget):                                      # Proposed
  g <- EGraph();  root <- g.add(t)            # pure subtrees only; an impure node is an opaque leaf
  for iter in 1 .. budget.iterations:
      matches <- [(r, σ, c) for r in T for (c, σ) in ematch(g, r.lhs) if guards(r, σ, g.analysis)]
      if none new: break
      for (r, σ, c) in matches:  g.union(c, g.add(r.rhs σ), reason = (r.name, r.version, σ))
      g.rebuild()
      if g.nodes > budget.nodes: break         # record 'budget' in the report
  best <- extract(g, root, rv32Cost)
  return best if cost(best) < cost(t) else t, with explanation(g, t, best)
```

## 18. Decision: which rules may merge classes

**Only rules with recorded, fingerprint-matched evidence may enter the table an e-graph uses.** This is the rule that makes explanations worth having. Three sub-decisions follow.

- **The minimum strength.** `proof`, `exhaustive` and `by-construction` are exact. `reduced-width+argument` is exact only if the argument is accepted. `sampled` is not exact. A table may admit sampled rules and mark every explanation that uses one as sampled, or it may refuse them. The first is more productive, the second gives cleaner proofs. *Open*, but the explanation must report the weakest strength on its chain whichever way it is decided.
- **Guards as e-class analyses.** Today's guards (`pure`, `pow2`, `boolean`, `noTrap`) are decidable on the matched tree. Discovered rules will want guards such as "x ≥ 0" (from `ranges`) or "x is not a non-canonical NaN". In an e-graph these become analyses per class. For example, `nanCanonical(c)` is true when every e-node in `c` is an arithmetic result, because every NaN the evaluator computes is canonical (`src/typed/f32.ts:11`; IRWB-005 diary step 14). That fact would make `x * 1.0 → x` valid on computed operands, where today it is wrong in general.
- **Three classes of f32 rule.** The pattern census of section 8 counts each class.
  - **Exact for every bit pattern.** Examples: `x * 2.0 → x + x`, `−(−x) → x`, `|−x| → |x|`. They can go into an exact table. `x * 2.0 → x + x` is exact because both sides round the same real value 2x once, and both return the canonical NaN for any NaN input (`f32.ts:58–60`). This is a claim for the verifier to confirm, not a recorded result yet.
  - **Exact except for NaN payloads.** Examples: `x * 1.0 → x`, `x + (−0) → x`, `x / 1.0 → x`. These are wrong for a non-canonical NaN input and correct otherwise. They need the `nanCanonical` guard.
  - **Inexact.** Contraction into a fused multiply-add, reassociation, and replacing `x / c` with `x · fl(1/c)`. These change the last bit and do not belong in an exact table at all. They are IRWB-011's subject: under a tolerance contract judged on rendered frames, they become checked trades, and IRWB-011 measures their image-level effect on Candela.

## 19. Decision: extraction with the RV32 cost

| option | cost function | accuracy | price |
|---|---|---|---|
| node count | 1 per e-node | poor (ignores constants and tiles) | free |
| **static tile cost** | per e-node, from `select.ts`'s tiles: immediate fits 12 bits, f32 constant = 2–3, `mul` by 2^k = 1, compare-into-branch fused | good for straight-line trees | a table to maintain beside `select.ts` |
| lowered | lower the k best trees and count instructions | exact for the instruction count | k lowerings per tree |
| heat-weighted | static cost × execution count from heat | targets what runs | needs a profile run first |

The proposed default is **static tile cost, weighted by heat where a profile exists**. Every result should be validated by actually lowering, on a sample, and reporting where the static estimate disagreed. IRWB-003 built a static per-function estimate for choosing backend options. The guide there (section 14) is the model for how to calibrate one against measurement.

## 20. Decision: how an e-graph fits "one revision per pass"

The e-graph is **an internal tool of one pass application**. Nothing about it is published except its result:

```text
 rK ──eqsat pass──► rK+1                     (one revision, as for any pass)
        │
        ├── edits:  for each changed statement: { kind: 'replace', stmt, field, from: <old tree>, to: <new tree> }
        ├── origins of the new values:  via 'eqsat', rev K+1,
        │       because: [ 'rule:simplify/mul-pow2@1#<fp>', 'rule:discovered/fmul-two@1#<fp>', … ],
        │       note: the explanation, one step per line (or a reference to it in the pass report)
        ├── correspondence: old tree's root -> new tree's root (relation 'rewritten')
        └── report: per tree: graph size, iterations, stop reason (saturated | budget), cost before/after
```

- **The pipeline gets its own name** (for example `O2-eqsat`, **Proposed**). The `because` now cites rules, so the revisions differ from O2's, and O2 stays frozen because it reproduces the book's numbers (IRWB-002 guide section 9.4).
- **The gate is unchanged.** `meaningKept` against r0 runs as for every pass. The explanation adds a second, independent check, not a replacement. Section 4 showed that the sampled gate has measured holes; the explanation check has different ones (it trusts the evidence records), so both together are stronger than either.
- **`why` still works.** A new value's origin names the old tree as `from`, so `Program.why` reaches the source line through it. The rule citations appear in `because`, where today a reader sees constant operands.

## 21. Decision: the missed-optimization loop from provenance

The loop turns the question "which rules are missing?" into a measurement.

```text
missed(program rN, image, heat):                                      # Proposed
  for each statement s, by executed instructions (heat), descending:
      tree <- s's value tree at rN
      touched <- any origin on the path from tree's nodes back to r0 has via in {simplify, fold, eqsat}
      if not touched and tree is pure:
          shape <- tree with locals abstracted to variables, constants kept or abstracted
          report (shape, executed instructions, source line)
  group the report by shape; the top shapes are the enumeration targets of B3
```

The starting evidence is already in the diaries: 18 of `simplify`'s 27 rules never fire on the corpus's O2, and on Candela's O2 four of them fire (section 5), and no f32 operator has any rule. Section 8 adds which shapes `noise3` and `fbm3` are made of.

The loop's output feeds **targeted enumeration**. Instead of all terms of size 3, enumerate terms over the operators and constants that occur in the hot shapes. For `noise3` that means `fmul`, `fadd` and `fsub` with the constants 2.0, 3.0 and 1.0. The search stays small, and every rule found applies to code that runs. Souper's experience with LLVM suggests that a synthesizer pointed at real code finds peepholes a hand-written set lacks (Sasnauskas et al., 2017). Whether that holds for this compiler's much smaller rule set is exactly what experiment E5 measures.

## 22. Decision: the superoptimizer over hot RV32 windows

There are two ways to get at machine code.

| option | what exists | what is missing | provenance |
|---|---|---|---|
| **A5 first**: `rv32.mir` as a registered IR between `select` and `encode` | `MInsn[]` inside `compileFunction` | an IR definition, an adapter, a contract (`image-agrees` lifted to MIR) | a rewritten window covers the union of the old instructions' `covers` |
| rewrite the finished image | `rv32.image` with `covers`, `runImage`, decoder | relocation of branch targets when length changes; or keep length with `nop`s (measurement only) | the same |

Rewriting the finished image is good enough for a **census**, the first experiment E6. Collect windows, deduplicate them up to register renaming, and count how many have a shorter equivalent. Patching the image with `nop`s preserves addresses and so measures error and executed-instruction savings without a relocation pass. IRWB-011's `scripts/03-float-candidates.mjs` does exactly this for fused multiply-adds. For a real optimization, A5 is the right foundation, because peepholes become rules over a registered IR with their own evidence. The equivalence check of a window uses the emulator's instruction semantics: test states first, then exhaustive or SAT-based verification for windows over at most two input registers.

## 23. Does checked data scale to search?

This is the research question, and it should be answered with numbers, not argued. The costs to measure are:

| step | cost driver | known numbers |
|---|---|---|
| verify one candidate rule | methods; exhaustive 2³² is 50 s (i32, one variable) to 623 s (f32 candidate) | IRWB-006 diary steps 6, 10 |
| one pass application on Candela | framework (projection, hashing, diff), not the pass's own work | 10.7–14.3 s for the `simplify` table, 10.9–11.6 s for the hand-written pass (IRWB-006 step 5, before IRWB-004) |
| the meaning check | cases × functions, r0 cached since IRWB-004 | 13,280 cases per pass on Candela (IRWB-002 guide §16) |
| an explanation check | proportional to explanation length | none yet |
| evidence storage | one record per rule; explanations per edit | `evidence.ts` is 2,086 lines for 67 rules |

Two outcomes are possible, and both are results. If candidate verification dominates, the project needs a decision procedure for bit-vector formulas, which is the same machinery IRWB-008 needs, and a cache of evidence by rule fingerprint. If the framework's per-pass cost dominates, then one e-graph pass replacing `fold, simplify, fold, simplify` saves wall time, and IRWB-009's function-incremental framework is the multiplier.

# Part 4: First experiments and decision criteria

Each experiment states its question, its setup, what to measure, and when to continue or stop. E0 is done; its numbers are in section 8.

**E0. Census of the target (done).** Shapes, constants and pattern counts of `noise3`, `fbm3` and their callees at r0 and O2, and their share of executed instructions in two scenes that call them. Scripts `01-candela-o2-head.mjs`, `02-value-tree-shapes.mjs` and `03-heat.mjs`.

**E1. Integer rule discovery at size 3 (B3).**
- *Setup.* Operators `add, sub, mul, and, or, xor, shl, shr, shru` and comparisons; variables `a, b`; constants `0, 1, −1, 2, MIN`. Fingerprint on 64 inputs drawn from `boundaryI32()` and a seeded generator. Filter by `verifyRule` in fast mode, then record evidence for the survivors.
- *Measure.* Candidates; sound rules; rules not derivable from `simplify` (by saturating with `simplify`'s rules); verifier time; firings on the corpus and on Candela's O2 when the new rules are appended to a copy of the table in a new pipeline; instructions on the corpus (77,321 under O2; IRWB-002 guide §12.1) and bytes (5,160).
- *Continue if* at least one new rule fires on Candela's hot code (heat > 0.1 % of a frame) or the corpus instructions fall.
- *Stop if* no discovered rule fires on Candela at all: then the integer side is not where the gains are, and E2 is the priority.
- *Must hold.* Zero rejections by the meaning check across all applications. A rejection means the verifier has a hole, which is a finding more important than the rule.

**E2. Exact f32 rules for the shapes of `noise3` (B3, f32).**
- *Setup.* Targeted enumeration over `fmul, fadd, fsub, fneg` with the constants of section 8. Fingerprint on `F32_SPECIALS` and random values. Verify with the f32-special and random methods, and exhaustively over 2³² for one-variable rules.
- *Measure.* The sound rules; whether `x * 2.0 → x + x` is among them, and its evidence strength; firings in `noise3` and `fbm3`; executed instructions per pixel on the scenes of section 8 before and after (the rule removes the constant's `lui` and `fmv.w.x`).
- *Continue if* per-pixel instructions fall on X-03 by at least the share that section 8's constant-building count predicts.
- *Stop if* the only sound rules are already in the candidates file. In that case the f32 gains are all inexact and belong to IRWB-011.

**E3. Per-statement equality saturation with today's tables (B4's first experiment).**
- *Setup.* A framework-independent e-graph (union-find, hash-consing, rebuild, e-matching over the rule form of `form.ts`). One graph per statement tree, with the `simplify` and `fold` tables and the proposed reassociation rule. Extraction by static tile cost.
- *Measure.* Against O2's `fold, simplify, fold, simplify` on every corpus project: instructions, bytes, graph sizes, the share of trees that hit the node budget, pass time on Candela.
- *Continue if* the pipeline in which one `eqsat` replaces those four passes matches `O2+` on every project and wins on at least one.
- *Stop if* it loses on any project after the cost model is calibrated. The loss then shows a cost-model or rule-set defect to fix before going on.

**E4. Explanations, checked.**
- *Setup.* E3's pass records an explanation per changed tree. A separate checker replays it against the rule tables and their evidence.
- *Measure.* The share of changed trees whose explanation checks; explanation length; checker time; for each tree, the weakest strength on its chain.
- *Continue if* every explanation checks. Feed the result to IRWB-008 as the first producer of rule-citing edits.
- *Stop if* explanations are routinely longer than the trees they explain. Then a minimization step is needed first, as Flatt et al. study.

**E5. The missed-optimization loop on X-03.**
- *Setup.* Section 21's report on the O2 head's image, rendering X-03. Take the ten hottest untouched shapes and enumerate for them.
- *Measure.* How many new sound rules apply to those shapes, and the executed instructions they save.
- *Continue if* the loop finds a rule for at least one of the ten.
- *Stop if* it finds none for any. That says the remaining cost is not algebraic (calls, constants, copies), as IRWB-003 found, and the effort belongs there.

**E6. A window census for B5.**
- *Setup.* Windows of 2 and 3 instructions from the hot functions' images (heat > 0). Deduplicate them up to register renaming. Enumerate sequences of length 1 and 2 over the base integer and F instructions with the window's registers. Test on 32 states.
- *Measure.* Distinct windows; windows with a shorter equivalent; the executed instructions they cover.
- *Continue if* the windows with a shorter equivalent cover at least 1 % of a frame's executed instructions. That threshold is a judgement, and it should be revisited when the experiment is designed.
- *Stop if* they cover less than 0.1 %. Then A5 is not worth building for this purpose alone.

# Part 5: Risks, open questions and connections

## 24. Risks

| risk | why it is real here | mitigation |
|---|---|---|
| e-graph blowup | commutativity and associativity rules; `noise3`'s trees have depth up to the figure in §8 | node and iteration budgets; per-statement scope; report budget hits |
| extraction picks a tree the backend lowers worse | tiles span nodes; f32 constants cost per use | validate by lowering; calibrate the static cost (§19) |
| a sound-looking rule is wrong at 32 bits | reduced-width evidence needs an argument; sampled evidence is not a proof | strength in every explanation; the gate still runs; mutation testing (IRWB-005) of the new pass |
| discovered rules are useless | Candela's cost is calls and constants (IRWB-003), not algebra | E1/E2 stop criteria; E5 measures it directly |
| verification cost dominates | 50–623 s per exhaustive check | fast mode first; evidence cached by fingerprint; a bit-vector decision procedure (shared with IRWB-008) |
| revisions change, so parity tests do not apply | rule citations in `because` | a new pipeline name; O2 and its tests untouched |
| provenance grows | an explanation per edited tree | store explanations in the pass report, reference them from `because` |

## 25. Open questions

1. Should a table admit `sampled` rules, marking explanations accordingly, or only exact ones (§18)?
2. What is the right representation of a guard that needs a fact (`ranges`, `nanCanonical`)? Is it an e-class analysis computed inside the graph, or a fact cited from the analysis manager with its revision?
3. Is a static tile cost good enough, or does extraction need to lower candidates (§19)? How large is the disagreement on `noise3`?
4. When the graph spans an SSA region, how is a shared class written back into one-user trees, and which extraction replaces the tree formula?
5. Does an explanation check allow skipping any part of the sampled gate for that pass (IRWB-008's question), and under what strength?
6. For B5, is `rv32.mir` (A5) worth building for peepholes alone, or only together with H1's tile table?
7. How do discovered rules get names and versions that stay stable when the enumerator is re-run?
8. Can the verifier's `symbolic-linear` method be extended to polynomial identities over ℤ/2³², so that a discovered rule such as `(x · c1) · c2 → x · (c1 c2)` gets `proof` instead of `sampled`?

## 26. How this connects to the other tickets

- **IRWB-006** (merged) supplies the rule form, the compiler, the verifier, the evidence and the SSA view. This ticket is its continuation from "rules as data" to "rules as a search space".
- **IRWB-008** (exact checking for edits that cite verified rules) is the consumer of section 12's explanations. An eqsat pass is the natural producer of edits whose every step cites a verified rule, and IRWB-008's checker is the natural checker of section 12's `check(explanation)`. IRWB-008's "version 2 of the meaning check as the standard for new pipelines" applies to `O2-eqsat`, which is a new pipeline.
- **IRWB-009** (a function-incremental framework) changes the economics of section 23. If a pass costs time proportional to what it changes, a search that tries many candidates per function becomes affordable. A persistent store keyed by tree hash would let identical trees reuse their extraction, and Candela's per-scene sections repeat many small trees.
- **IRWB-007** (specializing Candela on its scene data) creates constants where today there are loads. More constants mean more `fold` firings and new shapes for the enumerator, so the census of section 8 should be repeated on a specialized program.
- **IRWB-011** (image-level contracts for float freedom) owns the inexact f32 rewrites of section 18. Contraction, reassociation and reciprocals cannot enter an exact table. Under IRWB-011's tolerance contract they become candidates judged on rendered frames. IRWB-011 has measured them on Candela.
- **IRWB-003** (not merged, `90fed9c`) closed most of the speed gap with inlining, coalescing and constants in registers. Its `homes` option keeps f32 constants in registers, which competes with `x * 2.0 → x + x` for the same instructions. Section 8's constant-building count should be re-measured with IRWB-003's options before E2's gain is claimed.
- **IRWB-005** (not merged, `d9cf4e9`) supplies the mutation harness that should test any new search pass, and the finding that the default gate's weak spot on Candela is float code in narrow input regions.

# Appendix A: API reference

| symbol | file:line | role here |
|---|---|---|
| `ValueOp`, `ValueRec`, `StmtRec`, `Origin` | `src/typed/model.ts:35`, `:168`, `:148`, `:103` | what a tree is; what provenance records |
| `Store.from`, `toNative` | `src/typed/model.ts:306`, `:375` | working copy of a revision; live entities only |
| `typedPass` | `src/typed/passes.ts:166` | how a pass is written |
| `PIPELINES` | `src/typed/passes.ts:1046` | O2 and friends (frozen) |
| `Tx.rewrite`, `Tx.const`, `Tx.make`, `Tx.replace` | `src/typed/tx.ts:431`, `:217`, `:236`, `:482` | edits with origins |
| `applyPass` | `src/framework/passes/define-pass.ts:190` | the gates |
| `meaningKept`, `agrees`, `casesFrom`, `F32_EDGES` | `src/typed/evaluate.ts:587`, `:554`, `:232`, `:196` | the meaning check |
| `Rule`, `Pat`, `Guard`, `Tpl`, `rule`, `ruleSet` | `src/typed/rules/form.ts:58`, `:30`, `:41`, `:53`, `:114`, `:142` | the rule form |
| `SIMPLIFY_RULES`, `FOLD_RULES` | `src/typed/rules/simplify.ts:14`, `fold.ts:55` | the tables |
| `compileRules`, `tableBody`, `firstMatch`, provenance | `src/typed/rules/compile.ts:119`, `:133`, `:93`, `:72` | applying a table |
| `verifyRule`, `RuleEvidence`, `Strength`, `ruleFingerprint` | `src/typed/rules/verify.ts:179`, `:64`, `:63`, `:87` | the verifier |
| `F32_SPECIALS`, `boundaryI32`, `BIN`, `compileSide` | `src/typed/rules/semantics.ts:168`, `:175`, `:35`, `:80` | semantics at any width |
| `UNSOUND_CANDIDATES`, `F32_SOUND_CANDIDATES` | `src/typed/rules/candidates.ts:12`, `:43` | test rules |
| `ssaOf`, `ssaView`, `checkSsa`, `SsaFn` | `src/typed/ssa.ts:60`, `:243`, `:325`, `:42` | the SSA view |
| `sccp`, `SSA_PIPELINES` | `src/typed/sccp.ts:141`, `:171` | the SSA consumer |
| `F32_BINARY`, `F32_UNARY`, `f32Op` | `src/typed/f32.ts:57`, `:76`, `:142` | f32 semantics on bits |
| `lowerToImage`, `ImageInsn`, `runImage`, `heat` | `src/typed/backend/compile.ts:429`, `image.ts:32`, `run.ts:74`, `run.ts:175` | lowering, heat |
| `RewriteMode` (incl. `saturate`) | `src/framework/ir/rewrites.ts:131` | the framework's unused rule engine (74× slower than the compiled matcher on IRWB-006's cross-check) |

# Appendix B: Files

| path | why it matters |
|---|---|
| `src/typed/rules/` | the rule form, tables, compiler, verifier and evidence this ticket extends |
| `src/typed/ssa.ts`, `src/typed/sccp.ts` | the SSA view, the leaves of a cross-statement e-graph |
| `src/typed/backend/select.ts` | the tiles an extraction cost must model |
| `corpus/candela-gallery/kernel.typed:147–184`, `:2690–2708` | `gnoise`, `noise3`, `fbm3`, `hash3` |
| `corpus/candela-gallery/scenes.typed` | the scene sections that call `fbm3` and `noise3` |
| `ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md` | items B1–B6, D3, D4 |
| `ttmp/2026/11/25/IRWB-006--*/log/01-implementation-diary.md` | rule firings, evidence, SSA validation |
| this ticket's `scripts/` and `various/` | E0's measurements |

# Appendix C: Glossary

- **e-node, e-class, e-graph.** An operator applied to classes; a set of e-nodes known equal; the structure holding both (§10).
- **equality saturation.** Apply rules without discarding, until nothing new is added or a budget runs out, then extract (§10).
- **extraction.** Choosing one term per class by a cost (§11).
- **explanation.** A chain of rule instances and congruence steps proving two terms equal (§12).
- **evidence, strength.** A rule's recorded verification result and how strong its method is (§5).
- **fingerprint (of a term).** Its outcomes on fixed inputs, used to group candidate equalities (§13); distinct from `ruleFingerprint`, the hash of a rule record (§5).
- **heat.** Executed instructions per instruction, statement, function or line (§7).
- **superoptimizer, window.** A search for the shortest equivalent instruction sequence; the short instruction run it searches over (§14).
- **SSA view.** `typed.ssa`, a fact that names every definition once and places φ at joins (§6).
