---
Title: 'Intern guide and research agenda: the IR Workbench as it is, and the compiler techniques and frameworks to build next'
Ticket: IRWB-002
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
    - candela
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/core/runtime.ts
      Note: the unused task runtime (F3)
    - Path: repo://src/framework/ir/rewrites.ts
      Note: the unused rule engine workstream B starts from
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass, the gates every agenda item goes through
    - Path: repo://src/typed/backend/select.ts
      Note: hand-written tiling that workstream H replaces
    - Path: repo://src/typed/evaluate.ts
      Note: the evaluator and the meaning check (the soundness gate)
    - Path: repo://src/typed/passes.ts
      Note: the twelve passes and pipelines the agenda extends
    - Path: repo://src/typed/strategies.ts
      Note: strategies, metrics and search
ExternalSources: []
Summary: Part 1 explains the IR Workbench (framework, typed.blocks compiler, backend, workbench, corpus, Candela) from the code. Part 2 is a catalogue of 54 research work items in ten workstreams, each with pseudocode, required APIs, a first experiment and an acceptance measurement. Part 3 is the roadmap.
LastUpdated: 2026-11-24T23:02:49.072296193-05:00
WhatFor: Onboarding a new researcher and choosing what to build next.
WhenToUse: Before starting work on the compiler, and when planning or assigning research items.
---

# Intern guide and research agenda

This guide has two jobs. The first is to explain the IR Workbench well enough that you can open any file in the repository and know what it is for, what calls it and what would break without it. The second is to lay out the work ahead: 54 concrete research items, from plain engineering the project has not done yet to techniques at the edge of current compiler research, each with a first experiment and a number that says whether it worked.

Read Part 1 in order. Its sections build on each other, and Part 2 assumes all of them. Part 2 can be read selectively: start with section 18, which explains the template, then go to the workstream you will work in. Part 3 orders the items and groups them into assignments.

Three conventions hold throughout.

- **Paths are relative to the repository root**, for example `src/typed/passes.ts`. A number after a colon is a line number at commit `a11f6bf`, the commit this guide was written against. Line numbers drift; the symbol name next to them does not.
- **Everything described in Part 1 exists in the code.** Where Part 2 introduces an interface that does not exist yet, it is marked **Proposed**. If you find a statement in Part 1 that the code contradicts, the code is right and the guide has a defect.
- **Numbers are measurements, with their source.** They come from the tests, the tools under `tools/`, the three milestone reports, or the diaries in the IRWB-001 ticket (`ttmp/2026/11/24/IRWB-001--ir-workbench/log/`).

# Part 1: The system as it is

## 1. What this project is

The project is a compiler from **Typed** to **RV32** machine code. Typed is a statically typed subset of JavaScript used to write programs for the PicoCalc, a small handheld computer whose processor executes the RV32 instruction set (32-bit RISC-V). The compiler takes a Typed source file and produces an *image*: the bytes of the machine code, ready to run.

What makes the project unusual is how the compiler is built. It is **defined on a framework** called IR Workbench v6, which treats every step of compilation as data that can be inspected and checked:

- Each form the program takes on its way to machine code is a registered **intermediate representation** (IR): a data format with a validator.
- Each version of the program is an immutable **artifact** whose identity is a hash of its content.
- Each optimization is a **pass** that declares what it reads, what it may change and what it claims to leave intact, and the framework verifies those declarations every time the pass runs.
- Each fact the compiler computes about a program (which variables are live, which values lie in which range) is an **analysis** result cached for one exact artifact.
- Each pass application is accepted only if the new program still **means** what the original meant, as judged by running both on generated inputs.
- Each order in which passes may run is a **strategy**: a small program, stored as JSON, that can try alternatives, measure them and pick one.
- For every statement and every machine instruction, the compiler can answer **why** it exists: what it was made from, by which pass, and on the strength of which fact.

A conventional compiler does all of these things implicitly, inside functions that mutate a shared data structure. Here they are explicit and recorded. The cost is compile time; section 3 gives the numbers. The benefit is that claims about the compiler can be tested by the compiler itself, and that is the property the research agenda in Part 2 builds on. A new optimization, however speculative, cannot silently produce a wrong program, because nothing it produces is published until the meaning check has run.

### 1.1 The running example

One small program appears throughout this guide. It is `corpus/projects/blend/main.typed`:

```js
function blend(work: buffer, n: i32, a: i32, b: i32): i32 {
    const scale = 4 * 16;
    let s = 0;
    for (let i = 0; i < n; i = i + 1) {
        s = s + work.charCodeAt(i) * (a * b + scale);
    }
    return s / 8;
}
```

It has a constant to fold (`4 * 16`), an expression that does not change inside the loop (`a * b + scale`), a bounds check hidden in `charCodeAt`, and a division by a power of two. Compiled without optimization, its image is 96 bytes and executes 531 instructions on a 40-cell buffer with `n = 40`. After the standard pipeline, called O2, the image is 88 bytes and executes 451 instructions. The reference compiler from the PicoCalc toolchain, an independent implementation, gets 383. Those three numbers, and the reasons for the differences between them, come back several times.

### 1.2 The whole path at a glance

```text
 main.typed                        (Typed source text)
     │  vendored front end: parse, type-check, emit        vendor/ds-js-os/
     ▼
 tape                              (stack-machine code, one per function)
     │  lift: stack code -> control-flow graph             src/typed/lift.ts
     ▼
 typed.blocks  r0                  (the main IR; an artifact with a revision hash)
     │  pass 1  ── checked against r0 ──► r1               src/typed/passes.ts
     │  pass 2  ── checked against r0 ──► r2               src/framework/passes/
     │   ...                                               (strategy decides the order)
     ▼
 typed.blocks  rN                  (the optimized program)
     │  select -> allocate registers -> frame -> encode    src/typed/backend/
     ▼
 rv32.image                        (machine code; each instruction lists what it covers)
     │  run on the vendored RV32 interpreter               src/typed/backend/run.ts
     ▼
 result, memory, instruction count

 Checks that cross the chain:
   evaluator(r0)  vs  evaluator(rK)        typed.meaning-kept   (every pass)
   evaluator(rK)  vs  emulator(image)      rv32.image-agrees    (the backend)
   evaluator(r0)  vs  reference image      tools/reference-check.mjs, candela-oracle.mjs
```

Two programs go through this path today. The first is the **corpus**: 44 small projects with 70 functions, inherited from a JavaScript prototype called Compiler Workbench together with a book that states exact numbers for them. The second is **Candela**: a path-tracing renderer of 332 functions and about 12,000 statements, with single-precision floating point throughout. The corpus is where correctness against the prototype is established. Candela is where the compiler meets a program large enough to expose its costs.

## 2. Map of the repository

| path | lines | what it is |
|---|---:|---|
| `src/framework/core/` | 1,645 | canonical data, hashing, artifacts; the task runtime (`Compiler`), not used by the Typed compiler yet |
| `src/framework/strategy/` | 1,868 | the Strategy IR: plans, the interpreter, validation, editing |
| `src/framework/contracts/` | 2,549 | IR types, analyses, invariants, transformation contracts, the `AnalysisManager` |
| `src/framework/ir/` | 3,886 | adapters, views, edits, diff, correspondence, patterns, rewrite schedules |
| `src/framework/dataflow/` | 550 | lattices, the fixpoint solver, dataflow problems as analyses (extension E4) |
| `src/framework/passes/` | 412 | `definePass`, `applyPass`, passes as strategy algorithms (E3, E6) |
| `src/typed/` | 6,690 | the Typed compiler's middle end: model, lifting, evaluator, analyses, passes, strategies |
| `src/typed/backend/` | 2,108 | instruction selection, register allocation, encoding, the image IR, runs |
| `src/workbench/` | 3,875 | the `wb` API the browser UI and project scripts talk to |
| `site-src/` | 5,430 | the browser workbench (plain JavaScript, bundled by `tools/build-site.mjs`) |
| `src/labs/`, `src/conformance/` | 3,659 | v6's own example domains and conformance programs; not part of the Typed compiler |
| `tests/` | 33 files | `node:test` suites: `framework/`, `typed/`, `workbench/` |
| `tools/` | 13 files | corpus parity, the Candela oracle and O2 run, the search experiment, the site build |
| `corpus/projects/` | 44 projects | each with `main.typed`, `project.json`, `notes.md`, `scripts/` |
| `corpus/book/` | 17 chapters | the prototype's book; its numbers are the regression oracle |
| `corpus/candela-gallery/` | 7,164 lines | the Candela gallery program in Typed |
| `vendor/ds-js-os/` | | the Typed front end, the RV32 interpreter and the reference compiler, digest-checked |

The counts come from `scripts/04-code-inventory.sh` in this ticket.

The framework has a layering rule that a test enforces (`tests/framework/layering.test.mjs`): nothing under `src/framework` imports from outside it, and the `strategy`, `contracts` and `ir` layers use only `core/data.ts` and `core/types.ts` from `core`. The consequence for you is that anything generic belongs in `src/framework` and must not know that Typed exists, and anything that mentions a Typed operator belongs in `src/typed`.

To build and test:

```bash
npm run build                               # tsc, output in dist/
npm test                                    # build, then every tests/**/*.test.mjs
node --test "tests/typed/**/*.test.mjs"     # one directory (quote the glob)
node tools/parity.mjs                       # the corpus against the book's numbers
node tools/candela-o2.mjs                   # O2 on Candela, pass by pass (minutes)
npm run build:site && npm run serve:site    # the browser workbench on 127.0.0.1:8765
```

## 3. Artifacts and revisions

Everything the compiler produces is an **artifact**. The type is in `src/framework/core/types.ts`:

```ts
export interface Artifact<T = unknown> {
  readonly id: string;            // a logical name, e.g. 'blend' or 'img:blend'
  readonly revision: string;      // hash of { kind, schemaVersion, value }
  readonly contentHash: string;   // hash of value alone
  readonly kind: string;          // which IR, e.g. 'typed.blocks'
  readonly schemaVersion: string;
  readonly value: T;              // finite, acyclic, deep-frozen JSON
}
```

The value must be finite JSON: no `NaN`, no `Infinity`, no functions, no cycles. That restriction is what makes the next property possible. Two artifacts with equal content have equal revisions, whoever made them and whenever. The revision is therefore a name for *the program itself*, and anything computed from an artifact can be stored under its revision and reused without any invalidation logic. An analysis result for revision `cd36346e…` is correct for every artifact with that revision, forever.

Four functions in `src/framework/core/data.ts` implement this:

| function | signature | what it does |
|---|---|---|
| `canonical` | `(value: unknown) => string` | the one text encoding of a value: keys sorted, `-0` written as `0`, non-finite numbers refused |
| `immutable` | `<T>(value: T) => T` | a validated, key-sorted, deep-frozen copy; returns its argument unchanged if it made it |
| `fingerprint` | `(value: unknown) => string` | SHA-256 of the canonical text |
| `sameCanonical` | `(a, b) => boolean` | structural equality of two canonical values without encoding them |

`createIRArtifact(adapter, id, value)` in `src/framework/ir/adapters.ts:120` validates a native value with its adapter, freezes it and computes both hashes.

**Why this design, and what it costs.** Content-derived identity removes a whole class of compiler bugs: a stale fact used after the program changed. It also makes every experiment reproducible, because the same input and the same passes give the same revision hash. The cost is that encoding, hashing and freezing touch the entire value. On the corpus, where a program has a few hundred entities, this is invisible. On Candela, with about 235,000 records, a pass that changed nothing took 86 seconds before the work described in IRWB-001 diary step 12, almost all of it in these four functions. Caching keyed on frozen objects (a `WeakSet` of values `immutable` produced, a `WeakMap` from such values to their text and hash, a projection cache per adapter) brought that to 18 seconds with every hash unchanged. Eighteen seconds for a pass that does nothing is still far too long, and items F1 and F2 in Part 2 exist because of it.

A **revision number** such as r0 or r6 is something different from the revision hash. It is the position of an artifact in one program's timeline: r0 is the program as lifted, and each pass application that changes the program adds one. The timeline lives in the `Program` class (section 15), not in the framework.

## 4. Adapters and projection

The compiler's passes are written against plain TypeScript tables, because that is the efficient and readable way to write a compiler. The framework's generic machinery (diffing two revisions, checking which kinds of thing a pass changed, tracing an entity through history, matching patterns) cannot know those tables. An **adapter** connects the two. It projects a native value into a graph of **entities** and **relations** that every framework operation understands.

```ts
// src/framework/ir/types.ts (abridged)
export interface IREntity   { id: string; kind: string; attributes: Record<string, unknown> }
export interface IRRelation { id: string; kind: string; category: RelationCategory;
                              from: string; to: string; order?: number }
export type RelationCategory =
  'containment' | 'dependency' | 'binding' | 'adjacency' | 'provenance' | 'control';

export interface IRAdapter<T> {
  kind: string; schemaVersion: string;
  relationKinds: Record<string, RelationCategory>;
  entities(value: T): Iterable<IREntity>;
  resolve(value: T, entity: string): IREntity | undefined;
  relations(value: T): Iterable<IRRelation>;
  describe(value: T, entity: string): EntityDescription;
  validate?(value: unknown): void;
  rebuild?(base: T, graph: IRGraph): T;       // logical graph back to native storage
  operation?(value: T, entity: string): { name: string; operands: string[] } | undefined;
  // also roots, serialize, deserialize, visualize
}
```

The adapter for the main IR is `blocksAdapter` in `src/typed/ir.ts:505`. It projects six kinds of entity and nine kinds of relation:

| category | relation kinds | meaning |
|---|---|---|
| containment | `declares`, `contains`, `emits` | a function declares its locals and contains its blocks; a block contains its statements |
| dependency | `uses`, `operand`, `reads` | a statement uses a value tree; a value has operands; a `get` reads a local |
| binding | `writes` | a `set` statement writes a local |
| control | `succ`, `jump` | a block's successors; a branch statement's targets |

The `control` category is extension E1, added for this project. Without it a generic dataflow analysis has no way to find the flow graph inside an arbitrary IR.

The projection and `rebuild` are exact inverses, and a test checks this on every corpus program: project the native value, rebuild from the graph, compare canonical encodings. That inverse property is the reason the generic operations mean anything. `diff(viewBefore, viewAfter)` (`src/framework/ir/diff.ts:91`) on two projections *is* the change a pass made, expressed as inserted, removed and updated entities and relations. A pass that says it writes only values can be held to that, by looking at the kinds in the diff.

`openIR(artifact, adapter)` (`src/framework/ir/view.ts:182`) returns an `IRView` bound to one revision, with navigation methods (`children`, `parents`, `successors`, `dependencies`, `walk`, `find`) and `beginEdit()`, which opens a transactional edit on the logical graph. The Typed passes do not use `beginEdit`; they return a new native value, which section 9 explains. The framework also has a pattern matcher (`src/framework/ir/patterns.ts`) and seven rewrite schedules including `saturate` (`src/framework/ir/rewrites.ts`). **No Typed pass uses them yet.** That is the starting point of workstream B.

## 5. The main IR: `typed.blocks`

`typed.blocks` is a control-flow graph whose statements hold expression trees. Its definition is in `src/typed/model.ts`, its validator and adapter in `src/typed/ir.ts`.

- A **function** `fn:NAME` has parameters, a result type, a list of locals and an ordered list of blocks.
- A **block** `bb:NAME.N` has an ordered list of statements and a list of successor blocks. Its last statement is a terminator.
- A **statement** `s:NAME.N` is one of eight operations: `set` (assign a local), `store` (write memory), `eval` (evaluate for effect), `br`, `br_if`, `return`, `trap`, and `zero` (clear part of a frame array).
- A **value** `v:NAME.N` is a node of an expression tree with one of 54 operators: `const`, `get` (read a local), integer arithmetic and comparisons, `load` and `load16u`, `call`, the f32 operators, and a few addressing forms. **A value has exactly one user.** Trees are not shared; the same subexpression written twice is two trees.
- A **front-end op** `op:NAME#N` records one operation of the front end's tape with its source position. Nothing executes it; it anchors provenance to a source line.

Blend, as lifted (r0), reads:

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
bb:blend.5  -> [.1]
    ...          s = s + load16u[work + (t7 << 1) + 4] * ((a * b) + scale)
    ...          i = i + 1 ; goto .1
```

Three design decisions in this IR matter for everything that follows.

**Locals are mutable variables, not single-assignment values.** `s` and `i` are assigned in several places. To know which assignment a read sees, a pass must ask the reaching-definitions analysis. This keeps the IR close to the prototype's, which was necessary to reproduce its numbers. It also means that every question of the form "where does this value come from" costs an analysis. Item A1 proposes a single-assignment view on top.

**Trees with one user.** An expression tree is evaluated where its statement stands, so its evaluation order is fixed by its shape. When the lifter meets a situation in which order could matter (a pending value reads a local that is about to be assigned, memory is about to change, a call is about to happen, control flow splits) it *materializes* the pending value into a temporary local such as `t7` above. The benefit is that rewriting a tree is a local operation. The cost is that sharing is expressed only through locals, and a common subexpression in two statements is invisible until a pass looks for it.

**Purity is a property of operators, decided conservatively.** `isPure` and `hasEffect` in `src/typed/analyses.ts:40–64` classify calls, loads, divisions and checked addresses as impure. A division may trap. A load reads memory that a store may have changed, and the compiler has no analysis that says otherwise. So today no load is ever hoisted out of a loop, shared between two uses, or substituted into its reader. Item A3 addresses that.

The native value of one revision is the interface `TypedBlocks` (`model.ts:197`): id-keyed tables `fns`, `blocks`, `stmts`, `values`, `ops`, the id counters, and `rev`. Only live entities are stored. Passes never edit this frozen value. They call `Store.from(native)` to get a mutable working copy, edit that through a transaction, and call `store.toNative()` to produce the next value. Ids come from counters stored in the artifact, so running the same pass twice on the same revision allocates the same ids and produces the same revision hash.

### 5.1 Floats and the Candela constructs

An f32 value is stored as its IEEE-754 bit pattern read as a signed 32-bit integer: `1.0` is `1065353216`, negative zero is `-2147483648`. JSON cannot represent `NaN`, infinity or the sign of zero, and those are exactly the values on which float arithmetic differs from real arithmetic, so storing floats as JavaScript numbers would lose them. A value record carries `type: 'f32'` when it is a float; absent means i32, so the integer corpus keeps its hashes.

Float operators have their own names (`fadd`, `fmul`, `flt`, `f2i`, `fsqrt`, …). Under the bit encoding an f32 addition and an i32 addition both take two integers and return one. Separate names guarantee that an integer rule such as `x + 0 → x` cannot match a float addition, for which it is false when `x` is negative zero. The exact semantics of each float operator are in `src/typed/f32.ts`, each taken from a line of the vendored reference compiler or interpreter.

Lifting Candela needed three more constructs:

- `caddr(r, p)` is a **checked address**: it traps unless `p <u load32[r]` (the capacity word of text buffer `r`), and otherwise yields `r + 2p`. It reads memory and may trap, so it is impure.
- A function that returns a record returns several values. A call to it is an `eval call f(…)` statement followed by `result#k` leaves; a return is `return tuple(…)`. Candela has functions with 26 result leaves.
- `aaddr off` is the address of a byte in the function's frame array area, and the `zero` statement clears part of it.

## 6. Lifting: from the front end to r0

The Typed front end is not part of this repository's own code. It is vendored unchanged from the ds-js-os repository at a pinned commit, and `tools/node-vendor.mjs` checks every file's SHA-256 against `vendor/ds-js-os/VENDOR.json` before loading it. Reusing it means the compiler accepts exactly the language the device accepts.

The front end parses, type-checks and emits a **tape**: a compact stack-machine encoding per function. `src/typed/lift.ts` turns a tape into blocks:

| function | role |
|---|---|
| `frontEnd(source, options)` (`lift.ts:187`) | run the front end through its inspection path, which yields operations with source spans |
| `frontEndTape(…)` (`lift.ts:230`) | the same from the tape itself; required for Candela, where the inspection path fails |
| `inferLocalTypes(f, signatures)` (`lift.ts:323`) | infer which locals are f32 by simulating the operand stack |
| `lift(store, fe, f)` (`lift.ts:410`) | simulate the stack, build value trees, materialize where order could change, split blocks at control flow |
| `ingest(program, source, options)` (`lift.ts:758`) | all functions of a program into a `Store` |

`ingest(name, source, { tape: true })` selects the tape path. The default path is unchanged from the prototype, which is what keeps the corpus's ids, and so its provenance trees, identical to the book's.

## 7. The evaluator: what a program means

Every check in the system compares behaviours, so the system needs a definition of behaviour. That definition is the evaluator in `src/typed/evaluate.ts`: an interpreter for `typed.blocks`.

```ts
export function evaluate(
  st: Store, fname: string, args: readonly number[], memBytes: Uint8Array,
  opts: { limit?: number; counts?: boolean } = {},
): RunResult                                         // evaluate.ts:345

export interface RunResult {
  trap: string | false;                 // did it trap, and why
  result?: number | readonly number[];  // an i32 (or f32 bits), or the leaves of a record
  limit: boolean;                       // stopped by the step limit: no verdict
  steps: number;
  bytes: Uint8Array;                    // guest memory afterwards
  // also engine, at, fault, unit, counts
}
```

A **case** is one call: a function name, argument values and an initial memory image. `casesFrom(st, fname, { count, seed, inputs })` (`evaluate.ts:230`) generates cases deterministically from a seed, using the prototype's own xorshift32 generator so that the corpus's cases are exactly the book's. A project's `project.json` can constrain inputs; Blend's says `work` is a buffer of 40 cells with values 0–255, `n` is in [0, 40], and `a`, `b` are in [−100, 100]. For functions with f32 parameters, the first quarter of the cases sweeps fifteen edge values (`F32_EDGES`: NaN, both infinities, both zeros, the smallest subnormal, the largest finite value and others). The reason is a measured failure, described in section 10.

`agrees(expected, got)` (`evaluate.ts:531`) is the verdict for one case: a trap agrees with any trap; otherwise results must be equal and the memory both runs wrote must be equal.

The evaluator is the **specification**. If it disagrees with the target machine about what `f2i` does to a NaN, every check built on it is wrong for that case. This is why it was itself checked against an independent implementation: the reference compiler's image of the same program, run on the vendored interpreter. On the corpus, 6,986 decided cases agree. On Candela, 33,200 cases over 332 functions agree with both of the reference compiler's policies, `stock` and `kernel`, with no disagreement.

## 8. Analyses and dataflow

An **analysis** is a versioned function from an artifact to a JSON value. `defineAnalysis` (`src/framework/contracts/definitions.ts:86`) declares one; `AnalysisManager.analyse(definition, artifact)` (`src/framework/contracts/analysis-manager.ts:100`) computes it or returns the cached record for that exact revision.

The Typed compiler has six, collected in `ANALYSES` (`src/typed/analyses.ts:539`):

| name | definition | fact | used by |
|---|---|---|---|
| `cfg` | `cfgAnalysis` | predecessors, successors, reverse postorder | everything |
| `dominators` | `dominatorsAnalysis` | immediate dominator of each block | `bce`, `licm` |
| `loops` | `loopsAnalysis` | natural loops, with the set of locals each assigns | `licm` |
| `liveness` | `livenessAnalysis` | locals live at block entry and exit | `dce`, `subst`, the backend |
| `reaching` | `reachingAnalysis` | which assignments reach each block | `constprop`, `bce`, `bcm`, `specialize` |
| `ranges` | `rangesAnalysis` | an integer interval per local | `strength`, `bce`, the backend |

The last three are **dataflow analyses**: facts attached to program points and computed by iterating to a fixpoint. Extension E4 (`src/framework/dataflow/`) provides the machinery. A lattice describes the facts:

```ts
// src/framework/dataflow/lattices.ts
export interface Lattice<V> {
  name: string;  infiniteHeight: boolean;  // true: the solver requires widen()
  bottom(): V;   join(a: V, b: V): V;   equal(a: V, b: V): boolean;
  encode(v: V): Json;  decode(j: Json): V;  // facts are stored as JSON
}
setLattice<T>()            // sets under union: liveness, reaching definitions
flatLattice<T>()           // unknown < one value < varies: constants
intervalLattice()          // [lo, hi] over i32, infinite height: needs widening
mapLattice(inner)          // a map from keys to inner facts
```

and `dataflow(spec)` (`src/framework/dataflow/analysis.ts:110`) turns a lattice, a direction and a transfer function into an ordinary analysis definition. The solver (`solve`, `src/framework/dataflow/solver.ts:90`) computes, for a forward problem,

```text
in(b)  = join over predecessors p of  edge(p, b, out(p))      (boundary at the entry)
out(b) = transfer(b, in(b))
at a loop head visited more than widenAfter times:  in(b) = widen(previous in(b), in(b))
```

until nothing changes. **Widening** is what makes the interval analysis terminate: when a bound keeps moving at a loop head, it is pushed to the extreme of the domain. The `edge` function refines a fact along a branch: on the taken edge of `i < n`, `i` is at most `n − 1`.

The range analysis taught the project a lesson worth remembering. With widening, the fixpoint a solver reaches is not unique; it depends on the order in which blocks are visited and on when widening starts. The prototype sweeps all blocks round-robin and widens after the third visit. A worklist that widens at the first revisit loses the exact interval of a small constant-bound loop. Since `strength` and `bce` act on those intervals, a different schedule produced different programs. The solver therefore has `strategy: 'round-robin'` and `widenAfter: 3` as options, and `rangesAnalysis` sets them. When you add a domain, state its schedule.

**Facts are stored per block; passes need them per statement.** The stored fact is the JSON `DataflowResult` with `in` and `out` per block. Pass code reads it through a *view* that recomputes the fact at a statement by replaying the transfer function from the block's entry: `liveView(...).liveAfter(stmt)`, `reachView(...).reachingAt(stmt, local)`, `rangeView(...).of(stmt, value)` (`analyses.ts:305`, `:360`, `:511`). Views are built on the pass's working copy, because a pass asks about values it has just rebuilt.

**Checked transfer.** A dataflow definition declares its `reads`: the entity and relation kinds its result is a function of. When a pass claims to preserve the analysis, the definition's transfer verifier diffs the two revisions and accepts the transfer only if nothing of a read kind changed. Otherwise the framework recomputes and compares (section 9). A stale fact cannot survive either route.

## 9. Passes: from a declaration to a published revision

A pass turns one revision into the next. In this system a pass is more than its code: it is a declaration the framework acts on.

### 9.1 What a pass declares

`definePass` (`src/framework/passes/define-pass.ts:97`) takes a `PassSpec`:

```ts
export interface PassSpec<S, N extends Needs, P = unknown> {
  id: string;  version: string;  description: string;
  ir: IRType<S>;  adapter: IRAdapter<S>;
  needs?: N;                                  // analyses the pass reads
  writes: { entities: string[]; relations: string[] };   // kinds it may change
  preserves?: AnalysisDefinition[];           // analyses it claims survive its edit
  contract?: TransformationDefinition;        // what its output must satisfy
  run(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<...>;
}
```

The Typed passes are written with a thinner wrapper, `typedPass` (`src/typed/passes.ts:163`), which keeps the prototype's vocabulary. Here is constant folding, abridged (the `eqz` and f32 branches are left out, and `MIN` stands for the literal −2147483648):

```ts
export const fold = typedPass({
  name: 'fold',
  about: 'constant folding: an operator whose operands are constants becomes a constant',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops', 'liveness', 'reaching'],
  body: ({ tx }) =>
    tx.rewrite(v => {
      if (!FOLDABLE.has(v.op) || !v.args.every(a => a.isConst)) return;
      const [a, b] = v.args.map(x => x.imm as number);
      if ((v.op === 'div' || v.op === 'rem') && (b === 0 || (a === MIN && b === -1)))
        return;                                         // keep the trap
      return tx.const(binop(v.op, a, b), { because: v.args });
    }),
});
```

`typedPass` does four things with this:

1. It maps the four write kinds `values`, `stmts`, `locals`, `cfg` onto projection kinds (the table `ENTITY_WRITES`, `passes.ts:77`). `values` means entities `value.*` and relations `operand`, `reads`, `uses`.
2. It maps analysis names onto the definitions in `ANALYSES`.
3. Its `run` makes a working `Store`, and **for every function of the program** builds the fact views and a transaction, and calls `body` once.
4. If any transaction made an edit, it returns `{ native, correspondence, edits, report }`.

Point 3 is a property to keep in mind: a pass always visits all functions and always returns a whole-program value, even when it edits three functions out of 332.

### 9.2 The transaction

A pass body never touches the tables directly. It goes through `Tx` (`src/typed/tx.ts:165`):

| method | effect |
|---|---|
| `tx.rewrite(visit, blocks?)` | rebuild every value tree bottom-up; `visit(handle)` returns a replacement value id or nothing |
| `tx.const(n, opts)`, `tx.make(op, ...args, opts)`, `tx.get(local, opts)` | create values |
| `tx.local(name, opts)`, `tx.set(local, value, opts)`, `tx.stmt(fields, opts)` | create a local or a statement |
| `tx.insert(position, stmt, opts)`, `tx.move(stmt, position)`, `tx.remove(stmt, opts)` | place, move or delete a statement |
| `tx.replace(old, next, opts)`, `tx.replaceStmt(old, fields, opts)`, `tx.setField(...)` | replace a value or a statement |
| `tx.block(opts)` | create a block |

Two rules make the transaction more than a convenience. Every method checks that the pass declared the write kind it is about to use, and throws a `TxError` otherwise. And every created entity gets an **origin**: `{ from, via, rev, because, note }`, saying what it was made from, by which pass at which revision, and which entities or facts make the change valid. `opts.because` supplies the last part. A removal without a `because` is refused. Section 11 shows what this buys.

The `visit` callback receives a `ValueHandle` (`tx.ts:78`): `op`, `imm`, `args` as handles, and the predicates `isConst`, `isPure`, `hasEffect`, `isBoolean`, `same(other)`.

### 9.3 `applyPass`: the gates

The framework applies a pass with `applyPass(pass, before, options)` (`define-pass.ts:190`). Nothing is returned as a new revision unless every stage succeeds:

```text
applyPass(pass, before, { manager, contract, contractInputs, auditPreservation }):
  facts  <- for each need: manager.analyse(need, before)          cached per revision
  result <- pass.run({ before, view, facts, params, edit })
  after  <- createIRArtifact(adapter, id, result.native)          validate, freeze, hash
  changes <- diff(openIR(before), openIR(after))                  on the projections
  if nothing changed:               return { changed: false, artifact: before }

  if changes touch kinds outside pass.writes:        throw PassError('undeclaredWrite')

  corr <- makeCorrespondence(before, after, result.correspondence)
  if a contract is given:
      manager.verifyTransformation({ input: before, ...contractInputs },
                                   { output: after }, contract, [corr])
      on failure:                                    throw PassError('contractRejected')

  for each analysis A in pass.preserves:
      if the manager holds no A for `before`: skip, unless auditPreservation
      try    manager.preserve(A, before, after, corr)     A's own transfer verifier
      catch  recompute A on `after`; if canonical values differ:
                                                     throw PassError('preserveViolated')
  return { changed: true, artifact: after, changes, correspondence: corr, preserved }
```

The preservation gate found a real defect on its first full corpus run. The prototype's `lvn`, `dce` and `subst` claimed to preserve the loop analysis. They do not: the loop fact records which locals a loop assigns, and these passes add or remove assignments. The prototype never checked such claims, and its pipelines happened to run `licm` first, so the stale fact was never used. Here the claim was refused:

```text
ERROR [preserveViolated] Pass typed.lvn claims to preserve typed.loops, but it changed
```

A claim is checked only when the fact exists for the input revision. `auditPreservation: true` computes every claimed fact first, and `tools/audit-preservation.mjs` runs all passes that way over every revision of every corpus pipeline: 1,376 applications, no failing claim with the corrected declarations.

### 9.4 The twelve passes and the pipelines

| pass | what it does | reads |
|---|---|---|
| `fold` | an operator on constants becomes a constant; f32 only through the evaluator's own bit functions | |
| `simplify` | about sixteen integer identities: `x+0`, `x*1`, `x*2^k → x<<k`, `x-x`, `!(a<b) → a>=b`, … | |
| `constprop` | a read whose reaching definitions all assign one constant becomes that constant | reaching |
| `dce` | removes an assignment nobody reads and an `eval` with no effect | liveness |
| `cfg` | resolves constant branches, threads jumps through empty blocks, merges straight-line blocks | |
| `licm` | moves pure loop-invariant expressions to the loop's preheader | loops |
| `lvn` | a pure expression computed twice **in one block** is computed once into a new local | |
| `strength` | `x / 2^k` and `x % 2^k` become a shift and a mask when ranges prove `x ≥ 0` | ranges |
| `bce` | removes a bounds check dominated by a branch that proved it | dominators, reaching, ranges |
| `bcm` | merges the checked addresses of a block on one buffer into one or two checks | reaching |
| `subst` | substitutes a temporary assigned a pure value and read once in the same block | liveness |
| `div-to-shift` | deliberately wrong (`x / 2^k → x >> k` with no proof); exists to show rejection | |

`PIPELINES` (`passes.ts:1037`) names seven sequences. `O2` is sixteen passes: `cfg, fold, simplify, constprop, fold, simplify, dce, cfg, licm, lvn, strength, bce, subst, subst, dce, cfg`. It is fixed, because it is what reproduces the book. `O2+` is O2 followed by one more `subst`; section 12 explains where it came from.

Notice what the list does not contain: inlining, any loop transformation other than `licm`, value numbering across blocks, anything that moves a load, anything that changes a function's signature. Section 17 collects these.

## 10. Contracts and the meaning check

A pass's output must still mean what the original program meant. The framework expresses such a requirement as a **transformation contract**, and the Typed compiler supplies one.

`defineTransformation` (`src/framework/contracts/definitions.ts:142`) declares named input and output ports and conditions over them: `requires` (checked before), `ensures` (checked on the output), `preserves`, `establishes`, and required correspondences. A condition is either a *property* of one artifact or an *invariant* over several ports. `AnalysisManager.verifyTransformation(inputs, outputs, contract, correspondences)` runs the conditions and records, for each, the evidence and its **assurance**: `declared`, `checked`, `transferred` or `proof`.

v6 knew only exact checkers. Meaning preservation for arbitrary programs is undecidable, and the prototype checked it by sampling. Extension E5 adds sampled checks as first-class invariants: `differential(spec)` in `src/framework/contracts/differential.ts:70`.

```ts
export interface DifferentialSpec<P extends Ports, Case, Outcome> {
  id: string; version: string; description: string;
  inputs: P;  baseline: keyof P;  subject: keyof P;       // which port defines the meaning
  count: number;  seed?: number;  random?: (seed: number) => () => number;
  cases(inputs, random, count): readonly Case[];
  run(side: 'baseline' | 'subject', value, kase, inputs): Outcome;
  compare(baseline: Outcome, subject: Outcome, kase): CaseComparison | boolean;
  inconclusive?(outcome: Outcome): boolean;               // e.g. hit the step limit
}
```

Its evidence (`DifferentialEvidence`) records the method `sampled`, the seed, how many cases agreed, disagreed or were inconclusive, and the first counterexamples. A check with no decided case fails, because it has established nothing.

The Typed compiler's instance is `meaningKept(params)` in `src/typed/evaluate.ts:559`, with id `typed.meaning-kept`. It evaluates the origin and the candidate on the same generated cases for every function and compares with `agrees`. `optimizationContract(params)` (`passes.ts:219`) wraps it as a contract with inputs `{ input, origin }` and output `{ output }`. Every pass application in the system, whether from a pipeline, a strategy or the browser, runs under this contract with `origin` bound to r0. The comparison is always against the *original* program, not against the previous revision, so errors cannot accumulate across passes.

```text
 r0 ──────────────────────────────────────────────┐ origin
  │ cfg     r1 ── meaning-kept(r0, r1): 40/40 ────┤
  │ fold    r2 ── meaning-kept(r0, r2): 40/40 ────┤
  │ ...                                           │
  │ div-to-shift  ── meaning-kept: 27/80 disagree ┘   REJECTED, nothing published
```

**What a sampled check establishes, and what it does not.** It establishes agreement on the cases it ran. Its strength depends on the distribution of the cases. The Candela work measured this directly. Four float rewrites that are valid over the reals and wrong for IEEE floats (`x + 0 → x`, `x · 0 → 0`, `x − x → 0`, `!(a < b) → a ≥ b`) were written as deliberately unsound passes. With purely random inputs, two of the four were *accepted* at 40 cases per function, because NaN almost never occurs at random:

```text
subSelf 40  ACCEPTED
subSelf 400 contractRejected … 1/11200 sampled cases disagree
```

After the edge-value sweep was added to case generation, all four are rejected at 40 cases. The lesson generalizes: the meaning check is the soundness gate for every experiment in Part 2, and its case distribution is part of the trusted base. Workstream D is about strengthening it.

**Assumptions.** Specialization (section 13) deliberately changes what a program means for inputs it will never receive. The contract is then restricted: `Program.assume(bindings)` fixes parameter values in the case generator, so the comparison with r0 runs only on inputs that satisfy the assumption. The assumption is stored with each revision made under it.

## 11. Provenance: answering `why`

For any entity in any revision, the system can say what it was made from and what justified the change. Two mechanisms carry this, and they agree.

**Origins in the native value.** Every statement, value, block and function carries `origin: Origin[]` (`model.ts:101`), written by the transaction. `Program.why(id)` (`src/typed/program.ts:426`) follows `from` and `because` recursively. After O2 on Blend:

```text
s:blend.15  inv = ((a * b) + 64)        live · via licm · r6 · hoisted out of loop@bb:blend.1
  made from v:blend.37  ((a * b) + 64)  live · via constprop · r4 · rebuilt around a changed arg
    made from v:blend.25  ((a * b) + scale)   detached · via ingest
      made from op:blend#35  i32.add (line 5)
  because loop:blend@bb:blend.1
```

Read from the bottom: source line 5 produced an addition; `constprop` at r4 replaced `scale` by 64 inside it; `licm` at r6 moved it out of the loop, and the reason was the loop fact. `v:blend.25` no longer exists at the head; `Program.lookup` resolves ids backwards through the stored revisions.

**Correspondence in the framework.** `typedPass` also converts origins and removal reasons into framework data: `revisionCorrespondence(before, after, edits)` (`passes.ts:114`) produces `CorrespondenceEntry` records `{ from: [ids], to: [ids], relation, because, note }`. `makeCorrespondence` completes them into a total relation between the two revisions' entities (retained, inserted, removed). `whyEntity(target, chain)` (`src/framework/ir/correspondence.ts:303`) walks a chain of correspondences backwards and returns `WhyNode` trees; `Program.whyChain(id)` calls it. `composeCorrespondence` composes two steps into one.

**Into the machine code.** Each instruction of an image lists `covers`: the value and statement it implements. `imageCorrespondence` (`src/typed/backend/image.ts:309`) turns that into a correspondence from the `typed.blocks` revision to the image, so it composes with the pass chain: r0 → rN → image. This is how the workbench can say that 322 of Blend's 451 executed instructions belong to source line 5.

Three limits are known. Correspondence groups a new entity under its *first* origin only, which is adequate while every entity has one. An entity created and removed inside one pass application appears in no revision, so `why` on it answers `absent`. And a reason attached to a rewritten *value* is one level below its statement, so a viewer must look at the value's `why`, not the statement's.

## 12. Strategies: the order of passes as checked data

A pipeline is a fixed list. A **strategy** is a plan that can branch, measure and choose. The framework's Strategy IR (`src/framework/strategy/ir.ts`) has thirteen node kinds, built with functions from `src/framework/strategy/builders.ts`:

| builder | meaning |
|---|---|
| `apply(id, algorithm, options)` | run one registered algorithm on the current value |
| `sequence(id, ...steps)` | run steps in order, each on the previous result |
| `fork(id, branches)` | run named alternatives on the same input; produce a candidate set |
| `chooseBest(id, candidates, objective, { metrics, constraints })` | measure every candidate, drop those that violate constraints, return the best |
| `attempt(id, body, fallback, { codes })` | on a rejection with one of the codes, run the fallback on the original input |
| `repeatUntilStable(id, body, { maxIterations })` | repeat until the result's revision stops changing |
| `forEach`, `parallel`, `conditional`, `require`, `verify`, `checkpoint`, `scope` | iteration, independent branches, a predicate, analyses, explicit checks, recorded evidence, isolation |

A plan contains no code. It names algorithms by id and exact version, such as `typed.constprop@1`, and an `AlgorithmRegistry` maps names to implementations. `execute(plan, registry, input)` (`src/framework/strategy/interpreter.ts:134`) validates the plan, runs it, and returns a `StrategyExecution` with a record for every node visited: its input, output, status and evidence.

Passes enter the registry through `passAlgorithm(pass, { manager, contract, contractInputs, onResult })` (`src/framework/passes/bridge.ts:29`). The algorithm calls `applyPass`. A `contractRejected` error becomes a *strategy rejection*, the one recoverable failure the interpreter knows, so a rejected pass makes its `fork` branch a rejected candidate or triggers an `attempt` fallback. A strategy therefore cannot choose a wrong program, however it is written.

`src/typed/strategies.ts` connects this to the compiler:

| function | role |
|---|---|
| `strategyRegistry(program, opts)` (`:98`) | every pass, each pass again restricted to one function as `typed.<pass>@<fn>`, `typed.keep` (identity), `typed.metrics` |
| `measure(program, artifact, opts)` (`:66`) | the metrics: `statements`, `blocks`, `bytes` (by lowering to an image), `instructions` (emulator, 10 seeded cases per function), `limited` |
| `runStrategy(program, plan, opts)` (`:264`) | execute, then publish only the winner's chain of pass results into the revision timeline |
| `planFromSpec(name, spec)` (`:383`) | compile the short form into a plan |
| `searchPlan(name, fns, candidates, objective)` (`:331`) | one `chooseBest` per function, chained |

The short form is what people write:

```json
{ "choose": { "O0": "O0", "O1": "O1", "O2": "O2", "loops": "loops" },
  "by": "instructions",
  "constraints": [["bytes", "<=", 100]] }
```

`chooseBest` records the objective, every alternative with its metrics or its rejection reason, the winner and the tie-break rule. On Blend, minimizing instructions:

| candidate | status | instructions | bytes |
|---|---|---:|---:|
| O0 | feasible | 2,255 | 96 |
| O1 | feasible | 2,235 | 88 |
| **O2** | feasible, winner | **1,925** | 88 |
| loops | feasible | 1,945 | 96 |

(These instruction counts are sums over ten cases, which is why they differ from the 451 of the single benchmark case.)

### 12.1 What the search experiment found

`tools/search-experiment.mjs` compiled each of the 44 projects as O2, as the best of four orderings per program (O2; O2 twice; `loops` then O2; O2 then nine more cleanup passes), and with the choice made per function.

- **12 of 44 projects beat O2**, and total instructions fall from 77,321 to 75,651 (2.2 %). No new pass was written.
- **11 of the 12 gains are one extra `subst` after O2.** O2 runs `subst` before its final `dce` and `cfg`; a loop copy such as `t3 = i` becomes substitutable only after them. Hence `O2+`.
- **Per-function search found nothing beyond per-program choice.** Where the per-function choices differed, the alternatives tied.
- **The experiment took 21 minutes** for 44 small programs, because each candidate is a full pipeline with a meaning check after every pass.

The first two findings say that pass ordering is a real source of loss even in a sixteen-pass pipeline. The fourth says that search is currently too expensive to use freely. Both shape Part 2.

## 13. Specialization on outer facts

Programs that generate Typed often know things the Typed code does not state. Candela knows which scene is being rendered. `src/typed/specialize.ts` brings such a fact into the compiler without trusting it blindly.

A fact arrives as an artifact of the IR `typed.bindings` (`BindingsIR`): a list of `{ fn, param, value, entity }`, where `entity` names the thing in the outer program that establishes the fact. The `specialize` pass replaces reads of the bound parameter by the constant, with `because: ['fact:typed.bindings:<id>@<revision>#<entity>']`. The ordinary passes then fold the comparisons, resolve the branches and delete the dead code. `Program.specialize(bindings)` (`program.ts:160`) first calls `assume`, so the contract compares with r0 only on inputs that satisfy the bindings.

On the `match-enum` project, binding `s = Square` in `area(s, k)` and running O2 leaves `return (k * k)`; each revision agrees with r0 on 80 of 80 assumed cases, and the same final program fails the unrestricted check, as it should. `why` on a removed branch reaches the fact reference.

The mechanism binds whole parameters only. Candela's scene index is a *field* of a record parameter (`q_k.scene`), which is why per-scene kernels (item E1) need an extension.

## 14. The backend and images

`src/typed/backend/` lowers a `typed.blocks` revision to machine code in four steps, all per function:

```text
 select    (select.ts:69)     tile each statement's value tree onto virtual registers,
                              largest tile first; emits MInsn records with `covers`
 allocate  (regalloc.ts:132)  liveness on the machine code, one interval per virtual
                              register, linear scan; a value that finds no register spills
 finish    (compile.ts:45)    rewrite onto physical registers, insert spill loads/stores
                              (scratch t5/t6), build the frame, drop jumps to the next label
 encode    (encode.ts:233)    resolve labels, encode each instruction to a 32-bit word
```

`select` is a hand-written recursive function with 72 emission sites. Its tiles include: `x + c` with a 12-bit constant as `addi`; a load with its offset folded in; a comparison fused into its branch (`blt i, n`); multiplication by a power of two as `slli`; division by a constant by multiply-high and shifts (`divisionMagic`, from Hacker's Delight). Assignments are target-directed: `s = s + x` computes straight into `s`'s register.

The allocator has three pools: caller-saved `t0–t4`, the argument registers `a0–a7` in leaf functions only, and callee-saved `s1–s11`. An interval that spans a call must take a callee-saved register or spill. A spilled interval lives in its stack slot for its whole life; there is no live-range splitting.

`BackendOptions` (`options.ts:8`) exposes nine switches, each turning one tile family or one allocator decision on or off: `registers`, `fuse`, `immediates`, `divmagic`, `useRanges`, `order`, `spill`, `hints`, `layout`. `layout` has one value, `'source'`: blocks are emitted in the order the lifter made them.

The result is an artifact of the IR `rv32.image` (`ImageIR`, `image.ts:212`): the code as base64, and one `ImageInsn` record per instruction with its word, its disassembled text, and `covers`. The public entry points:

| function | signature (abridged) |
|---|---|
| `lowerToImage` (`compile.ts:293`) | `(blocks: Artifact<TypedBlocks>, options?, facts?) => { image, correspondence }` |
| `runImage` (`run.ts:56`) | `(image, fname, args, memBytes, { limit }) => ImageRun` with `steps` and per-word counts |
| `imageAgrees` (`run.ts:284`) | `(params) => DifferentialInvariant`: the evaluator on the program against the emulator on the image |
| `heat` (`run.ts:117`) | `(store, image, counts) => Heat`: executed instructions per statement and per source line |
| `machineCode` (`compile.ts:321`) | the intermediate stages of one function, for inspection |

The emulator is the vendored `rv32-interp.js`. At every call and return it checks that the stack pointer is 16-byte aligned, that the return address matches, and that the callee-saved registers hold what they held; a violation is a *fault* and never agrees. It executes the F extension, including the fused multiply-add instructions.

Two facts bound what you can measure today. The backend on this branch handles **i32 only**; the RV32F backend (float registers, the ilp32f calling convention, multi-value returns) is being built by another agent on another branch. Until it lands, Candela's results are measurable in statements but not in instructions. And the machine code between `select` and `encode` is an internal array, not an artifact, so no framework pass, contract or strategy can act on it. Item A5 changes that.

## 15. The program host and the workbench

`Program` (`src/typed/program.ts:80`) is the object that holds one program's history. It owns an `AnalysisManager` and an array of `Revision` records `{ rev, pass, artifact, edits, correspondence, ms, assumptions }`. Its main methods:

| method | role |
|---|---|
| `apply(pass, opts)` | one pass under the contract; pushes a revision if the program changed |
| `pipeline(name)` | a named pipeline, pass by pass |
| `dryRun(pass)`, `actions()` | what would change, without publishing |
| `undo()`, `checkout(rev)` | move the head back |
| `why(id)`, `whyChain(id)`, `lineage(id)`, `lines(id)`, `history(id)` | provenance |
| `fact(name, fn)` | an analysis result for the head |
| `cases(fn)`, `exec(...)`, `check(...)`, `verify()` | generated cases, one run, a check against r0 |
| `assume(...)`, `specialize(bindings)` | restricted contracts |

The revision timeline is an in-memory array. It is not stored on disk, and it is not connected to the framework's task runtime (`Compiler`, `src/framework/core/runtime.ts`), which has dependency tracking, a result cache and cache explanations but is used only by v6's own examples.

On top of `Program`, `src/workbench/` provides `wb`: the API that the browser UI, project scripts, the console and the agent panel call (`createWb`, `workbench.ts`). One design point deserves a paragraph because it surprises everyone once. The corpus has 46 project scripts written for the prototype's *synchronous* API:

```js
const before = p.image().bytes;
p.pipeline('O2');
return { bytes: [before, p.image().bytes] };
```

The kernel's passes are asynchronous. `src/workbench/sync.ts` reconciles the two with a **replay context**. Script code runs in attempts. An asynchronous call either replays its recorded outcome or, the first time, throws a `Suspend`; the runner performs the call on a scratch copy, records the outcome under a key built from the operation, its arguments and the revision hashes, restores what the attempt touched, and runs the script again from the top. A script with k new asynchronous calls runs k + 1 times. Scripts must therefore be deterministic. 45 of the 46 corpus scripts run unchanged.

The UI is `site-src/`: a grid of tiles, each a view from `site-src/views.js` (Projects, Files, Editor, Scripts, Source, IR, CFG, Lineage, Facts, Pipeline, Timeline, Checks, Run, Console, Code, Book, Reference), plus the Compiler and Strategies views in `site-src/compiler.js`. A tile is 60 to 80 columns wide, and everything the workbench prints is formatted to `TILE_WIDTH = 72` (`src/typed/format.ts`). `src/workbench/DIVERGENCES.md` lists where the API differs from the prototype's.

## 16. The corpus, Candela and the oracles

**The corpus** (`corpus/projects/`) is 44 projects with 70 functions. Each has `main.typed`, a `project.json` (title, pipeline, input specifications, focus line), `notes.md`, and scripts. The book in `corpus/book/` states exact numbers for them, and those numbers are tests: Blend's 7 blocks and 13 statements at r0, 96 bytes and 531 instructions, O2's six revisions, the `why` tree node for node, 88 bytes and 451 instructions after O2; and across the corpus, 6,986 decided cases that agree and 14 at the step limit. `tools/parity.mjs` reproduces the totals. A change that alters any of them is either a bug or a deliberate divergence that must be recorded.

**Candela** (`corpus/candela-gallery/`) is the gallery's path tracer: 332 functions, 2,409 blocks, 12,358 statements and 37,220 values at r0, about a third of its operations f32. `tools/candela.mjs` loads and lifts it; `tools/candela-oracle.mjs` runs the evaluator against the reference image; `tools/candela-o2.mjs` runs O2 pass by pass. The measured state:

| measure | value |
|---|---|
| functions lifted | 332 of 332 |
| evaluator vs reference images (`stock` and `kernel` policies) | 33,200 cases, 0 disagreements |
| O2 | 13 checked revisions, none rejected, statements 12,358 → 9,479 (−23 %) |
| `strength`, `bce` on Candela | no change (no such division; checks are `caddr`, not branches) |
| `bcm` | checked addresses 559 → 100 |
| a no-change pass | 86 s before the caching work, 18 s after |
| structure | 177 of 332 functions are per-scene sections `s<k>_…`, reached through five dispatchers that read `K.scene` |

**The oracles.** Three independent things can say what a program should do: the evaluator, the reference compiler's image on the interpreter, and (through the front end) a Wasm module. The first two are wired up. The front end's Wasm output is not yet used as an oracle.

**Against the reference compiler** (`tools/reference-check.mjs`), emulator instructions on the book's benchmarks:

| benchmark | r0 | ours, O2 | reference |
|---|---:|---:|---:|
| Blend | 531 | 451 | 383 |
| Checksum | 446 | 366 | 292 |
| insertion sort | 2,022 | 2,022 | 1,533 |
| Collatz | 1,590 | 1,590 | 1,486 |
| value numbering | 690 | 570 | 695 |

Our images are smaller (5,160 bytes over the corpus against 7,628) and mostly slower. The reference compiler inlines calls, rotates loops and unrolls kernels; ours does none of the three.

## 17. What the system does not do

This section is the bridge to Part 2. Each row is a gap that the code or a measurement shows, and the agenda item that addresses it.

| gap | evidence | items |
|---|---|---|
| Every question about where a value comes from costs a reaching-definitions query; no sparse representation | locals are mutable (`model.ts`); `constprop`, `bce`, `bcm`, `specialize` all need `reaching` | A1, A2 |
| No load is ever shared, hoisted or substituted | `IMPURE` in `analyses.ts:64` contains `load`, `load16u`, `caddr` | A3 |
| Value numbering is per block | `lvn` body iterates `for (const b of f.blocks)` with a fresh table | A2 |
| Machine code is not an artifact | `MInsn[]` is internal to `compileFunction` | A5 |
| Only `typed.blocks` and `rv32.image` are IRs; Candela, WGSL and the tape are not | open task P4.2 | A6 |
| Rewrite rules are code, not data; the framework's rule engine is unused | `simplify` is a `switch`; no caller of `rewrite()` in `src/typed` | B1–B4 |
| Pass ordering loses performance | 12 of 44 projects beat O2 | B4, F5 |
| One abstract domain (intervals over i32 locals) | `ANALYSES` has six entries | C1, C2 |
| No analysis crosses a call | every analysis has per-function regions | C3 |
| Facts are trusted, not tested | no check compares a fact with an execution | C5 |
| The origin is re-evaluated for every pass | `runDifferential` runs both sides per case | D1 |
| Sampled checks miss rare inputs | two unsound float rewrites accepted at 40 random cases | D2, D3 |
| No exact or certified assurance exists | `assuranceOf` returns `checked-exact` for no Typed check | D3, D4 |
| No inlining, cloning or record scalarization | pass list; the reference compiler's lead on sort and Collatz | E2, E3, E5 |
| Specialization binds whole parameters only | `Binding` has `fn`, `param`, `value` | E1, E4 |
| A pass costs time proportional to the program, not to its change | `typedPass.run` loops over all functions; 18 s for no change on Candela | F1 |
| Nothing survives the process | `Program.revisions` is an array; `IRStore` is in memory | F2, F3 |
| Search is slow and sequential | 21 minutes for 44 projects; the interpreter's concurrency is asynchronous scheduling on one thread | F4, F5 |
| Loops exit in the middle; copies survive in checked loops | the book's two named gaps; Blend 451 vs 383 | G1, H2 |
| One block layout, whole-interval spilling, hand-written tiles | `layout: 'source'`; `allocate`; `select` | H1–H4 |

# Part 2: The research agenda

## 18. How to read the agenda

The agenda has 54 items in ten workstreams. It covers compiler research broadly: representations, rewriting, analysis, verification, specialization, compiler infrastructure, loops, code generation, tooling and language design. Candela and the corpus are the workloads on which items are measured; they are not what the agenda is about. A workstream is an area one researcher can own; items inside it are ordered roughly by dependency. Every item follows the same template:

- **The idea**, in a paragraph, with pseudocode.
- **Why here**: the file, measurement or named gap in *this* project that the technique acts on. An idea with no such anchor is not in the catalogue.
- **Needs**: what exists and can be used as it is, and what would have to be added. New interfaces are marked **Proposed**; their names are suggestions.
- **First experiment**: the smallest piece of work that produces a number.
- **Acceptance**: the measurement that says the item worked.
- **Size** and **dependencies**. S is up to a week, M two to four weeks, L one to three months, XL longer, for one person who has read Part 1.

Four rules apply to every item.

1. **The meaning contract is the gate.** A new pass, rule, representation or search procedure produces candidate programs. A candidate becomes a revision only through `applyPass` under `optimizationContract`. This is what lets the agenda include speculative techniques: an unsound idea costs compile time, not correctness. The rule has a corollary, which workstream D takes up: the gate is only as strong as its cases.
2. **Parity is frozen.** `O2`, the corpus and the book's numbers do not change. New behaviour arrives as a new pass, a new pipeline, a new backend option or a new project, so `tools/parity.mjs` keeps passing.
3. **Every item lands with a corpus project and a test.** The project shows the technique on the smallest program that exhibits it, with notes at tile width. The test pins the acceptance number.
4. **Compile time is a result.** Both surveys behind this agenda stress that a more general representation can make ordinary operations more expensive; V8's move away from its Sea-of-Nodes IR is their main example, and this project's own Candela profile is a second. Each representation or framework item reports its cost on Candela next to its benefit.

The primary IR stays what it is: a control-flow graph with expression trees. Several items add *views* of it (single-assignment form, memory versions, a loop tree, equivalence classes). A view is an analysis result or a derived artifact, computed from a revision and discarded with it. Passes keep editing `typed.blocks` through `Tx`. This keeps parity, keeps `why` working, and keeps each new representation optional.

```text
 Workstreams and what feeds what

   F framework ───────────► everything (cost of a pass, of a check, of a search)
   D checking  ───────────► everything (the gate)
   A representation ──► B rewriting ──► H backend
        │                   │
        ├──► C analyses ────┤
        │        │          │
        └──► G loops        └──► E specialization (Candela)
   I research tooling: measures all of the above
   J languages and IR design: what the source and the compiler's own languages could be
```

## Workstream A: representations

### A1. A single-assignment view of `typed.blocks`

**Size** M · **Depends on** nothing

Static single assignment (SSA) form gives every assignment its own name, so that each read refers to exactly one definition. Where control flow joins and two definitions could arrive, the join block receives the value as a *block parameter*, and each predecessor passes its own definition as the argument. The question "which assignment does this read see?" then has a direct answer instead of an analysis result.

The proposal is to compute SSA as a *fact about* a revision, not to replace the IR. The fact maps every `get` to its definition and lists each block's parameters. Braun and colleagues' construction builds it in one pass over the blocks without computing dominance frontiers:

```text
readVar(local, block):
  if block defines local:            return its last definition in block
  if block has exactly one pred:     return readVar(local, pred)
  p <- new BlockParam(block, local)                 # record first: breaks cycles in loops
  for each pred q:  p.args[q] <- readVarAtEnd(local, q)
  return removeIfTrivial(p)          # all args equal (or p itself): use that arg instead
```

**Why here.** Locals are mutable (`src/typed/model.ts`), and four passes (`constprop`, `bce`, `bcm`, `specialize`) need the reaching-definitions fact. `reachView(...).reachingAt(stmt, local)` replays a block's transfer function for every query. `bcm` contains its own notion of "a local named by its single reaching definition earlier in the same block" (IRWB-001 diary step 14), which is SSA naming rebuilt by hand for one pass. Definition-use chains also give the inverse direction, `usersOf(definition)`, which no current fact provides and which every sparse algorithm (A2, G2) needs.

**Needs.** Exists: `defineAnalysis`, the `cfg` and `liveness` facts (liveness prunes parameters for dead locals). **Proposed:** `ssaAnalysis` in `src/typed/analyses.ts` with result `{ defOf: Record<valueId, defId>, params: Record<blockId, {local, args}[]> }`, and `ssaView(result, st, fname)` offering `defOf(get)`, `usersOf(def)`, `paramsOf(block)`.

**First experiment.** Implement the analysis and rewrite `constprop` to use it: a `get` whose definition is a `set` of a constant, or a block parameter whose arguments are all the same constant, becomes that constant.

**Acceptance.** The rewritten `constprop` produces the same revision hashes as today's on all 44 projects and on Candela r3 → r4 (925 replacements in 124 functions). Report the time to compute `ssa` against `reaching` on Candela.

### A2. Sparse constant propagation and global value numbering

**Size** L · **Depends on** A1

Two classic algorithms become short once definitions and uses are linked.

*Sparse conditional constant propagation* tracks a constant-or-not fact per definition and an executable-or-not flag per control-flow edge, and propagates both together. A branch on a constant makes one edge dead, which can make a block parameter constant, which can make another branch constant. It reaches in one run the fixpoint that alternating `constprop`, `fold` and `cfg` approaches round by round.

*Global value numbering* gives two computations the same number when they apply the same operator to operands with the same numbers. Walking the dominator tree with a scoped table finds a repeated expression anywhere a previous occurrence dominates it:

```text
gvn(block, table):
  for each statement s in block, each pure tree t in s (children first):
      key <- (t.op, t.imm, t.type, numbers of t.args)        # a get: number of its definition
      if table has key -> definition d:   replace t by a read of d's local
      else:                               table[key] <- t   (materialize into a local on reuse)
  for each child c of block in the dominator tree:  gvn(c, table.pushScope())
```

**Why here.** The `constants` project runs 42.9 % fewer instructions when O2 is simply applied twice (IRWB-001 report 2, section 5): its constants cascade through more rounds than O2 contains. And `lvn` (`src/typed/passes.ts:586`) starts a fresh table for every block. On Candela it still made 256 edits in 38 functions, which suggests how much repetition exists beyond block boundaries.

**Needs.** Exists: `flatLattice`, `dominatorsAnalysis`, `Tx`. **Proposed:** passes `sccp` and `gvn`; a pipeline `O3` that uses them in place of the repeated `fold, simplify, constprop` group and `lvn`.

**First experiment.** `sccp` alone on `constants`.

**Acceptance.** `constants` reaches 40 instructions (the O2×2 result) in one pipeline run. `gvn` removes at least the 256 sites `lvn` does on Candela; report the surplus. No corpus project gets slower than under `O2+`.

### A3. Memory dependence, so that loads can move

**Size** L · **Depends on** nothing (A1 helps)

A load is pure *relative to a state of memory*. If nothing that could write the loaded location executes between two loads of the same address, the two loads yield the same value and the second is redundant; if no such write occurs inside a loop, the load can leave the loop. The analysis that supports this assigns every load a **memory version** for its *alias class* and bumps the version of a class at every statement that may write it:

```text
classes: one per (base parameter or frame array, kind of field), plus "unknown"
version[c] at block entry <- join over predecessors (a new version where they differ)
for each statement in order:
    store to class c   ->  version[c]++       (a store to "unknown": every class)
    call               ->  version[c]++ for every c the callee may write   (all, without C3)
    load from class c  ->  tag the load with version[c]
two loads are interchangeable iff same address tree numbers and same tagged version
```

**Why here.** `IMPURE` in `src/typed/analyses.ts:64` contains `load`, `load16u` and `caddr`, so `licm`, `lvn` and `subst` skip every expression that reads memory. In Blend's loop the capacity `load32[work+0]` is read on every iteration although nothing in the loop stores anything. Candela has 289 f32 loads, 63 i32 loads and 559 checked addresses. `bcm` already contains one special case of this reasoning: its `safeStore` test argues that a store at a checked constant position cannot overwrite a capacity word.

**Needs.** Typed's memory model is narrow: text buffers with a capacity word at offset 0, records, frame arrays. That makes a useful class partition cheap. **Proposed:** `memoryAnalysis` (a forward dataflow problem over a map lattice of version counters), and a predicate `pureAt(value, memoryView)` that the three passes use when they declare the need.

**First experiment.** Hoist the capacity load in Blend and Checksum under a new pipeline.

**Acceptance.** Blend's instruction count on the benchmark case drops by about one per iteration (40 of 451). Report loads hoisted and shared on Candela. A deliberately wrong variant that ignores stores must be rejected by the meaning contract on the `strings` or `histogram` project; if it is not, that is a finding for D2.

### A4. A loop tree with trip counts

**Size** S–M · **Depends on** nothing

Loop transformations work on a nesting structure: each loop with its header, its latch (the block that jumps back), its exits, a preheader, its children, and where derivable, the number of iterations as an expression. The `loops` fact has the first parts. The proposal adds the forest and the trip count, as one analysis:

```text
for each back edge (latch -> header), header dominates latch:
    body <- blocks that reach latch without passing through header
nest loops by body inclusion; preheader <- unique outside predecessor of header, if any
trip count: header tests  i < n  with  i = i + c  the only assignment of i in the body,
            n not assigned in the body   ->   max(0, ceil((n - i0) / c))
```

**Why here.** `licm` rebuilds what it needs from `loops`; items G1 to G3 each need the same structure, and A2's and C1's precision at loop heads depends on knowing which locals are induction variables. The surveys describe richer region-based IRs (RVSDG); this is the part of that idea the project has a use for, taken as a view.

**Needs.** Exists: `loopsAnalysis`, `dominatorsAnalysis`. **Proposed:** `loopTreeAnalysis`.

**First experiment and acceptance.** The forest agrees with `loops` on every corpus function. Report for how many loops of the corpus and of Candela (whose tapes contain 19 `loop` operations) a trip-count expression is found.

### A5. Machine code as an artifact

**Size** L · **Depends on** nothing

Between `select` and `encode`, the program exists as arrays of `MInsn` records with virtual registers. The proposal registers that form as an IR, `rv32.mir`, with an adapter (entities: function, block, instruction, virtual register; relations: `contains`, `defines`, `uses`, `jump`) and an interpreter that executes it with an unbounded register file. The backend then becomes three checked steps instead of one function:

```text
 typed.blocks ──select──► rv32.mir (virtual) ──allocate+finish──► rv32.mir (physical)
                                                        ──encode──► rv32.image
 each arrow: a lowering with a correspondence and a differential contract
             (evaluator vs mir interpreter; mir interpreter vs emulator)
```

**Why here.** Every backend experiment in workstream H and the window superoptimizer B5 need to run *as passes*: declared writes, the gate, `why`. Today the backend offers nine boolean or enumerated options and no place to put a pass. A disagreement between evaluator and emulator currently says only that the whole backend is wrong somewhere; two contracts would say which half.

**Needs.** Exists: `MInsn` (`encode.ts:150`), `machineBlocks`, `intervals`, `machineCode` (which already exposes the stages for display), `differential`. **Proposed:** `MirIR`, `mirAdapter`, `runMir`, and `definePass` instances for allocation and encoding.

**First experiment.** The adapter and the interpreter; `imageAgrees`-style checks at both boundaries on the corpus.

**Acceptance.** Images produced through the artifact path are byte-identical to today's on all 44 projects (5,160 bytes in total). The MIR interpreter agrees with the emulator on every corpus case.

### A6. The whole chain as registered IRs, with operator traits and legality

**Size** L (operator table M) · **Depends on** A5 for the lower half

Two related ideas from the MLIR line of work apply here.

*Operator traits.* What the compiler knows about an operator is spread over closed sets in several files: `VALUE_SIGNATURES` (`ir.ts:47`), `IMPURE` (`analyses.ts:64`), `FOLDABLE` (`passes.ts`), `F32_RESULT`, `F32_OPERANDS`, `F32_FOLDABLE` (`f32.ts`), the evaluator's `binop`, and the tiles in `select.ts`. One table would hold each operator's signature and traits, and generic code would ask for a trait instead of naming operators:

```ts
// Proposed
defineOp('fadd', { args: ['f32', 'f32'], result: 'f32',
                   traits: ['pure', 'commutative', 'foldable'], eval: F32_BINARY.fadd });
defineOp('caddr', { args: ['i32', 'i32'], result: 'i32',
                    traits: ['reads-memory', 'may-trap'] });
```

*Legality.* A lowering is specified by what may remain afterwards. "After `lower-caddr`, no `caddr` value exists" is a checkable property of a revision, a `defineProperty` over `BlocksIR`. A stage of the compiler is then the set of operators legal in it, and a pass that needs a stage states it in `requires`.

With those in place, the stages above `typed.blocks` can be registered too: the Candela scene description, the generated WGSL, the Typed source, the tape. Each needs an adapter, which can start coarse (entities for scenes, kernel functions, sections), and each generator step becomes a lowering with a correspondence. `why` on an image instruction can then end at a Candela scene entity instead of at a Typed source line.

**Why here.** IRWB-001 task P4.2 ("Candela chain: tasks for front end, generator, Typed front end; correspondence") is open, and design-doc 03 is built on it. The float work had to touch each of the closed sets by hand, and the two accepted unsound rewrites of section 10 were both cases of an integer rule that must not match a float operator.

**Needs.** Exists: `defineIR`, `defineAdapter`, `defineProperty`, `composeCorrespondence`. **Proposed:** `defineOp` and a registry; legality properties; adapters for the upper IRs.

**First experiment.** The operator table for the 54 value operators, with `isPure`, `hasEffect`, the validator's type check and `fold` reading it.

**Acceptance.** Identical revision hashes on the corpus and on Candela's O2 run with the table in use. Then: one `why` chain from an instruction of a Candela image to a scene entity.

## Workstream B: rewriting, equality and synthesis

### B1. Rewrite rules as data

**Size** M · **Depends on** nothing

A rewrite rule has a left-hand pattern, a right-hand template, a guard and a name. Written as data, it can be listed, counted, tested on its own, shown in the workbench, cited in a `because`, and handed to engines other than the one it was written for.

```ts
// Proposed
rule('mul-pow2', mul(x, k), { where: ({ k }) => isPow2(k.imm) },
     ({ x, k }) => shl(x, constant(log2(k.imm))));
rule('sub-self', sub(x, x), { where: ({ x }) => x.isPure }, () => constant(0));
```

**Why here.** `simplify` is a `switch` with sixteen `return` sites inside one `tx.rewrite` callback (`passes.ts:305`). `fold`, `strength` and `div-to-shift` have the same shape. The framework already has a rule engine: `rewrite(definition)` builds a versioned rule, and seven schedules apply rules (`applyOnce`, `applyAll`, `topDown`, `bottomUp`, `innermost`, `outermost`, `saturate`, in `src/framework/ir/rewrites.ts`), with patterns from `src/framework/ir/patterns.ts` (`op('add', capture('x'), …)`). No Typed pass calls it. Items B2, B3, B4, D3 and H1 all need rules as data.

**Needs.** A compact rule form for value trees, compiled two ways: into a `Tx.rewrite` visitor (fast, keeps today's ids, so parity holds) and into a framework `RewriteRule` (generic). The framework path's cost on Candela's projection must be measured before anything depends on it.

**First experiment.** `simplify` regenerated from a rule table.

**Acceptance.** Identical revision hashes on all 44 projects and on Candela. A report of how often each rule fires over the corpus and Candela, including the rules that never fire.

### B2. Verifying a rule once, instead of every program it touches

**Size** M · **Depends on** B1

A rule over integer operators is a claim about all values of its variables. It can be checked independently of any program:

```text
verify(rule):
  exhaustive at width 8:   all 2^8 (one variable) or 2^16 (two) assignments, operators at width 8
  boundary and random at width 32:  {0, 1, -1, MIN, MAX, 2^k, 2^k - 1} crossed, plus N random
  one-variable rules:      all 2^32 values (about a minute in JavaScript)
  guard:                   only assignments satisfying the guard count
  result: { method, cases, counterexample? }     -> assurance checked-exact or checked-sampled
```

Exhaustive checking at width 8 is not a proof at width 32, because some rules depend on the width; it is a fast filter with a precise meaning, and the evidence must say which method was used. An exact answer for two-variable rules needs a decision procedure for bit-vector formulas (encode both sides as circuits, ask a satisfiability solver whether they can differ). A small solver in TypeScript is a contained project, and it is the same machinery D3 needs.

**Why here.** The rule `x / 2^k → x >> k` without the guard is the corpus's showcase of a wrong pass; a rule verifier refutes it with `x = −1` without compiling anything. The four unsound float rules of section 10 are refuted by the fifteen values of `F32_EDGES`. Today each of these is caught only when a program that happens to contain the pattern is checked on cases that happen to hit the counterexample.

**Needs.** Exists: `binop` and `f32Op` as the operator semantics; `assuranceOf`. **Proposed:** a width-parametric `binopW`, `verifyRule`, and evidence attached to the rule's version.

**Acceptance.** Every rule of `simplify`, `fold` and `strength` verified, with its method recorded. `div-to-shift` and the four float rules refuted, each with a counterexample.

### B3. Discovering rules by enumeration

**Size** L · **Depends on** B1, B2

Rules need not be written by hand. Enumerate every small term over the operators, group terms that behave alike on a fixed set of inputs, and propose each group's cheapest member as the right-hand side for the others:

```text
terms <- all trees of size <= n over {add, sub, mul, and, or, xor, shl, shr, lt, ...},
         variables {a, b}, constants {0, 1, -1, 2, MIN}
for t in terms:  fingerprint[t] <- t evaluated on 64 fixed input pairs (boundary + random)
for each group of equal fingerprint:
    r <- cheapest member by backend cost
    for t in group, t != r:  candidate rule  t -> r
keep candidates that verifyRule accepts; drop those derivable from kept rules
```

**Why here.** This is idea 11 of design-doc 04. The hand-written set has visible holes: nothing for `x & x`, `x ^ x`, `x | 0`-style identities on the left operand, comparisons of a value with itself, or reassociation of constants such as `(x + c1) + c2`, which Candela's generated address arithmetic (`(row·6 + k)·4·2 + 1`) produces in quantity.

**Needs.** B1's rule form as output, B2 as the filter, a cost per operator (the tile costs of `select.ts`, or H1's table).

**First experiment.** Size 3, integer operators only.

**Acceptance.** The number of verified rules not implied by `simplify`; how often they fire on the corpus and Candela; the change in corpus instructions (77,321 under O2) and bytes (5,160). Zero rejections by the meaning contract across all applications; a rejection would mean B2 has a hole.

### B4. Equality saturation for value trees

**Size** XL · **Depends on** B1, B2

A rewriting pass replaces a term by another and forgets the original. If a later rule needed the original shape, the opportunity is gone. That is the phase-ordering problem at the scale of one expression. An **e-graph** avoids the choice. It stores many terms at once, grouped into classes of terms known to be equal; applying a rule *adds* the right-hand side to the class of the left-hand side. When no rule adds anything new, or a budget runs out, one representative per class is extracted by cost.

```text
saturate(trees, rules, limit):
  g <- EGraph();  roots <- trees.map(g.add)          # hash-consed: equal subterms share a node
  repeat:
      matches <- for r in rules: every (class, substitution) where r.lhs matches in g
      for (r, s, c) in matches where r.guard(g.facts, s):
          g.union(c, g.add(r.rhs under s), reason: r.name)
      g.rebuild()                                    # equal children => equal parents
  until nothing changed or g.size > limit
  return roots.map(c => extract(g, c, cost))         # cheapest tree in each root class
```

Each class can also carry a fact (a constant, an interval), merged when classes merge, so guards such as "x ≥ 0" are answered inside the graph.

The scope proposed here is deliberately restricted, following the design Cranelift uses in production: the control-flow graph and every impure statement stay fixed as a skeleton, and only *pure value trees* enter the graph. Three properties of this project make the fit good. Values have exactly one user, so the cost of an extracted *tree* is its true cost; the known weakness of tree extraction, mispricing shared subterms, does not arise. Float operators are separate names, so integer rules cannot leak onto them. And an unsound rule cannot corrupt the output silently, because the extracted program is an ordinary pass result and goes through the gate.

**Why here.** O2 contains `fold, simplify, constprop, fold, simplify` and later `strength`: a hand-scheduled approximation of saturation. Twelve of 44 projects were improved by reordering alone. `simplify` turns `x * 2^k` into a shift eagerly, which hides the multiplication from any rule that wanted it.

**Needs.** **Proposed:** `src/framework/egraph/` (union-find, hash-consing, rebuild, pattern matching over classes, extraction), independent of Typed; a `typedPass` `eqsat` that builds the graph per statement or per block, runs the B1 rules in both directions where they are marked reversible, and extracts. For `why`: each union records its rule, and the `because` of an extracted value lists the rules on the path from the original term.

**First experiment.** Per-statement saturation with the `simplify` and `fold` rules; compare with the two passes on the corpus.

**Acceptance.** A pipeline in which one `eqsat` replaces `fold, simplify, fold, simplify, strength` matches or beats `O2+` in instructions on every corpus project. Report graph sizes, the share of statements that hit the node limit, and the pass's time on Candela.

### B5. A window superoptimizer for machine code

**Size** L · **Depends on** A5

For a short straight-line sequence of machine instructions, the best equivalent sequence can be found by search rather than by rules:

```text
for each window W of k <= 4 instructions with no branch and no label inside:
    live_out <- registers read after W;   tests <- 32 register states (boundary + random)
    for length n = 1 .. k-1, for each sequence S of n instructions over W's registers:
        if S agrees with W on tests for live_out:
            if S agrees with W on 10^6 random states (or exhaustively when feasible):
                record peephole  W -> S;  stop at the first (shortest) hit
```

The peepholes found are rules over `rv32.mir`, verified once (B2's method, with the emulator's instruction semantics) and applied by an ordinary pass.

**Why here.** The only machine-level cleanup today is in `finish` (`compile.ts:45`): jumps to the following label are dropped and a frameless return becomes `ret`. Tiling is greedy and the allocator inserts moves it cannot coalesce, so short redundant sequences are likely; how many is exactly what the experiment measures.

**First experiment.** Collect all windows of length 2 and 3 from the corpus images, deduplicate them up to register renaming, and count how many have a shorter equivalent.

**Acceptance.** The number of distinct peepholes found; bytes and instructions saved over the corpus; every application passes the image contract.

### B6. Float rewrites that change the last bit

**Size** L · **Depends on** D6, the RV32F backend

Some float optimizations are not exact. Fusing `a * b + c` into one multiply-add instruction rounds once instead of twice. Replacing `x / c` by `x * (1/c)` rounds differently. Reassociating a sum changes which errors cancel. A bit-exact contract must reject all of them, and it does. Under a **tolerance contract** (D6) they become checked trades: accepted when the observed error stays under a stated bound, with the bound and the largest observed error recorded.

```text
fuse:  fadd(fmul(a, b), c)  ->  fmadd(a, b, c)        # one rounding
recip: fdiv(x, const c)     ->  fmul(x, const 1/c)    # exact only when c is a power of two
strategy:  chooseBest( fork(exact, fused, fused+recip),
                       minimize instructions, constraint maxUlp <= 1 )
```

**Why here.** Candela has 2,050 `fmul`, 994 `fadd`, 752 `fsub`, 480 `fdiv` and 278 `fsqrt` operations (IRWB-001 analysis 03). The vendored interpreter executes `fmadd` with single rounding, so the check is against real target semantics. This is ideas 5 and 6 of design-doc 04.

**Needs.** A `fmadd` operator in `ValueOp` with evaluator semantics that match the interpreter's bit for bit (fused multiply-add cannot be computed correctly by multiplying and adding in double precision in every case, so take the interpreter's implementation as the reference); a tile; D6.

**First experiment.** A corpus project with a dot product and a linear interpolation.

**Acceptance.** The bit-exact contract rejects the fused program and the test asserts that. The 1-ulp contract accepts it and records the largest error. On Candela: sites fused, instructions per pixel, the error distribution over the 33,200 oracle cases, and the difference of one rendered tile from the exact render.

## Workstream C: analyses

### C1. A library of abstract domains

**Size** M · **Depends on** nothing

An abstract domain is a lattice of facts together with a sound transfer function per operator: whatever values the operands may really have, the result's fact covers the real result. The compiler has one numeric domain, intervals over i32 locals. Three more are cheap and combine with it:

| domain | fact | proves |
|---|---|---|
| known bits | two masks: bits known 0, bits known 1 | `x & 255` is in [0, 255]; `x << 2` is a multiple of 4 |
| congruence | `x ≡ r (mod m)` | alignment of addresses; strides |
| sign and zero | negative, zero, positive, or unions | `x ≥ 0` where the interval was widened away |

Domains combine in a **reduced product**: the pair of facts, with each component tightened using the other.

```text
product(A, B):  join = componentwise;  reduce((a, b)) =
    a' <- A.refineFrom(b);  b' <- B.refineFrom(a');  repeat until stable
    e.g. interval [0, 300] with known-bits "bits 8.. are 0"  ->  [0, 255]
```

Two improvements to the solve itself belong here. *Widening with thresholds*: instead of jumping to the extreme of the domain, a moving bound jumps to the next constant that appears in the function. *Narrowing*: after the widened fixpoint, a few descending iterations recover precision that widening gave up.

**Why here.** `strength` fires only when `ranges` proves `x ≥ 0`, `bce` only when it proves the index non-negative, and the backend's `useRanges` option drops division checks on the same fact. `evalRange` (`analyses.ts:382`) models `add`, `sub`, `mul`, `shl`, `shr`, `div`, `rem`, `and`, `load16u` and the comparisons, and nothing for `or`, `xor`, `shru`. The solver already supports `edge` and `widenAfter`; it has no narrowing phase.

**Needs.** Exists: `Lattice`, `mapLattice`, `dataflow`, `solve`. **Proposed:** `knownBitsLattice`, `congruenceLattice`, `productLattice(a, b, reduce)` in `src/framework/dataflow/lattices.ts`; `narrow` and `thresholds` options on `SolveOptions`. Any change to `rangesAnalysis` itself would change corpus facts, so the new analysis is a new definition (`typed.ranges2`) used by new pipelines.

**First experiment.** Known bits in product with intervals, thresholds from the function's constants.

**Acceptance.** Additional firings of `strength`, `bce` and dropped division checks on the corpus; the share of locals with a non-trivial interval at loop heads, before and after; solver iterations. Every new domain passes C5.

### C2. Symbolic bounds

**Size** L · **Depends on** C1

Intervals relate a local to constants. Bounds checks relate a local to *another quantity*: an index to a length. A domain of symbolic upper bounds tracks facts of the form `x < y + c` and `x <u cap(buf)`, where `y` is a local and `cap(buf)` stands for the capacity word of a buffer:

```text
fact: for each local x, a set of bounds { (y, c) : x < y + c }  and  { buf : x <u cap(buf) }
set x = y + k:        bounds(x) <- { (z, c + k) : (z, c) in bounds(y) } ∪ { (y, k + 1) }
set x = other:        bounds(x) <- {};  remove x from other locals' bounds
edge of  a < b  taken:  bounds(a) ∪= { (b, 0) }
after  caddr(buf, p)  succeeds:  p <u cap(buf)   and, for constant p,  cap(buf) > p
join: intersection
```

**Why here.** `bce` (`passes.ts:676`) needs a dominating branch of one syntactic shape plus a reaching-definitions argument. It cannot follow the copy `t7 = i`, which is why Blend's check has two readers and survives. `bcm` took Candela's checked addresses from 559 to 100 by a block-local argument about linear positions; the remaining 100 need facts that cross blocks. The corpus has four projects built to exercise this (`bounds-lab`, `bounds-two`, `bounds-offset`, `bounds-param`). In Blend the loop bound is `n`, not `work.length`, so no analysis can remove the check from the code alone; with an outer fact `n ≤ cap(work)` supplied through an assumption (section 13) it becomes removable, which makes Blend a small model of Candela's row-layout facts (idea 3 of design-doc 04).

**Needs.** C1's product, so that symbolic and numeric bounds reduce each other. **Proposed:** `boundsAnalysis`; a `bce2` pass whose `because` cites the bound.

**Acceptance.** Checked addresses left on Candela after `bcm` and `bce2` (100 today); checks removed on the four bounds projects against `bce`; Blend's check removed under the assumption and kept without it.

### C3. Facts across calls: the call graph and function summaries

**Size** M–L · **Depends on** nothing

Every analysis today stops at a call: the callee might do anything. A **summary** records what a function can do, computed bottom-up over the call graph so that a callee is summarized before its callers:

```text
summary(f) = { pure: no store, no trap, no impure call;
               mayTrap;  writes: which parameters' memory it stores to;
               resultRange: interval (or f32 interval) of the result }
for each strongly connected component of the call graph, callees first:
    iterate the functions of the component to a fixpoint, starting from the optimistic summary
```

A call to a pure function is then a pure value: `dce` can delete it when unused, `lvn` and `gvn` can share it, `licm` can hoist it. A summary of what a callee writes sharpens A3. And the call graph answers a question the checker needs: which functions can a change in `f` affect (D1).

**Why here.** Candela has 918 call operations and a math library of small functions. `hasEffect` treats every call as an effect, so `dce` keeps every `eval call`.

**Needs.** `dataflow` solves per function; a program-level analysis is a plain `defineAnalysis` whose result is keyed by function name. **Proposed:** `callGraphAnalysis`, `summariesAnalysis`, and purity predicates that consult them.

**Acceptance.** How many of the 332 functions are proven pure and trap-free; calls deleted, shared or hoisted on Candela; the corpus projects `calls`, `call-chain` and `across-calls` in instructions.

### C4. A relational fact base and Datalog analyses

**Size** L · **Depends on** nothing

The projection of section 4 is already a set of relations: `entity(id, kind)` and, per relation kind, `rel(from, to)`. A Datalog engine derives new relations from rules until nothing new appears. Many analyses are a few rules long:

```prolog
reach(B, D)      :- defines(D, L), in(D, B), last_def_of(L, B, D).
reach(B2, D)     :- succ(B1, B2), reach_out(B1, D).
reach_out(B, D)  :- reach(B, D), defines(D, L), !redefines(B, L).
depends(S, P)    :- uses(S, V), reads(V, P).                 % a slice on a parameter
depends(S2, P)   :- depends(S1, P), writes(S1, L), reads_local(S2, L).
```

The standard evaluation is *semi-naive*: each round joins only the tuples that are new since the last round.

```text
delta <- facts;  all <- facts
while delta not empty:
    new <- {}
    for each rule, for each body atom position i:
        new ∪= join(rule.body with atom i from delta, the others from all)
    delta <- new − all;  all ∪= delta
```

If the engine records, for each derived tuple, the rule and the tuples that produced it, then `why` works for facts the same way it works for entities.

**Why here.** The six analyses are 546 lines of hand-written TypeScript. The workbench lets a user define analyses (`src/workbench/workbench.ts` imports `dataflow` for this); rules are a far smaller thing to type into a tile than a transfer function. And one concrete query is wanted now: which statements of Candela depend on `K.scene`? The answer bounds what per-scene specialization (E1) can remove before anything is specialized.

**Needs.** **Proposed:** `src/framework/datalog/` (relations as sorted arrays or hash indexes, stratified negation, semi-naive evaluation, optional lattice-valued aggregates), and `relationsOf(view)` exporting a projection.

**Acceptance.** Reaching definitions in rules equals `reachingAnalysis` on all 70 corpus functions; the time ratio between the two; the `K.scene` slice of Candela, as counts of functions and statements.

### C5. Testing the facts themselves

**Size** S–M · **Depends on** nothing

A pass that acts on a wrong fact produces a wrong program, and the meaning check may or may not have a case that shows it. The facts can be tested directly, against executions:

```text
observe(run of f on a case):
  at every statement s reached, with local values vals:
      ranges:    vals[l] must lie in rangeView.at(s, l)             for every local l
      reaching:  the statement that last assigned l must be in reachView.reachingAt(s, l)
      liveness:  (second run) perturb a local that is dead after s; the outcome must not change
      summaries: a function summarized "pure" must leave memory unchanged
```

This is a differential invariant whose baseline is the analysis and whose subject is the evaluator.

**Why here.** The analyses are part of the trusted base of `strength`, `bce`, `dce` and the backend, and nothing checks them. The project already learned that a fact can be subtly different from what one expects (the round-robin schedule of section 8). Every domain added in C1, C2, C6 and every summary in C3 needs an acceptance test, and this is it.

**Needs.** Exists: `evaluate` with `counts`; `differential`; the views. **Proposed:** an `observe(stmt, locals)` hook in `evaluate`'s options, and invariants `typed.ranges-hold`, `typed.reaching-holds`, `typed.liveness-holds`.

**First experiment.** `typed.ranges-hold` on the corpus.

**Acceptance.** No violation over the corpus's cases and Candela's. A bug seeded into `evalRange` (a wrong bound for `shl`, say) is reported with the statement and the value. This item is small and protects much of what follows; do it early.

### C6. Float ranges, seeded from Candela

**Size** L · **Depends on** C1, C5, D6 for assumptions over ranges

An interval domain over f32 needs two things the integer domain does not: a flag for "may be NaN", and transfer functions that round *outward*, so that the abstract result covers the rounded concrete result. With intervals for float locals, clamps whose argument is already in range disappear:

```text
fmax(x, 0.0)  with  x in [0, 1], not NaN   ->  x
fmin(x, 1.0)  with  x in [0, 1], not NaN   ->  x
fabs(x)       with  x in [0, +inf]         ->  x
```

The useful intervals mostly do not follow from the Typed code. They are facts the renderer knows: a colour channel is in [0, 1], a ray parameter is non-negative, a normal has unit length. They enter as assumptions, exactly as section 13's bindings do, and every pass after them is checked on inputs drawn from those ranges.

**Why here.** Candela has 964 `min_num`/`max_num` operations (630 max, 334 min). This is idea 4 of design-doc 04. `InputSpec` already accepts a range `[lo, hi]` for case generation, but `Program.assume` accepts only fixed values.

**Needs.** **Proposed:** `f32IntervalLattice`; assumptions that are ranges; a fact artifact (`typed.facts`) generalizing `typed.bindings` from "parameter equals constant" to "parameter or field lies in range".

**Acceptance.** Clamps removed on Candela under stated assumptions; C5's check for the float facts passes; the meaning contract passes under the assumptions and, for at least one removed clamp, fails without them.

## Workstream D: checking and assurance

The gate is sampled differential testing. This workstream makes it cheaper, measures how strong it is, and adds stronger kinds of evidence beside it. The surveys' table of what each method establishes is the map:

| method | establishes | here |
|---|---|---|
| structural validation | the value is a well-formed IR | `validateBlocks`, `validateImage` |
| sampled differential check | agreement on the cases run | `typed.meaning-kept`, `rv32.image-agrees` |
| bounded exhaustive check | agreement on all inputs up to a bound | D3 |
| translation validation | this one transformation result is correct | D3 |
| checked certificate | a small checker accepted the pass's own argument | D4 |
| verified pass | correct for all inputs | out of scope |

### D1. Stop re-running the origin

**Size** S, then M · **Depends on** C3 for the second half

`runDifferential` (`differential.ts:102`) runs the baseline and the subject on every case. In a pipeline the baseline is always r0 and the cases are always the same, so r0's outcomes are recomputed for every pass.

```text
outcomes <- cache keyed by (origin.revision, case parameters hash)
check(origin, candidate):
    base <- outcomes.get(key)  or  compute and store        # once per program
    for each case: compare base[case] with run(candidate, case)
second half:  run only the cases of functions the pass changed, and of their callers
```

**Why here.** `tools/candela-o2.mjs` checks 13,280 cases after each of sixteen passes, and evaluates r0 on all of them each time. The pass report already lists the functions touched (`RevisionReport.fns`); `cfg` at r7 touched 3 of 332.

**Needs.** The cache can live in `meaningKept` (a map keyed on the origin's revision). The restriction to changed functions needs the invariant to see the change set, which it does not today, and a call graph (C3) to include callers.

**Acceptance.** Wall time of the Candela O2 run before and after, with identical evidence counts for the first half. For the second half, the evidence must state how many functions were skipped and why.

### D2. Stronger cases, and a measure of how strong

**Size** M · **Depends on** nothing

Four additions to case generation, and one measurement.

- **Boundary values from the program.** Every constant `c` compared against in the function suggests inputs `c − 1`, `c`, `c + 1`; every buffer suggests lengths 0, 1 and capacity. This is the integer counterpart of the float edge sweep.
- **Coverage-guided generation.** The evaluator's `counts` say which statements ran. Generate until every branch edge of r0 has been taken or a budget is spent, and report the coverage in the evidence.
- **Retained counterexamples.** A case that ever rejected a pass is stored with the project and always run.
- **Step-limit handling.** The corpus has 14 inconclusive cases and Candela 215 at the default limit; a second pass at a higher limit over only those cases removes most of them.
- **Mutation score.** Inject a small fault into a pass's *output* (flip an operator, change a constant by one, drop a statement, swap a branch) and count how many faults the gate rejects:

```text
killRate(project, N) = rejected mutants / all non-equivalent mutants,  at N cases per function
```

**Why here.** Two unsound float rewrites passed at 40 random cases (section 10). That was found because someone thought to test it. The mutation score turns "is 40 cases enough?" into a number per project, and tells you which kind of fault survives.

**Needs.** Exists: `casesFrom`, `evaluate` with `counts`, `F32_EDGES`. New generation must be opt-in, because the book's numbers depend on the exact default cases.

**Acceptance.** Branch coverage of r0 per corpus project; the kill rate at 40 cases before and after the additions, with a target of at least 99 % on the corpus; parity unchanged with the additions off.

### D3. Exact checking where it is affordable

**Size** L–XL · **Depends on** B2

Three levels, in increasing cost.

*Local translation validation.* Most edits replace one pure tree by another in the same statement. The transaction's edit log already lists each such replacement with both ids (`kind: 'replace'`, `from`, `to`, in `Tx.rewrite`). For such an edit it suffices to show that the two trees are equal for all values of their free locals, under the facts the pass cited:

```text
for each edit { kind: 'replace', from: t, to: t' } with both trees pure:
    hypotheses <- the range facts in the edit's because
    if t' is a constant and t has no free locals:   evaluate t; compare          (fold)
    else if a verified rule instance maps t to t':  cite the rule's evidence     (B2)
    else:  decide  forall locals. hypotheses => t = t'   by bit-blasting, or fall back to sampling
```

*Bounded exhaustive checking.* A function whose input space is small (an enum parameter and a few small integers, as in `match-enum`) can be run on every input.

*Symbolic comparison.* For loop-free functions, both versions can be evaluated symbolically into one expression per path and compared with the same decision procedure.

**Why here.** `assuranceOf` (`differential.ts:146`) can return `checked-exact`, and no Typed check ever produces it. A strategy could require exact assurance for a risky pass and accept sampled assurance for a routine one (idea 10 of design-doc 04), if the evidence existed.

**Needs.** The bit-vector decision procedure of B2; an invariant that takes the edit report as an input port.

**First experiment.** Local validation for `fold` (evaluation only) and `simplify` (rule citations).

**Acceptance.** The share of O2's edits on the corpus that are discharged exactly, per pass. The remaining edits name the reason they fell back.

### D4. Passes that carry their proof

**Size** L · **Depends on** nothing (D2's mutants are its test)

A pass knows why its edit is valid. Today it writes that down informally, in `because`: `fact:ranges(peak)@r5: x in [0, 40]`. A **certificate** is the same argument in a form a small independent checker can verify without trusting the pass:

```text
dce certificate for removing  s: set l = v :
    { stmt: s, local: l, claim: "l is not read on any path from s before being assigned" }
checker: walk forward from s over the CFG; fail on a read of l before a set of l;
         also require hasEffect(v) = false.            # about 30 lines, no liveness analysis

bce certificate:   { check: s, guard: branch g, index: i, buffer: b,
                     claims: g dominates s; g's taken edge implies i <u cap(b);
                             no assignment of i and no store to cap(b) on any path g -> s }
licm certificate:  { loop, moved value v, claims: v pure; no operand of v assigned in loop }
```

The checker is much simpler than the pass, shares no code with it, and its acceptance is recorded with assurance `proof` through `AnalysisManager.recordProof(property, artifact, certificate)`, which the framework already has.

**Why here.** The `because` discipline means every pass already states its argument. Certificates would catch a class of error sampling cannot: an edit that is wrong only on inputs no case contains. `bcm`'s soundness, for example, rests on an argument about address-space size that the diary flags as needing a second pair of eyes.

**Acceptance.** For `dce`, `bce`, `licm` and `bcm`: every application on the corpus and on Candela carries a certificate the checker accepts; D2's mutants of those passes are rejected by the checker alone, without running a case; each checker is shorter than its pass.

### D5. Generated programs and more oracles

**Size** M–L · **Depends on** nothing

The corpus is 70 hand-written functions and one generated renderer. A generator of random well-typed Typed programs, with loops bounded by construction, exercises combinations nobody wrote. Each program runs through every implementation available:

```text
p <- generate(seed)
outcomes <- [ evaluator(r0),  evaluator(O2),  emulator(our image at O0, O2, O2+),
              emulator(reference image),  the front end's Wasm module in the host ]
if they differ on any case:  shrink p (delete statements while the difference remains);  file it
```

**Why here.** The front end already emits WebAssembly, which gives an oracle that shares no code with the evaluator or either RV32 compiler (idea 15 of design-doc 04). Every disagreement found this way becomes a corpus project.

**Acceptance.** Ten thousand generated programs with no unexplained disagreement; the count and description of the defects found on the way.

### D6. Tolerance contracts

**Size** M · **Depends on** nothing

A differential check with a tolerance needs more than a looser `compare`. It must record how close the candidate was, so that the evidence is a measured bound and not a yes.

```ts
// Proposed extension of DifferentialSpec
compare(baseline, subject, kase): { ok: boolean; reason?: string; distance?: number };
// evidence gains: maxDistance, a histogram of distances, the case that attained the maximum
```

Distances for f32 results are in units in the last place (ulp); NaN must match NaN; traps must match exactly. Because every check compares with r0, the bound is end to end and does not compound from pass to pass. For images, a second metric renders a tile on the emulator with both programs and compares pixels; it is a `metrics` algorithm, usable in `chooseBest` constraints.

**Why here.** B6 and C6 cannot be accepted by the current contract by design. The framework's assurance vocabulary has no entry for "agrees within k ulp on the sampled cases".

**Acceptance.** `typed.meaning-within({ ulp: 1 })` accepts multiply-add fusion on the B6 project and rejects a reassociation that exceeds the bound; the evidence shows the largest distance and its case.

### D7. A mechanized semantics, and proofs where they are cheap

**Size** L · **Depends on** A6 (operator table), B1

The evaluator is the specification, and it is 599 lines of TypeScript. A second statement of the same semantics in a proof assistant (Lean, Coq or Isabelle) would allow three things that testing cannot give: a proof that a rewrite rule holds for all 32-bit values, a proof that a certificate checker (D4) accepts only valid edits, and a precise answer to questions the code leaves implicit, such as the capacity bound `bcm` relies on.

```text
formal side:    inductive Value / Stmt;  eval : Store -> Fn -> Args -> Mem -> Outcome
                theorem mul_pow2 (x k) : isPow2 k -> mul x k = shl x (log2 k)
link to code:   the operator table (A6) generates both `binop` and the formal definitions;
                a conformance test runs the extracted or transcribed evaluator on the corpus cases
```

The scope that pays off is narrow: the 54 value operators and the rule set. Proving whole passes correct, as CompCert does for each of its intermediate languages, is a different order of effort and is not proposed.

**Why here.** The IR is small and closed, f32 values are bit patterns with every operator's rounding fixed (section 5.1), and rules are about to become data (B1). Those are the conditions under which mechanized rule proofs are routine work.

**Acceptance.** Every rule of `simplify` and `strength` has a machine-checked proof or a recorded reason why not; the formal evaluator agrees with `evaluate` on the corpus's 6,986 decided cases.

## Workstream E: specialization, staging and Candela

### E1. Per-scene kernels

**Size** M · **Depends on** the RV32F backend for instruction counts

The gallery compiles 18 scenes into one module. 177 of its 332 functions are scene sections, reached through five dispatchers that read `q_k.scene` and branch to `s<k>_…`. Nothing writes that field. Binding it removes the other seventeen scenes:

```text
pipeline: specialize(K.scene = k) -> O2 -> dfe(entry points) -> O2+
dfe:  reachable <- closure of the call relation from the entry points;  delete the rest
```

Design-doc 05 section 7 has the design: a field form of `Binding` (`{ type: 'K', field: 'scene', value }`), assumptions over fields so that case generation sets the field in every constructed `K`, and a dead-function elimination pass whose entry points come from the project.

**Why here.** This is the experiment the artifact chain was built for (design-doc 03), and it is IRWB-001 task P4.3.

**Acceptance.** For each of the 18 scenes and for the general kernel: functions, statements, image bytes and instructions per pixel, against the reference compiler's `kernel` policy. Each per-scene program agrees with r0 on that scene's inputs, and `why` on a removed dispatcher branch reaches the scene fact.

### E2. Guarded specialization and function cloning

**Size** M–L · **Depends on** E1, C3

Assumed specialization changes the program's meaning outside the assumption. *Guarded* specialization keeps the meaning: clone the function for a chosen value, and test once on entry.

```text
kernel(k, ...):  if (k.scene == 3) return kernel_scene3(k, ...);     # clone, specialized on 3
                 return kernel_general(k, ...)
strategy: fork over sets of scenes to clone; chooseBest(minimize instructions,
                                                       constraint bytes <= budget)
```

The contract stays unrestricted, so no assumption has to be trusted by whoever runs the image.

**Why here.** Idea 2 of design-doc 04. It needs something no pass does today: creating a function. The write kinds (`values`, `stmts`, `locals`, `cfg`, in `tx.ts:27`) have none for functions.

**Needs.** **Proposed:** a write kind `fns`; `tx.cloneFunction(name, newName)` with origins from the original's entities; value profiles (F6) to choose which values deserve a clone.

**Acceptance.** The curve of instructions per call against image bytes as clones are added, on a small `scene-spec` project and on Candela's dispatchers.

### E3. Inlining

**Size** L · **Depends on** I3 (multi-origin correspondence)

Replacing a call by the callee's body removes the call sequence and, more importantly, exposes the body to the caller's facts.

```text
inline(call site c to callee g in caller f):
    copy g's blocks into f with fresh ids; map g's locals to new locals of f
    split c's block at c; assign the arguments to the copied parameters; jump to the copy's entry
    each `return e` in the copy becomes: result local <- e; jump to the block after c
    a record return: one local per leaf; `result#k` after c reads leaf k
decide: inline if size(g) <= threshold, or g has one call site, or c is hot (F6)
```

**Why here.** The reference compiler's default policy inlines; ours does not, and insertion sort (2,022 instructions against 1,533) and Collatz (1,590 against 1,486) are unchanged by O2. Candela has 918 calls, and 180 of its functions return records of up to 26 leaves, each of which crosses the call boundary through registers and stack words. Size matters on the device, so inlining is a natural `chooseBest` candidate under a byte constraint.

**Needs.** Each inlined entity has two origins, the callee's entity and the call site; correspondence currently uses only the first (section 11). The meaning check compares functions by name, so an inlined callee stays checked as long as it still exists; after `dfe` removes it, it is checked through its callers.

**Acceptance.** `calls`, `call-chain` and `across-calls` in instructions and bytes; sort and Collatz against the reference; calls remaining on Candela; `why` on an inlined statement shows both the callee statement and the call.

### E4. A general specializer

**Size** XL · **Depends on** E1, A3, C3

`specialize` handles one case of partial evaluation: a parameter known to equal a constant. The general technique classifies every value of a function as *static* (computable from what is known now) or *dynamic*, executes the static parts, and emits code only for the dynamic parts:

```text
bindingTime(f, static parameters):                     # a forward dataflow problem
    a value is static iff its operator is pure and all its operands are static
specializeFn(f, static values) -> residual function, memoized on (f, static values):
    static value            -> its constant (computed with the evaluator's own operators)
    branch on static value  -> only the taken successor
    call g with some static arguments -> call specializeFn(g, those)   # polyvariant
    loop with a static trip count below a bound -> unrolled
    load from memory declared constant -> the loaded value
```

The last line is the one that matters for Candela. A scene is described by rows of numbers in tables that the kernel reads. If a scene's rows are declared constant, loads from them become constants, and the kernel specialized on a scene is that scene compiled. This is the first Futamura projection in the form this project can use.

**Why here.** E1 removes the code of other scenes. It does not touch what the kernel does for *this* scene with data it reads from tables. `cdlInit`, which builds the tables, holds 256 of the 559 checked addresses.

**Needs.** A fact form for constant memory regions with provenance; A3's memory classes to know which loads read such a region; C3 to know no call writes it.

**Acceptance.** For one scene: loads folded, statements, instructions per pixel, each against E1's result for the same scene.

### E5. Records and frame arrays into locals

**Size** L · **Depends on** E3

Two sources of memory and register traffic can be removed once call boundaries are gone.

- A record returned as a `tuple` and read back through `result#k` leaves needs no materialization after inlining: leaf k of the result *is* the k-th expression of the tuple.
- A frame array (`aaddr`, `zero`) whose address never escapes and whose accesses all have constant offsets can be replaced by one local per accessed slot.

```text
scalarize(frame array A in f):
    require: every use of aaddr(A) is the address of a load or store with a constant offset
    for each distinct (offset, width, type): a new local;  store -> set;  load -> get
    zero A  ->  set each such local to 0
```

**Why here.** The PicoCalc measurements recorded in design-doc 04 (idea 7) found that on the device the kernel's cost is dominated by stack-frame traffic, which goes to slow external memory. The metric that matters for Candela is therefore loads and stores executed, not only instructions.

**Needs.** **Proposed:** a `memory` metric in `measure` (`strategies.ts:66`), counting executed load and store instructions from `runImage`'s per-word counts.

**Acceptance.** Executed loads and stores per pixel before and after; `result` leaves and frame arrays remaining.

## Workstream F: framework capabilities

These items do not make compiled programs faster. They make every experiment in the other workstreams cheaper, and several of those experiments are impractical without them.

### F1. Functions as the unit of change

**Size** L · **Depends on** nothing

A pass that edits three functions should cost three functions' worth of work. Today it costs the whole program several times over. `Store.from(native)` clones every record with `structuredClone` (`model.ts:219`, `:254`), and `toNative()` clones them all again. The framework's caches (section 3) are keyed on frozen objects, and after a pass every object is new, so every function is validated, encoded, hashed and projected again whether or not it changed.

```text
copy-on-write store:
    Store.from(native): keep references to native's frozen per-function tables
    first Tx edit in function f: clone f's tables into the working set
    toNative(): for an untouched function, return the same frozen objects
program revision <- hash(header, sorted [(name, functionHash)])         # a hash tree
project(value):  per function, cached on the frozen function object
diff(before, after): skip a function whose two objects are identical
analyses: one record per (definition, functionHash); a pass that changed 3 functions
          recomputes 3 results and reuses 329
```

**Why here.** On Candela a pass that changes nothing takes 18 seconds, and `cfg` at r7, which touched 3 functions, cost as much as a pass that touched a hundred. IRWB-001 report 3 names "hash incrementally" as the remaining framework change. Every Candela experiment, and the search of F5, multiplies this cost.

**Needs.** In the domain: `TypedBlocks` grouped by function (today its five tables are program-wide, keyed by ids that already carry the function name). In the framework: adapters that expose independently hashable parts. **Proposed:** an optional `parts(value)` on `IRAdapter`, per-part projection and diff, and analysis records keyed by part. The identity of a revision changes if the hashing scheme changes, so either the scheme is chosen to reproduce today's hashes, or the change is made once, deliberately, with the corpus's revision listing (`scripts/08-corpus-revisions.mjs` in IRWB-001) regenerated.

**First experiment.** The copy-on-write store alone, with no change to hashing: untouched functions keep their frozen objects, so the existing caches hit.

**Acceptance.** On Candela: a no-change pass under 1 second; a pass that changes 3 of 332 functions under 3 seconds. Corpus revisions identical, or the one deliberate change documented.

### F2. A persistent, content-addressed store

**Size** M–L · **Depends on** nothing (F1 multiplies the benefit)

Every key the system uses is already a content hash: an artifact's revision, an analysis definition's id and version with the subject's revision, a check's id and version with its inputs' revisions. Results stored under such keys never need invalidation. Only memory holds them today.

```text
store/
  artifacts/<revision>.json
  analyses/<definition>@<version>/<subject revision>-<params hash>.json
  checks/<invariant>@<version>/<inputs hash>.json          # the evidence
  passes/<pass>@<version>/<input revision>-<params hash>   # -> output revision, report
```

One hazard needs a rule: a definition whose code changed while its version string did not. The workbench's replay context already handles the same problem for user-written passes by putting a hash of the pass body in the key (section 15); the store should do the same for every definition.

**Why here.** `tools/candela-o2.mjs` took 36 minutes when first run and recomputes everything on every run. The search experiment took 21 minutes. `Program.revisions` is an array, and the framework's README states that a persistent cache is outside its scope.

**Needs.** **Proposed:** a storage port on `AnalysisManager` and on `applyPass` (`get(key)`, `put(key, value)`), with a directory backend for Node and an IndexedDB backend for the browser.

**Acceptance.** A second run of the Candela O2 tool with a warm store finishes in under a minute and prints the same report. Cold-run overhead under 5 %. Store size reported.

### F3. Demand-driven compilation on the task runtime

**Size** L · **Depends on** F1, F2

The framework's core has a task runtime that the Typed compiler does not use: `Compiler` and `CompilationRun` in `src/framework/core/runtime.ts`. A pass in that layer is a function of a task; it asks for its inputs with `context.require(task)`, the runtime records the dependency and the exact revision returned, caches results, and can explain a cache decision (`run.explainCache(artifact)`, `run.why(artifact)`, `run.compare(previousRun)`).

```text
tasks:  source(project)            ->  typed.source
        lifted(project, fn)        ->  typed.blocks for one function
        optimized(project, fn, strategy)
        code(project, fn, options) ->  machine code for one function
        image(project, options)    ->  requires code(...) for every function; lays out; encodes
re-run after an edit: a task re-executes only if an input's revision changed;
                      if its output revision is unchanged, its dependents are reused
```

That last property is the early cut-off that query-based compilers rely on, and content-addressed artifacts provide it without extra machinery.

**Why here.** IRWB-001 task P4.2 asks for the Candela chain as tasks. Idea 8 of design-doc 04 asks how long a recompile takes after editing one scene; the device needs 85 seconds for the whole gallery. The backend already compiles function by function (`compileFunction` in `compile.ts`) before laying out the image.

**Acceptance.** Host recompile time after a one-scene edit against a full compile; the cache explanation lists exactly the tasks that re-ran and the input that changed.

### F4. Parallel execution

**Size** M · **Depends on** nothing

Two kinds of work are independent and deterministic: evaluating different cases, and running different branches of a `fork`. The strategy interpreter has a `maxConcurrency` option (`interpreter.ts:146`), but it schedules asynchronous calls on one thread; the framework's README says so explicitly.

```text
pool of worker threads, each with the compiler loaded
differential check:  split cases into chunks; each worker evaluates (revision, chunk);
                     merge evidence in case order
fork:  each branch's algorithm calls run in a worker; artifacts travel by revision
       through the store (F2), or by structured clone
```

Results cannot depend on scheduling: cases are seeded, evidence is merged in a fixed order, and `chooseBest` breaks ties by candidate name. The same protocol works across processes and machines, because everything is addressed by content.

**Why here.** The full corpus check takes 84 seconds and the search experiment 21 minutes, both on one core.

**Acceptance.** The search experiment with eight workers against one: at least five times faster, with byte-identical decision records.

### F5. Search strategies and cost models

**Size** M for search, L for the model · **Depends on** F2, F4

The search of section 12 tried four hand-chosen orderings. Three directions go further.

*Guided search.* Beam search over pass sequences keeps the best `w` programs at each depth:

```text
beam <- [O2(r0)]
for depth in 1..d:
    candidates <- for p in beam, for pass in PASSES: apply(pass, p)      # rejected ones drop out
    beam <- the best w of (beam ∪ candidates), distinct by revision, by the metric
```

Distinct programs are recognized by revision hash, so two orderings that reach the same program are measured once. *Successive halving* ranks many candidates on a cheap metric (statements) and measures only the survivors on the emulator.

*A cost model.* Emulator runs dominate the cost of `measure`. A model that predicts instructions from static features (operators weighted by loop depth, tile costs, spill counts) can rank candidates without running them. The emulator stays the judge of the final choice.

*Autotuning.* The nine backend options and every pass parameter form a small configuration space. Sweeping it per project (or per function) is the simplest search there is, and its result is a strategy file.

*Generated candidates.* Any generator of pass sequences or rewrite rules is admissible, including a random mutator or a language model, because nothing it proposes is used without the gate (and, for rules, B2).

One methodological rule belongs here. The metric is measured on ten seeded cases per function. A search that optimizes that number will overfit it. Final results must be reported on cases from a different seed.

**Why here.** Four candidates found twelve improvements; nobody knows what forty would find. No corpus project contains a `strategies/` file yet: the four presets in `strategies.ts` are the only strategies in use.

**Acceptance.** Beam search with `w = 4`, `d = 6` over the corpus: total instructions below 75,651 on held-out cases, or evidence that 75,651 is a plateau; the cost in pass applications. For the model: rank correlation with the emulator of at least 0.9 on projects it was not fitted to.

### F6. Profiles and budgets

**Size** M · **Depends on** nothing

`heat` (`run.ts:117`) already attributes executed instructions to statements and source lines. As an analysis keyed by revision and cases, it can drive decisions:

```text
hot(f)  =  f's share of executed statements over the project's cases >= threshold
strategy:  conditional(hot, expensive pipeline, cheap pipeline)        per function
backend:   layout by edge frequency (G1);  inline hot call sites (E3);  clone on observed values (E2)
budget:    measure() also returns `ms`;  chooseBest( ..., constraint ms <= budget )
```

**Why here.** Ideas 14 and 16 of design-doc 04. The per-function search found nothing on the corpus, and report 2 argues that its case rests on programs with many independent hot functions; Candela has 332 functions and a render exercises some of them far more than others.

**Acceptance.** On Candela, with expensive passes restricted to the functions that cover 95 % of executed statements for a render case: compile time saved against statements executed.

## Workstream G: loops

### G1. Loop rotation and block layout

**Size** M · **Depends on** nothing

The lifter emits a `for` loop as a test at the top, with the exit in the middle of the body's path and a jump back at the bottom. Every iteration executes one conditional branch and one unconditional jump. Rotation moves the test to the bottom:

```text
before:  head: if !(i < n) goto exit        after:  if !(i < n) goto exit          # guard, once
         body: ...                                  body: ...
               goto head                                  if (i < n) goto body     # one branch
         exit:                                      exit:
```

The condition is duplicated, which is allowed only when it is pure. In the backend, the block order decides which branches fall through; `BackendOptions.layout` has the single value `'source'`.

**Why here.** This is one of the two gaps the prototype's book names against the reference compiler. On Blend's benchmark case the loop runs 40 times, so rotation alone is worth about 40 of the 68 instructions that separate 451 from 383.

**Needs.** A `rotate` pass (writes `cfg`, `stmts`, `values`) and a layout option that places a loop's blocks contiguously.

**Acceptance.** Blend, Checksum, insertion sort and Collatz in a new pipeline against the reference's 383, 292, 1,533 and 1,486; the change in bytes.

### G2. Induction variables

**Size** L · **Depends on** A4

A local that changes by a constant each iteration is a basic induction variable; an expression that is a linear function of one is a derived induction variable. Recognizing them enables three things:

```text
i = i + 1 each iteration;   address = work + (i << 1) + 4        # derived: step 2
strength reduction:   p = work + 4 before the loop;  use p;  p = p + 2 each iteration
test replacement:     i < n  ->  p < end,  end = work + 4 + (n << 1);  i becomes dead
ranges:               i in [i0, i0 + (trip count − 1) * step], exactly, with no widening
```

**Why here.** After O2+, Checksum's loop body still computes `load16[(work + (i << 1)) + 4]`, a shift and an add per iteration that a moving pointer would replace. The range analysis widens after three visits (section 8), which loses the upper bound of every loop that runs longer; exact induction ranges are what `bce` needs.

**Acceptance.** Checksum (1,260 instructions over ten cases under O2+), `strings` and `histogram`; additional `bce` removals; `why` on the new pointer local cites the induction fact.

### G3. Unrolling, peeling and unswitching as candidates

**Size** M · **Depends on** G1, A4

Three transformations trade code size for speed, which makes them candidates for `chooseBest` under a byte constraint and never defaults.

- *Unrolling* repeats the body k times per iteration of a new loop, saving k − 1 tests in k.
- *Peeling* runs the first iteration separately, which often makes a check or a branch in the remaining loop constant.
- *Unswitching* moves a loop-invariant branch outside the loop and duplicates the loop on each side.

**Why here.** The reference compiler unrolls kernels. Candela's kernels branch on scene-dependent values inside loops, which is the pattern unswitching targets.

A note on scope: the surveys give the polyhedral model considerable space. It represents a loop nest as a set of integer points and a schedule as a function on them, and it pays off on deep affine nests over arrays. Candela's tapes contain 19 `loop` operations in total and the corpus's loops are single. The machinery is not justified by anything measured here, so it is listed as deferred.

**Acceptance.** For each loop of the corpus: instructions against bytes for unroll factors 2 and 4 and for peeling; how many loops improve within a 25 % size budget.

## Workstream H: the backend

### H1. Instruction selection from a tile table

**Size** L · **Depends on** A5

A tile is a tree pattern over IR operators with a cost and the instructions it emits. Given a table of tiles, the cheapest cover of an expression tree is found by dynamic programming from the leaves up:

```text
tile { name: 'addi',  pattern: add(reg x, imm12 c),          cost 1, emit: addi rd, x, c }
tile { name: 'lw+off', pattern: load(add(reg b, imm12 c)),   cost 1, emit: lw rd, c(b) }
label(node):   for each tile t whose pattern matches at node:
                   cost <- t.cost + sum of best[child][nonterminal the pattern requires]
                   best[node][t.result] <- min
emit(root, 'reg'): follow the recorded choices top-down
```

`select` today is greedy, largest tile first, in 418 lines with 72 emission sites. Greedy and optimal coincide for many tile sets and differ for some. Because values are trees with one user, the dynamic program is exact for this IR.

**Why here.** This is extension E7 of the original design, the one framework extension that was planned and not built. A table makes the tile set a parameter: a strategy can compare tile sets, B6's `fmadd` is one new row, B5's discoveries become rows, and each instruction's `why` can name its tile. Three of the nine backend options (`fuse`, `immediates`, `divmagic`) are tile families switched in code.

**Acceptance.** With a table that encodes today's tiles and a greedy matcher: byte-identical images on the corpus. Then the dynamic program against greedy: instructions and bytes. Adding a tile is a change of about ten lines.

### H2. Register allocation: coalescing, splitting, colouring, and a yardstick

**Size** M to L per part · **Depends on** A5 for the later parts

Six separable pieces.

- **Copy coalescing.** A copy `t = i` whose source and destination are never live with different values can share a register, and the copy disappears. The allocator has a narrow form of this in `hints`, for parameters and results. At the IR level, a copy-propagation pass with an interference test removes the copy before the backend sees it.
- **Live-range splitting.** An interval that finds no register is spilled for its whole life (`regalloc.ts:132`). Splitting it at the point of contention, or around a call so that only the part that crosses the call needs a callee-saved register, keeps the rest in a register.
- **Graph colouring.** Build the interference graph, coalesce moves conservatively, colour, spill by cost and repeat. It is slower than linear scan and usually better; here it would be one more value of an allocator option, and a `chooseBest` candidate.
- **Allocation on SSA form.** The interference graph of a program in SSA form is chordal, so it can be coloured optimally in linear time, and spilling can be decided before colouring. With A1's view lowered into `rv32.mir`, this is a third allocator to compare.
- **PBQP.** Allocation as a partitioned boolean quadratic problem gives each interval a cost vector over registers and each pair a cost matrix; irregular constraints (an argument register here, a callee-saved one across that call, a preference between two move-related intervals) become entries, and a reduction-based solver handles them uniformly. It is the natural form once f32 adds a second register class.
- **A yardstick.** For functions with a handful of intervals, the allocation with the fewest executed spill instructions can be found by exhaustive search or by an integer program. That number says how far any heuristic is from the best possible.

**Why here.** The copy `t7 = i` in every bounds-checked loop is the book's other named gap. The ordering search showed that where `bce` removes the check, an extra `subst` removes the copy; where the check stays, as in Blend, the copy has two readers and needs coalescing. The corpus has `pressure` and `regalloc-lab` for exactly these questions, and `BackendOptions` already makes allocator choices data.

**Acceptance.** Blend with G1 and coalescing against the reference's 383. Executed spill loads and stores on `pressure`. The gap to the yardstick, per corpus function small enough to solve.

### H3. Frames and the calling convention

**Size** M · **Depends on** nothing

- **Shrink-wrapping.** Save callee-saved registers only on the paths that use them. A function that returns early on a common path then pays nothing for registers its slow path needs.
- **Allocation order by call frequency.** The `order` option chooses caller-saved or callee-saved registers first for the whole function. The right choice depends on how often each interval's range is crossed by an executed call.
- **A memory-traffic objective.** Add executed loads and stores to `measure` (see E5) and let strategies minimize it.

**Why here.** On the device, frame traffic goes to slow external memory and dominates the kernel's cost (design-doc 04, idea 7). The corpus has an `early-exit` project.

**Acceptance.** Executed loads and stores per call across the corpus under each option combination; `early-exit` with shrink-wrapping.

### H4. Code size: identical functions, and compressed instructions

**Size** S to count, M for folding, L for compression · **Depends on** F1 helps

*Identical-code folding.* Two functions with the same body can be one function. A first count needs no compiler work, and this ticket's `scripts/05-candela-duplicate-functions.py` makes it on the Typed source of the gallery:

```text
functions found: 324                 (of 332; the parser misses some signatures)
identical text: 9 groups, 65 functions removable
identical modulo scene prefix: 14 groups, 74 functions removable
     17 x  s0_customKernel, s1_customKernel, ...      15 x  s0_heightAt, ...
     14 x  s0_densityOf, ...                          12 x  s0_sdUser, ...
```

A fifth of the gallery's functions are copies of another. After optimization more will coincide, and with per-function hashes (F1) finding them is a table lookup.

```text
fold:  group functions by hash of their body with the function's own name abstracted
       iterate, treating calls to already-merged functions as equal
       keep one per group; redirect calls; record correspondence (merged: many -> one)
```

*Compressed instructions.* The device's processor implements the C extension, which encodes the most common instructions in 16 bits. Using it shrinks typical RISC-V code by roughly a quarter; that figure is general experience, not a measurement of this compiler. Two things stand in the way and should be checked before any work starts: `validateImage` requires the code length to be a multiple of four with one record per word (`image.ts:161`, `:189`), and the vendored interpreter shows no decoding of compressed instructions, so the oracle would have to be extended or replaced.

**Why here.** The gallery image is size-constrained on the device, and the per-scene work (E1, E2) trades size against speed; both terms of that trade should be as good as they can be.

**Acceptance.** For folding: functions and bytes removed on Candela at r0 and at the O2 head; the program still agrees with r0. For compression: bytes over the corpus (5,160 today) with the image contract passing on an oracle that executes compressed code.

### H5. A target description, scheduling, and a second target

**Size** M to L per part · **Depends on** A5, H1

Three pieces of backend generality, with honest relevance notes.

- **A declarative target description.** Registers and their classes, the calling convention, instruction encodings and tile costs live in constants across `encode.ts`, `regalloc.ts` and `select.ts`. Collected into one data description, they make the backend retargetable and let tools (the MIR interpreter of A5, the superoptimizer of B5, the encoder) be generated from it or checked against it.
- **Instruction scheduling.** Reordering independent instructions to suit a processor's pipeline changes nothing the emulator can measure: the metric is instructions executed. This becomes a research item only together with a timing model of the device's core (load-use delay, branch cost) as an additional metric. Without that model there is no acceptance number, so it is listed and deferred.
- **A second target.** The vendored front end emits WebAssembly directly from the tape. A backend from *optimized* `typed.blocks` to WebAssembly would be small (expression trees map onto a stack machine; the hard part is rebuilding structured control flow from the CFG) and would do three jobs: an independent execution engine for the optimized program (D5), a test that the tile table and target description of H1 are not RV32-shaped by accident, and the fastest way to run Candela's optimized floats before the RV32F backend lands.

```text
target { regs: { x: [...], f: [...] }, callerSaved, calleeSaved, args, scratch,
         insns: [{ name, format, fields, semantics }], tiles: [...] }
structured control: loops from the loop tree (A4); forward branches as nested blocks
```

**Why here.** The float backend is being written by extending each of the three files by hand; a description would have made the second register class a data change. The Wasm route addresses the largest current blind spot, that Candela's results are measurable only in statements.

**Acceptance.** The RV32 description regenerates today's encoder tables with byte-identical images. The WebAssembly backend agrees with the evaluator on the corpus and on Candela's 33,200 cases at the O2 head.

## Workstream I: research tooling

### I1. An experiment ledger

**Size** S–M · **Depends on** nothing

The numbers this guide cites were copied by hand from diaries and reports. A ledger makes them data:

```text
results/<tool>/<commit>-<params hash>.json   { tool, commit, params, per-project metrics, totals }
tools/ledger.mjs compare <baseline> <current>     # per-project deltas; non-zero exit on regression
```

**Why here.** Every acceptance line in this agenda is a comparison with a number: 77,321 instructions, 5,160 bytes, 6,986 decided cases, 451 and 383 on Blend. A change that moves one of them should be noticed by a tool.

**Acceptance.** The ledger regenerates the tables of sections 12 and 16 from stored results, and a deliberately slower pipeline fails the comparison.

### I2. Explaining why a pass did not fire

**Size** M · **Depends on** nothing

`why` explains what happened. Research on missed optimizations needs the opposite: at this site, which condition of which pass failed?

```ts
// Proposed, inside a pass body
tx.decline(site, 'index may be negative', { fact: `ranges: ${text} in [${lo}, ${hi}]` });
// collected in the pass report; no change to the program
p.whyNot('bce', 's:blend.6')   // -> the first unmet condition, with the fact that failed it
```

Weighted by `heat`, the declines of all passes over the corpus rank which missing fact costs the most executed instructions. That ranking is the evidence for choosing between C1, C2, A3 and G2.

**Why here.** Blend's `project.json` asks the reader, as an exercise, "Why does the bounds check on work.charCodeAt(i) survive O2 here?" The compiler cannot answer it. Understanding the surviving copy `t7 = i` took a corpus-wide search experiment.

**Acceptance.** `whyNot` answers the Blend question. Each of the twelve passes reports its declines; a table of decline reasons over the corpus, weighted by heat.

### I3. Repairs the other items depend on

**Size** S–M each · **Depends on** nothing

Four known limits of the current code, each small, each blocking something above.

- **Correspondence with several origins.** `revisionCorrespondence` (`passes.ts:114`) reads `origin[0]` only. Inlining (E3), value numbering across blocks (A2), identical-code folding (H4) and equality saturation (B4) all create entities with more than one source.
- **Entities that live and die inside one pass.** They appear in no revision, so `why` answers `absent` (IRWB-001 report 2, section 9). Keeping them in the revision's report restores the answer.
- **Preservation audited by default in tests.** `auditPreservation` exists and only `tools/audit-preservation.mjs` uses it. The test suite should run every pass that way, so that a false claim in a new pass fails immediately.
- **Function-level `writes` and transfer.** A pass's declared writes and an analysis's checked transfer are program-wide. With F1, both can be per function.

**Acceptance.** A test for each: a two-origin entity whose `why` shows both; a pruned entity that resolves; a pass with a false claim that the default test run refuses.

### I4. Debugging and visualization

**Size** M · **Depends on** nothing

Three tools that a compiler built from recorded, checked steps can offer almost for free.

- **Bisection.** When a final check fails, or a metric regresses, the revision timeline is a sequence of hashed states. Binary search over it names the first revision at which the property changed, and the edit log of that revision names the edits; delta debugging over those edits (reapply subsets) names the one responsible.
- **Case reduction.** A counterexample is a function, arguments and a memory image. Shrinking it (smaller integers, shorter buffers, fewer statements in the program while the disagreement remains) produces the report a person can read.
- **Views of the new structures.** Each representation of workstreams A to C needs a tile: the SSA view with definition-use arrows, the e-graph of one statement with the extracted term highlighted, a fact's derivation, a strategy execution as a tree with rejected branches.

```text
firstBad(revisions, property):  binary search for i with property(r[i-1]) and not property(r[i])
culprit(r[i-1], edits):         ddmin over subsets of edits, re-running the property
```

**Why here.** The workbench shows revisions, facts, lineage and checks (section 15). It has no tool that starts from a failure and works backwards. With `check: false` a wrong pass can be published deliberately, as the `wrong-shift` project does, which gives a ready test.

**Acceptance.** On `wrong-shift` with the check disabled, bisection names `div-to-shift` and the single replaced division; the reduced counterexample has one negative argument.

### I5. Language-server tooling

**Size** L · **Depends on** F3

A language server answers editor requests (diagnostics, hover, go to definition) from a compiler kept alive between keystrokes. This compiler has unusual answers to offer: on hover over a source expression, the facts at that point, the instructions it became and how often they ran; "go to origin" from a machine instruction to its source line and back; a diagnostic where a bounds check could not be removed, with the reason (I2).

```text
textDocument/didChange  ->  re-run only the tasks whose inputs changed (F3)
textDocument/hover      ->  facts at the statement covering the position; heat; covers
custom: typed/why       ->  the provenance tree of the entity at the position
```

**Why here.** All of the data exists behind `Program` and `wb`; the browser workbench is the only client. Two obstacles are real and should be stated: the front end is vendored and rejects incomplete programs, where an editor needs a parse of whatever is on screen, and a full recompile per keystroke is affordable for corpus programs and not for Candela until F1 and F3 exist.

**Acceptance.** In an editor, on Blend: hover shows the range of `i` and the instruction count of line 5 (322 of 451); an edit to one function re-runs only that function's tasks.

## Workstream J: front ends, languages and IR design

The items so far take the source language and the shape of the compiler as given. This workstream questions both, using ideas the surveys draw from language workbenches, machine-learning compilers, database optimizers and infrastructure tools.

### J1. A staged builder for `typed.blocks`

**Size** M · **Depends on** nothing

Programs such as Candela's kernel are *generated*: a tool prints Typed source text, which the front end parses again. An embedded builder lets a generator construct the IR directly, in ordinary host code, and distinguishes values known while generating from values of the generated program:

```ts
// Proposed
const f = fn('lerp', { a: f32, b: f32, t: f32 }, f32, ({ a, b, t }) =>
  ret(a.add(b.sub(a).mul(t))));          // a, b, t: Rep<f32>, operations build value trees
for (const k of scenes)                   // k: a host number, known now
  emit(sceneSection(k));                  // each entity's origin: the generator call that made it
```

This is the staging idea of systems such as Lightweight Modular Staging and JAX: host-language execution builds the object program, and what is known at build time is folded before any IR exists.

**Why here.** Facts that Candela's generator knows (which scene, which rows, which values are colours) are lost when it prints text, and workstream E recovers them afterwards through bindings. A builder would carry them as origins from the start. `src/typed/builder.ts` already has a builder API, for user passes; it edits existing functions and does not create programs.

**Acceptance.** A corpus project generated through the builder produces the same r0 as its text form, apart from origins; `why` on a statement reaches the generator call.

### J2. A language for passes: rules, strategies and site selection

**Size** L · **Depends on** B1

The Strategy IR orders whole passes. Rewriting systems such as Stratego, and MLIR's transform dialect, go one level down: a small language that says *where* in the program a rule applies and how applications combine.

```text
strategy simplify-hot =
    select fn where hot(fn)                      # site selection by a fact
    then innermost(rules: algebra)               # traversal as a combinator
    then try(rule: mul-pow2) ; repeat(rule: fold)
```

A pass then becomes data end to end: rules (B1), a traversal, a site predicate, and the declared writes that follow from the rules' right-hand sides.

**Why here.** The framework has the pieces separately: seven rewrite schedules, a predicate registry for patterns, and Strategy IR nodes for sequencing and choice. They are not connected: a strategy can apply `typed.simplify@1` and cannot say "only in this loop" except through the per-function variants registered by hand in `strategyRegistry`. Passes written in the workbench are JavaScript bodies; a declarative form could be listed, diffed and checked like a strategy file.

**Acceptance.** `simplify`, `fold` and the per-function restriction expressed in the language with identical corpus hashes; a strategy file that restricts a rule set to one loop of one function.

### J3. Algorithm and schedule

**Size** L · **Depends on** A4, G1–G3

Halide separates *what* an image pipeline computes from *how* its loops are arranged; TVM and MLIR's transform dialect adopted the split. The same program with a different schedule (loop order, unrolling, what is computed once and stored) is a different point in a search space, and the schedule is small enough to store, compare and search.

```text
algorithm:  the typed.blocks program at r0
schedule:   [ rotate(loop L1), unroll(L1, 4), hoist(v:..., out of L2), clone(f, scene = 3) ]
compile:    apply the schedule's steps as passes; each is checked; the list is the artifact
```

**Why here.** A published strategy winner is already a chain of pass names. What is missing is parameters and targets: `apply` nodes accept `args`, and no Typed pass takes any except `specialize`. Loop and cloning passes (G3, E2) need them, and once they have them a schedule is a strategy plan with arguments. Device-specific tuning, where memory traffic matters more than instructions, then becomes a different schedule for the same program, not a different compiler.

**Acceptance.** Two schedules for one corpus loop, stored as strategy files, both checked, with their instruction and byte counts in the decision record.

### J4. A cost-based planner with a memo

**Size** XL · **Depends on** B4, H1

Database optimizers in the Volcano and Cascades line keep a *memo*: groups of logically equivalent expressions, each with alternative physical implementations, and search it top-down with costs and required properties. It is the same idea as an e-graph with two additions that matter for a backend: the split between logical alternatives and physical ones, and properties (in a database, sort order; here, which register class or which location a value must be in).

```text
group G:  logical   { x*8, x<<3, (x<<2)+(x<<2) }
          physical  { slli rd,x,3 : cost 1 }, { via mul : cost 3 }
optimize(G, required property):  best physical alternative whose inputs' best plans add up cheapest
```

Instruction selection (H1) is then extraction from the equality graph (B4) with tile costs, done in one search instead of two passes that cannot see each other.

**Why here.** `simplify` rewrites `x * 2^k` to a shift because the backend prefers it; that is a selection decision made in the middle end, where it can hide the multiplication from other rules. A memo makes the choice once, with the cost in view.

**Acceptance.** On the corpus, selection from the memo matches or beats `eqsat` followed by tile selection; the time per function.

### J5. Plans, not just results

**Size** M · **Depends on** F3

Infrastructure tools such as Terraform compute a *plan* before acting: the difference between the desired state and the recorded state, as a list of operations to review. The compiler has the same three ingredients (the sources, the store of previous results, the task graph) and can answer before compiling:

```text
plan(edit):  tasks that will re-run, with the input that changed;  tasks reused;
             estimated time from stored timings;  checks that will be repeated
```

Related, from the same tools: stable identity across runs. Entity ids such as `s:blend.15` are allocated from counters, per function. A pass never renumbers anything, but after a *source edit* every id allocated after the edit point in that function changes, and stored provenance or annotations keyed by id are lost. An identity scheme that survives edits (ids derived from structure and position within the function, or a matching step between old and new r0) is the prerequisite for anything that persists across edits.

**Why here.** F2 and F3 make results persistent; this item makes their consequences visible and their keys stable. The workbench's `dryRun` and `actions` already preview a single pass.

**Acceptance.** After a one-line edit to a corpus project, the plan lists the tasks that then actually run, and nothing else; entities of the edited function that the edit did not touch keep their ids.

# Part 3: Roadmap and assignments

## 19. Priorities

The order below follows two criteria: what a later item depends on, and how much measured loss an item addresses. The numbers are the ones established in Part 1.

**First: make experiments cheap and the gate measurable.** A no-change pass on Candela costs 18 seconds, the ordering search 21 minutes, and the strength of the 40-case gate is unknown. Everything else in the agenda is an experiment that runs passes and checks them, so these come first: D1 (stop re-running the origin), F1 (functions as the unit of change), F2 (a persistent store), F4 (workers), C5 (test the facts), D2 (mutation score), I1 (the ledger), I3 (repairs).

**Second: close the gaps that are already measured.** Against the reference compiler, Blend is at 451 against 383 and insertion sort at 2,022 against 1,533. The causes are named: loop layout, a copy, and inlining. Items G1, H2 (coalescing) and E3 address them directly, and E1 is the Candela experiment the project was set up to run.

**Third: turn rules and facts into data.** B1 and B2 (rules as verified data) and A1 (the single-assignment view) are moderate in size and unlock most of the research-grade items: rule discovery (B3), equality saturation (B4), exact checking (D3), sparse propagation and global value numbering (A2), the tile table (H1).

**Fourth: the long bets.** Equality saturation (B4), the general specializer with constant memory (E4), proof-carrying passes (D4), the relational fact base (C4), demand-driven compilation (F3), the registered chain up to Candela (A6). Each is large, each changes what the system is, and each has a first experiment small enough to decide whether to continue.

## 20. Phases

| phase | weeks | items | exit criterion |
|---|---|---|---|
| 0. Foundations | 1–4 | D1, C5, I1, I3, D2, F4, H4 (count), F1 (copy-on-write store) | Candela no-change pass under 1 s; kill rate known per corpus project; ledger in the test run |
| 1. Measured gaps | 3–10 | G1, H2 (coalescing), E3, E1, B1, A1, F2, A4, I2 | Blend at or below 400; per-scene table for 18 scenes; `simplify` from a rule table with identical hashes |
| 2. New capabilities | 8–20 | B2, B3, A2, A3, C1, C2, C3, D3, D6, B6, E2, E5, A5, H1, H3, F5, F6, G2, D5, I4, J1 | at least one `checked-exact` pass application; `O3` beats `O2+` on the corpus; Candela checked addresses below 100 |
| 3. Long bets | 16+ | B4, E4, D4, D7, C4, C6, F3, A6, B5, G3, H2 (colouring, SSA, PBQP, yardstick), H4 (compression), H5, I5, J2, J3, J4, J5 | each: its first experiment's number, and a decision to continue or stop |

Phases overlap on purpose: an item starts when its dependencies are done, not when the previous phase ends.

```text
 D1 ─┐
 F1 ─┼─► F2 ─► F3                 B1 ─► B2 ─► B3 ─► B4
 F4 ─┴─► F5                              └──► D3            A5 ─► H1 ─► B5
 C5 ─► C1 ─► C2 ─► C6             A1 ─► A2                        └──► H2 (later parts)
 I3 ─► E3 ─► E5                   A4 ─► G2, G3                D6 ─► B6
 E1 ─► E2 ─► E4 ◄─ A3, C3         G1 ─► G3
```

## 21. Suggested assignments

Six seats. Each owns a coherent area and has one item small enough to finish in the first two weeks, which is the best way to learn the code.

| seat | owns | starter item | then |
|---|---|---|---|
| Throughput | workstream F, D1, I5, J5 | D1 (cache the origin's outcomes) | F1, F2, F4, F3, J5, I5 |
| Assurance | workstream D, C5, I4 | C5 (`typed.ranges-hold`) | D2, I4, D3, D4, D5, D6, D7 |
| Rules and equality | workstream B, I2, J2, J4 | B1 (`simplify` from a table) | B2, B3, J2, B4, B5, J4 |
| Analyses and SSA | A1–A4, C1–C4 | A4 (loop tree) | A1, A2, C1, C2, A3, C3, C4 |
| Specialization and staging | workstream E, A6, C6, B6, J1 | H4's duplicate-function count at the IR level | E1, E3, E2, E5, J1, E4 |
| Backend and loops | A5, workstreams G and H, J3 | G1 (rotation) | H2, A5, H1, H3, G2, G3, H5, J3 |

A new intern should take a starter item from the seat they will join, and before writing code should do three things: run `npm test` and `node tools/parity.mjs`; open the workbench on Blend and step through O2 one pass at a time, asking `why` of `s:blend.15`; and read the diary step in IRWB-001 that is closest to their item (the index is in section 23).

## 22. Decisions and risks

**Decisions this agenda makes.**

| decision | reason | consequence |
|---|---|---|
| The primary IR stays a CFG with expression trees; SSA, memory versions, the loop tree and e-graphs are views | parity with the book depends on the current ids and shapes; the surveys' account of V8 leaving its graph IR, and this project's Candela profile, both show the cost of generality | each view must prove its worth in compile time as well as in results |
| The sampled meaning contract remains the gate for everything; exact methods are added beside it | it is the one check that applies to every pass, rule and search without per-technique work | D2's kill rate is a first-class number, tracked like instructions |
| `O2` and the book's numbers are frozen | they are the evidence that the port is faithful | new work appears as new pipelines, options and projects |
| New facts get new analysis definitions | changing `typed.ranges` changes what `strength` and `bce` do on the corpus | `typed.ranges2` and the like, used by new pipelines only |

**Risks.**

- **The float backend is on another branch.** Until it merges, every Candela acceptance line that says "instructions per pixel" can be measured only in statements. Items B6, E1, E2, E5 and H3 are affected. Statements, functions, bytes of the integer subset and checked-address counts are measurable now.
- **Hash stability under F1.** If per-function hashing changes revision hashes, ids and facts do not change, but every stored revision string does. Make that change once and before F2 creates a store that depends on it.
- **Overfitting the metric.** Ten seeded cases per function decide `chooseBest`. Search (F5), rule discovery (B3) and superoptimization (B5) all optimize against the measure; report on held-out seeds.
- **Trust in the gate.** A technique that generates many candidates raises the chance that one wrong candidate slips through a sampled check. This is the argument for doing D2 before B3, B4 and F5, and for B2 and D3 as soon as rules exist.
- **Growth in equality saturation.** A small rule set can produce a very large graph. B4's first experiment is per statement with a node limit for that reason, and the share of statements that hit the limit is part of its report.

## 23. Where to look

**Code, by question.**

| question | file |
|---|---|
| How is a value hashed and frozen? | `src/framework/core/data.ts` |
| What does an adapter have to provide? | `src/framework/ir/types.ts`, `src/framework/ir/adapters.ts` |
| What happens when a pass is applied? | `src/framework/passes/define-pass.ts` (`applyPass`) |
| How does a dataflow analysis become a cached fact? | `src/framework/dataflow/analysis.ts`, `solver.ts`, `lattices.ts` |
| How is a sampled check defined and what does its evidence hold? | `src/framework/contracts/differential.ts` |
| What can a strategy plan say? | `src/framework/strategy/ir.ts`, `builders.ts`, `README.md` |
| What is in a `typed.blocks` value? | `src/typed/model.ts`, `src/typed/ir.ts` |
| How is each operator evaluated? | `src/typed/evaluate.ts` (`binop`), `src/typed/f32.ts` |
| Where are the passes? | `src/typed/passes.ts`, `src/typed/specialize.ts`, `src/typed/tx.ts` |
| How is a strategy run and its winner published? | `src/typed/strategies.ts` (`runStrategy`) |
| How does a statement become instructions? | `src/typed/backend/select.ts`, `regalloc.ts`, `compile.ts`, `encode.ts` |
| How do synchronous scripts drive asynchronous passes? | `src/workbench/sync.ts` |

**Documents.** In `ttmp/2026/11/24/IRWB-001--ir-workbench/`: `design-doc/02` (the compiler on the framework, with worked examples), `design-doc/03` (the Candela chain), `design-doc/04` (the sixteen ideas this agenda absorbs), `design-doc/05` (the current phase), `analysis/03` (the Candela inventory). The diaries record what failed: `log/02-implementation-diary.md` steps 3 (the extensions), 4 (the passes and the schedule lesson), 6 (the preservation audit), 9 (the search), 12 (framework cost), 13–14 (`bcm`); `log/04-f32-candela-agent-diary.md` step 5 (the unsound float rewrites); `log/05-ui-agent-diary.md` step 1 (the replay context).

**Scripts of this ticket** (`ttmp/2026/11/24/IRWB-002--…/scripts/`): `01-survey-outline.sh`, `02-exported-api.sh` (every exported declaration with its line, for checking this guide's references), `03-survey-read.sh`, `04-code-inventory.sh` (the counts in section 2), `05-candela-duplicate-functions.py` (the count in H4).

**Reading, by workstream.** The two surveys this agenda drew on list their sources in full; the entries below are the ones to read first.

| workstream | read first |
|---|---|
| A | Braun et al., "Simple and Efficient Construction of Static Single Assignment Form" (2013); Kelsey, "A Correspondence between Continuation Passing Style and Static Single Assignment Form" (1995); the V8 team's "Land ahoy: leaving the Sea of Nodes" (2025) |
| B | Tate et al., "Equality Saturation: A New Approach to Optimization" (2009); Willsey et al., "egg: Fast and Extensible Equality Saturation" (2021); the Cranelift work on acyclic e-graphs (2023); Massalin, "Superoptimizer" (1987); Schkufza et al., "Stochastic Superoptimization" (2013) |
| C | Cousot and Cousot, "Abstract Interpretation" (1977); Nielson, Nielson and Hankin, *Principles of Program Analysis*; Scholz et al., "On Fast Large-Scale Program Analysis in Datalog" (2016); Zhang et al., "Better Together: Unifying Datalog and Equality Saturation" (2023) |
| D | Yang et al., "Finding and Understanding Bugs in C Compilers" (2011, Csmith); Lopes et al., "Alive2: Bounded Translation Validation for LLVM" (2021); Leroy's CompCert papers; Necula, "Proof-Carrying Code" (1997) |
| E | Jones, Gomard and Sestoft, *Partial Evaluation and Automatic Program Generation*; Futamura, "Partial Evaluation of Computation Process" (1971) |
| F | Mokhov, Mitchell and Peyton Jones, "Build Systems à la Carte" (2018); the rustc development guide on queries and incremental compilation; the Salsa documentation |
| I, J | Zeller, "Simplifying and Isolating Failure-Inducing Input" (2002); Bravenboer et al., "Stratego/XT 0.17" (2008); Rompf and Odersky, "Lightweight Modular Staging" (2010); Ragan-Kelley et al., "Halide" (2013); Graefe, "The Cascades Framework for Query Optimization" (1995); Lattner et al., "MLIR" (2021) |
| G, H | Hack, Grund and Goos, "Register Allocation for Programs in SSA Form" (2006); Scholz and Eckstein, "Register Allocation for Irregular Architectures" (2002); Cooper and Torczon, *Engineering a Compiler*; Rastello and Bouchez Tichadou (eds.), *SSA-Based Compiler Design*; Poletto and Sarkar, "Linear Scan Register Allocation" (1999); Warren, *Hacker's Delight* |

## 24. Glossary

| term | meaning in this project |
|---|---|
| artifact | an immutable value with a content-derived revision hash (section 3) |
| revision | either the hash of an artifact, or its position r0…rN in a program's timeline |
| adapter, projection | the mapping from a native value to entities and relations, and its result (section 4) |
| fact | the cached result of an analysis for one revision (section 8) |
| pass | versioned code with declared needs, writes and preservation claims (section 9) |
| contract | named conditions a transformation's output must meet (section 10) |
| meaning check, the gate | `typed.meaning-kept`: sampled agreement with r0 (section 10) |
| assurance | how strong a piece of evidence is: declared, checked, transferred, proof; sampled or exact |
| origin, `because` | what an entity was made from, and what justified the change (section 11) |
| correspondence | the relation between the entities of two revisions or two IRs (section 11) |
| strategy, plan | a JSON program over passes that can fork, measure and choose (section 12) |
| binding, assumption | an outer fact about a parameter, and the restriction of the contract to inputs that satisfy it (section 13) |
| image, `covers` | the machine code artifact; per instruction, the IR entities it implements (section 14) |
| the corpus, the book | the 44 projects and the prototype's text whose numbers are the regression oracle (section 16) |
| Candela | the 332-function path tracer used as the large program (section 16) |
| view | in Part 2: a derived representation computed from a revision, never edited directly |
