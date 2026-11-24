---
Title: 'Typed to RV32 compiler on the v6 framework: worked examples'
Ticket: IRWB-001
Status: draft
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/compiler-workbench-projects/site/app/engine/analyses.js
      Note: Real lattices and dataflow analyses behind the dataflow() builder (E4)
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/compiler-workbench-projects/site/app/engine/backend.js
      Note: Real tiling/linear-scan backend behind sections 8 (E7)
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/compiler-workbench-projects/site/app/engine/passes.js
      Note: Real fold/licm/bce implementations the examples port
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir-examples/expressions.ts
      Note: Model for the typed.blocks adapter (defineIR + defineAdapter + rebuild)
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir-examples/lab.ts
      Note: Hand-wired Pass + PassPolicy + semantic transaction that definePass (E3) would generate
    - Path: repo://ttmp/2026/11/24/IRWB-001--ir-workbench/sources/ir-source-workbench-v6/src/ir-examples/rules.ts
      Note: Model for rewrite rules (pattern, guard, replace, correspond)
ExternalSources: []
Summary: 'Concrete sketches of the whole Typed → RV32 compiler written on the v6 framework: the IR chain, adapters, lowering tasks, dataflow analyses, rewrite rules and imperative passes, differential contracts, strategies, instruction selection, and the workbench API on top. Each snippet is labelled v6 (exists) or NEW (proposed extension), and section 10 lists the extensions.'
LastUpdated: 2026-11-24T20:00:00-05:00
WhatFor: 'Make design-doc/01 concrete: what defining the entire compiler on the v6 framework looks like, and which v6 extensions it needs.'
WhenToUse: When designing the kernel API in Phase 1, and when judging whether an extension belongs in the framework or in the domain.
---

# Typed to RV32 compiler on the v6 framework: worked examples

## 0. Goal and reading guide

The goal is to define the **entire** Typed → RV32 compiler from Compiler Workbench (CW) with the v6 framework. That covers representations, lowerings, analyses, optimizations, checks, strategy and backend. v6 gets extended only where CW has something v6 lacks.

Every snippet is TypeScript and marks each call:

- `// v6` means it exists in v6 today with this shape: `defineAdapter`, `openIR`, `beginEdit`, `pattern`/`op`/`capture`, `rewrite`, `saturate`, `defineInvariant`, `defineTransformation`, `Compiler.register`, `ctx.require`/`ctx.derive`, and the strategy builders.
- `// NEW` means a proposed extension, collected in §10.

Domain behaviour (what each pass does, the numbers) is taken from CW's real implementation in `sources/compiler-workbench-projects/site/app/engine/`. The snippets are design sketches. They have not been compiled.

## 1. The compiler as a chain of representations

v6 calls for one representation per meaningful concept, each with its own validator and adapter. CW today has one store plus ad hoc images. On the new framework the compiler becomes six artifact kinds connected by lowering tasks. Optimizations are revisions within one kind.

```
typed.project ──frontend──▶ typed.tape ──lift──▶ typed.blocks ⟲ optimizations (r0 … rN)
   (files)        (reused)    (stack code       (functions, blocks,      │
                               + spans)          statements, values)     │ select
                                                                         ▼
                              rv32.image ◀──encode── rv32.alloc ◀──regalloc── rv32.vcode
                              (bytes,               (physical regs,           (virtual regs,
                               entries)              frames, spills)           insn covers stmt)
```

| Kind | Native storage (domain-owned) | Entities | Relations |
| --- | --- | --- | --- |
| `typed.project` | `{ files: Record<path, text>, meta }` | file | contains |
| `typed.tape` | The reused front end's output: ops with `line`/`col`/`file` | fn, op | contains, operand |
| `typed.blocks` | Keyed tables: `fns`, `blocks`, `stmts`, `values`, `locals` | fn, block, stmt, value, local | contains (ordered), operand, uses, reads/writes local, **succ (control)** |
| `rv32.vcode` | Per function: blocks of machine instructions on virtual registers | fn, block, insn, vreg | contains, def/use, succ |
| `rv32.alloc` | vcode + an assignment `vreg → reg`, frame layout, spills | + interval, slot | assigned, spilled-to |
| `rv32.image` | `Uint8Array` as base64, entries, cover map | fn, insn (offset) | contains |

Correspondence records connect them. Instructions in vcode correspond to the statements and values they cover, and statements correspond to front-end ops. CW's `p.lines(insn)` and `p.lineage(v)` then become generic queries over correspondence (§9).

## 2. Defining the main IR: `typed.blocks`

### 2.1 Native format and kind

```ts
// typed-blocks/ir.ts
export type ValueOp =
  | 'const' | 'get' | 'add' | 'sub' | 'mul' | 'div' | 'rem' | 'and' | 'or' | 'xor'
  | 'shl' | 'shr' | 'shru' | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' | 'ltu' | 'geu'
  | 'eqz' | 'load' | 'load16u' | 'call';
export type StmtOp = 'set' | 'store' | 'eval' | 'br' | 'br_if' | 'return' | 'trap';

export interface Value { op: ValueOp; args: string[]; imm?: number }           // ids like v:blend.12
export interface Stmt {
  op: StmtOp; local?: number; value?: string; cond?: string; addr?: string;
  to?: string; then?: string; else?: string; width?: 1 | 2 | 4; offset?: number;
}
export interface Block { stmts: string[] }                                      // successors derived from the last stmt
export interface Fn { params: string[]; result: string; locals: { name: string; type: string }[]; blocks: string[] }
export interface TypedBlocks {
  fns: Record<string, Fn>;                        // fn:blend
  blocks: Record<string, Block>;                  // bb:blend.3
  stmts: Record<string, Stmt>;                    // s:blend.7
  values: Record<string, Value>;                  // v:blend.12
}

export const BlocksIR = defineIR<TypedBlocks>({                                  // v6 (contracts)
  id: 'typed.blocks', version: '1',
  description: 'Functions as blocks of statements over pure value trees, lifted from Typed stack code',
  validate: validateBlocks,                     // ids resolve, trees are acyclic, every block ends in a terminator
});
```

CW's readable ids become the entity ids unchanged (`s:blend.7`). v6's `IRRef` adds `{artifact, revision}`, so `insn:blend+0x1c@r6` is simply the display form of an exact reference.

### 2.2 The adapter: a projection v6's generic machinery can query, match and edit

```ts
export const blocksAdapter = defineAdapter<TypedBlocks>({                       // v6
  id: 'adapter.typed-blocks', version: '1', kind: BlocksIR.id, schemaVersion: BlocksIR.version,
  description: 'Functions, blocks, statements and value trees with typed control and data edges',
  relationKinds: {
    contains: 'containment',      // fn → block (ordered), block → stmt (ordered)
    operand: 'dependency',        // value → value (ordered)
    uses: 'dependency',           // stmt → value, attributes.field = 'value' | 'cond' | 'addr'
    reads: 'dependency',          // value(get) → local
    writes: 'binding',            // stmt(set) → local
    succ: 'control',              // NEW category: block → block, attributes.edge = 'to' | 'then' | 'else'
  },
  entities: v => [
    ...Object.keys(v.fns).map(id => entity(id, 'fn')),
    ...Object.keys(v.blocks).map(id => entity(id, 'block')),
    ...Object.entries(v.stmts).map(([id, s]) => entity(id, `stmt.${s.op}`, stmtAttrs(s))),
    ...Object.entries(v.values).map(([id, x]) => entity(id, `value.${x.op}`, x.imm === undefined ? {} : { imm: x.imm })),
    ...localsOf(v).map(l => entity(l.id, 'local', { name: l.name, type: l.type })),   // local:blend/s
  ],
  relations: blocksRelations,           // edge ids are position-based (v6 §9.2), so redirects keep identity
  resolve: (v, id) => resolveEntity(v, id),
  describe: (v, id) => ({ label: textOf(v, id) }),                                // "s = s + (work[i] * inv)"
  roots: v => Object.keys(v.fns),
  validate: validateBlocks,
  rebuild: rebuildBlocks,               // logical graph → native tables; rejects anything it cannot represent
  operation: (v, id) => v.values[id]
    ? { name: v.values[id].op, operands: v.values[id].args } : undefined,         // lets op('add', …) patterns match
  serialize: v => JSON.stringify(v),
  deserialize: s => parseBlocks(s),
  visualize: (v, sel) => ({ kind: 'cfg', data: cfgView(v, sel) }),              // the CFG view
});
```

This is the same shape as v6's expression arena adapter (`src/ir-examples/expressions.ts`), with more kinds. Everything generic now works on Typed programs: `walk`, `dependencies(v)`, `subgraph`, `find`, `diff`, pattern matching and edit transactions. The only addition is the `control` relation category (§10, E1).

## 3. Lowering passes are compiler tasks

The reused front end and the backend stages are ordinary v6 passes. They take inputs only through `ctx.read`/`ctx.require`, so the v6 runtime records dependencies and can explain cache hits: editing one `.typed` file re-runs only what depends on it.

```ts
compiler.registerKind(kindOf(BlocksIR, blocksAdapter));                         // v6 (Registry port)

compiler.register<{ project: string }, Tape>({                                  // v6
  id: 'typed.frontend', version: TYPED_FRONTEND_VERSION, kind: 'typed.tape',    // pinned ds-js-os commit
  description: 'Parse and type-check the project; stack code with source spans (reused front end)',
  run(ctx, { project }) {
    const files = ctx.read<Record<string, string>>(`project/${project}/files`);
    const order = ctx.read<string[]>(`project/${project}/sources`);
    const r = typedFrontEnd.compile(concat(files, order));                      // reused, unchanged
    if (r.error) throw new FrontEndError(r.error);                              // explicit failure, not a value
    return r.tape;
  },
});

compiler.register<{ project: string }, TypedBlocks>({                           // v6
  id: 'typed.lift', version: '1', kind: 'typed.blocks',
  description: 'Lift stack code into blocks of statements over value trees (revision r0)',
  async run(ctx, { project }) {
    const tape = await ctx.require<Tape>(task(`tape/${project}`, 'typed.frontend', { project }));
    const { blocks, origins } = lift(tape.value);                               // domain code from CW store.js
    for (const [entityId, opIds] of origins)                                     // op:blend#5 → s:blend.7
      ctx.derive(tape, { from: opIds, to: [entityId], relation: 'lifted-from' }); // v6: explicit correspondence
    ctx.metric('statements', Object.keys(blocks.stmts).length);
    return blocks;
  },
});
```

Instruction selection, register allocation and encoding are three more passes of exactly this shape (§8). The CW prototype keeps image building out of the pass manager. Here it is ordinary compilation, with cached tasks and correspondence.

## 4. Analyses: CW's dataflow on v6's analysis manager

CW has a worklist solver over lattices with widening and six built-in analyses. v6 has an `AnalysisManager` that caches results per exact revision and invalidates them, but no dataflow solver. The extension is a builder that turns a lattice and a transfer function into a v6 analysis definition (E4).

```ts
export const liveness = dataflow<TypedBlocks>({                                 // NEW: compiles to defineAnalysis
  id: 'typed.liveness', version: '1', direction: 'backward',
  about: 'locals live into and out of each block, and after each statement',
  over: BlocksIR, perFunction: true,
  lattice: lattice.set<number>(),                                               // NEW: set · flat · interval · map
  transfer: (block, out) => {
    const live = new Set(out);
    for (const s of [...block.stmts()].reverse()) {
      if (s.op === 'set') live.delete(s.local!);
      for (const l of s.readsLocals()) live.add(l);
    }
    return live;
  },
  reads: ['stmt.*', 'value.*', 'succ'],   // entity and relation kinds whose change can invalidate it
});

export const ranges = dataflow<TypedBlocks>({                                    // NEW
  id: 'typed.ranges', version: '1', direction: 'forward', over: BlocksIR, perFunction: true,
  lattice: lattice.map(lattice.interval()),
  widen: (old, next) => widenAtLoopHeads(old, next),                            // CW: refused without it (noWidening)
  transfer: (block, inn) => rangesTransfer(block, inn),
  reads: ['stmt.*', 'value.*', 'succ'],
});
```

**Facts that survive a pass.** CW keeps a fact fresh across a pass that `preserves` it, but nothing checks the claim. On v6 the claim becomes *checked transfer*. The transaction's `ChangeSet` (v6 `diff`) lists exactly which entity and relation kinds changed. If none of them matches the analysis's `reads`, the manager transfers the fact to the new revision and records why. Otherwise it recomputes. Declaring `preserves` turns into an assertion that gets checked (§5.2).

## 5. Optimization passes

### 5.1 Declarative rules: fold and simplify as v6 patterns

Small local rewrites are v6 rewrite rules. They get match evidence for free in the **Pattern & match** view.

```ts
const constant = (name: string) => capture(name, entity('value.const'));         // v6 patterns
const pow2 = where({ id: 'typed.imm.pow2', version: '1' });                      // v6: registered predicate

export const addZero = rewrite<TypedBlocks>({                                    // v6
  id: 'typed.simplify.add-zero', version: '1', description: 'x + 0 → x',
  match: pattern(capture('sum', op('add', capture('x'), constant('zero'))))
    .where(attrEquals('zero', 'imm', 0)),                                        // NEW tiny helper, or a predicate
  replace({ bindings: { sum, x, zero } }, edit) {
    edit.redirectReferences(sum, x);                                             // v6
    edit.remove(sum, { because: [zero] });                                       // NEW: because on edits (E2)
    edit.correspond([sum], x, 'simplified');                                     // v6
  },
  preserves: [{ id: 'typed.agrees-with-r0', version: '1' }],                     // a claim; checked by the gate (§6)
});

export const mulPow2 = rewrite<TypedBlocks>({                                    // v6
  id: 'typed.simplify.mul-pow2', version: '1', description: 'x * 2^k → x << k',
  match: pattern(capture('m', op('mul', capture('x'), constant('k')))).where(pow2),
  replace({ bindings: { m, x, k } }, edit, view) {
    const shift = edit.insert(entity(`${m.entity}/shl`, 'value.const', { imm: log2(view.resolve(k).attributes.imm as number) }));
    edit.replace(m, entity(m.entity, 'value.shl'));                              // keeps m's identity
    rewireOperands(edit, m, [x, shift]);                                         // ordered operand edges
    edit.correspond(m, m, 'strength', { because: [k] });                         // NEW: because on correspond
  },
});

export const fold = rewrite<TypedBlocks>({                                       // v6
  id: 'typed.fold', version: '1', description: 'an operator whose operands are constants becomes a constant',
  match: pattern(capture('v', op(anyOf(FOLDABLE), constant('a'), constant('b'))))
    .where(notTrapping('v', 'a', 'b')),       // CW: keep div/rem by 0 and INT_MIN / -1, so the trap survives
  replace: ({ bindings: { v, a, b } }, edit, view) =>                           // v6 replace; `because` is NEW (E2)
    edit.replace(v, entity(v.entity, 'value.const', { imm: binop(view, v, a, b) }), { because: [a, b] }),
});

// v6 schedules decide how the rules are applied; budgets and cycles are explicit outcomes
const simplified = await saturate(view, [fold, addZero, mulPow2], { budget: 256, verify: gate });  // v6
```

### 5.2 Imperative passes that need facts: licm and bce

Passes that walk loops or dominator trees should stay imperative code. `definePass` (E3) keeps CW's ergonomic shape, `needs` / `writes` / `preserves` / `run(fn, tx, facts)`, and compiles it to the v6 pieces that `ir-examples/lab.ts` currently wires up by hand:

- a compiler `Pass`
- a `PassPolicy` that opens a semantic transaction
- an `IREdit` scoped to one function
- correspondence and acceptance

```ts
export const licm = definePass({                                                // NEW (E3)
  id: 'typed.licm', version: '1', over: blocksAdapter,
  about: 'loop-invariant code motion: pure expressions whose operands the loop never assigns move to the preheader',
  needs: { loops },                                                             // a v6 analysis, here a dataflow one
  writes: ['stmt', 'value', 'local', 'block', 'succ'],                          // checked against the ChangeSet
  preserves: [],                                                                // nothing: licm changes the CFG
  contract: optimizationContract,                                               // §6: what must hold to accept
  run(fn, tx, { loops }) {
    for (const L of loops) {
      const pre = L.preheader ?? tx.makePreheader(L, { because: [L.id] });       // NEW helper on the domain tx
      const assigned = new Set(L.assigned);
      const invariant = (v: ValueH): boolean =>
        v.isPure && !v.mayTrap && (v.op !== 'get' || !assigned.has(v.imm!)) && v.args.every(invariant);
      for (const s of L.statements()) for (const field of ['value', 'cond', 'addr'] as const) {
        const v = s[field]; if (!v) continue;
        tx.rewriteTree(v, x => {                                                 // bottom-up over the value tree
          if (x.op === 'const' || x.op === 'get' || !invariant(x)) return;
          const t = tx.local('inv', { because: [L.id] });
          const set = tx.insert(tx.at.end(pre), tx.set(t, x, { because: [L.id], note: `hoisted out of ${L.id}` }));
          return tx.get(t, { from: x, because: [set] });                         // origin: x; valid because: set
        }, { because: [L.id] });
      }
    }
  },
});
```

`tx` here is a thin domain facade over v6's `IREdit`. `tx.set`, `tx.local`, `tx.at.end` and `tx.rewriteTree` turn into `insert` / `connect` / `redirectReferences` / `correspond` on the logical graph, and `blocksAdapter.rebuild` turns the result back into native tables. Two v6 properties come with it:

- **Stale-head rejection.** An agent edit that started from r3 cannot publish over an r4 made meanwhile.
- **Projection check.** If the adapter cannot represent an edit, the transaction fails. It is never silently dropped.

`bce` is the clearest example of why `because` matters. It removes a bounds check because of a dominating branch and a range fact:

```ts
export const bce = definePass({                                                 // NEW (E3)
  id: 'typed.bce', version: '1', over: blocksAdapter,
  about: 'a check i >=u buf.length goes when a dominating branch proved i < buf.length and ranges prove i ≥ 0',
  needs: { dom: dominators, reach: reaching, ranges },
  writes: ['stmt', 'succ'],
  contract: optimizationContract,
  run(fn, tx, { dom, reach, ranges }) {
    for (const check of fn.boundsChecks()) {                                    // br_if (i >=u len) → trap block
      const proof = dom.ancestors(check.block)
        .map(d => provesBelowLength(d.terminator, check, reach))                 // same i and buf by reaching defs
        .find(Boolean);
      if (!proof || ranges.at(proof.branch, check.index)[0] < 0) continue;
      tx.replaceStmt(check.stmt, { op: 'br', to: check.inBounds }, {
        because: [proof.branch.id, ranges.factRef(proof.branch, check.index)], // fact:ranges(peak)@r5 …
        note: `${proof.branch.id} already proved ${check.indexName} < length`,
      });
    }
  },
});
```

After this pass, `p.why('s:peak.9')` shows the branch and the exact fact revision that justified the removal. The fact itself has an id and a revision (v6), so if `ranges` is later recomputed differently, that history is still exact.

## 6. Meaning: contracts whose checker is differential testing

CW's central guarantee is that after every pass the program still agrees with r0 on generated inputs (result, trap and memory). The guarantee is also checked against the machine code on the emulator and against the reference compiler. In v6 terms these are **invariants** inside a **transformation contract**. The extension is a checker factory and a `sampled` assurance level (E5).

```ts
export const agreesWithR0 = differential<TypedBlocks>({                         // NEW (E5): returns a v6 invariant
  id: 'typed.agrees-with-r0', version: '1',
  description: 'result, trap and memory agree with r0 on generated cases',
  inputs: { origin: BlocksIR, candidate: BlocksIR },                             // origin is r0, not the previous rev
  cases: (fn, project) => generateCases(fn.signature, project.inputs, { count: 100, seed: 1 }),
  run: (ir, fn, args) => evaluate(ir, fn, args, { stepLimit: 100_000 }),       // CW evaluator.js: the meaning
  compare: (a, b) => sameResult(a, b) && sameTrap(a, b) && sameMemory(a, b),
  inconclusive: r => r.hitStepLimit,                                             // counted, never a verdict
});

export const optimizationContract = defineTransformation({                      // v6
  id: 'typed.optimization', version: '1',
  description: 'An optimization over typed.blocks is accepted only if it still agrees with r0',
  inputs: { input: BlocksIR, origin: BlocksIR }, outputs: { output: BlocksIR },
  requires: [{ property: blocksValid, subject: { from: 'inputs', port: 'input' } }],
  preserves: [{ property: blocksValid, from: 'input', to: 'output', mode: 'check' }],
  ensures: [{ invariant: agreesWithR0, bindings: {
    origin: { from: 'inputs', port: 'origin' }, candidate: { from: 'outputs', port: 'output' } } }],
  correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit' }],
});

// backend stages get their own contracts, with the same machinery:
export const imageAgreesWithBlocks = differential({ id: 'rv32.image-agrees', /* emulator(image) vs evaluate(blocks) */ });
export const blocksAgreeWithReference = differential({ id: 'typed.r0-agrees-with-reference', /* evaluate(r0) vs emulator(reference image) */ });
```

Evidence then reads like CW's Checks view, labelled with v6's assurance vocabulary: **checked-sampled** with 100 cases (seed 1, 98 agree, 2 inconclusive). This is distinct from **checked-exact**, which is what v6's polynomial checker gives, and from **declared**. The deliberately wrong `div-to-shift` pass from CW then fails its `ensures` clause with a counterexample. The pass is rejected and the revision is not published, which is the correct, inspectable outcome.

## 7. Strategy: O2 as data, with alternatives CW cannot express today

Every pass becomes a versioned strategy algorithm, automatically (E6). CW's pipelines become v6 plans.

```ts
const pass = (id: string) => apply(`o2/${id}`, algorithm(`typed.${id}`), { args: { fn: ref('binding', [], 'fn') } }); // v6

export const O2 = plan('typed.O2', sequence('o2',                                // v6 builders
  pass('cfg'),
  repeatUntilStable('o2/local', sequence('o2/local/body', pass('fold'), pass('simplify'), pass('constprop'), pass('dce')),
    { maxIterations: 8 }),                    // CW's repeat('unchanged'); a cycle or exhausted budget is an outcome
  pass('licm'),
  attempt('o2/bce', pass('bce'), sequence('o2/bce-skip'), { codes: ['unsupported'] }),
  checkpoint('o2/done', 'O2 accepted'),
), 'CW O2: cfg, local cleanup to a fixed point, licm, bce');
```

Two decisions CW currently makes by hand, or in project scripts, become strategy data:

```ts
// Which pass order wins? (CW project "orders"): a fork of orders, choose the smallest image that still agrees.
const orders = chooseBest('orders/choose',                                       // v6
  fork('orders/fork', [
    { name: 'licm-first',  strategy: sequence('a', pass('licm'), pass('constprop'), pass('dce'), compile()) },
    { name: 'fold-first',  strategy: sequence('b', pass('constprop'), pass('licm'), pass('dce'), compile()) },
  ], { concurrency: 2 }),
  { metric: 'bytes', direction: 'min' },
  { metrics: algorithm('rv32.image-metrics'), constraints: [{ metric: 'agree', op: '==', value: 1 }],
    decisionAs: 'order-selection' });

// Register-allocation options (CW asmDiff experiments): instructions run, under a register budget.
const regalloc = chooseBest('ra/choose',
  fork('ra/fork', ['caller', 'callee'].flatMap(order => ['furthest', 'current'].map(spill => ({
    name: `${order}/${spill}`, strategy: compile({ registers: 4, order, spill }),
  })))),
  { metric: 'instructionsRun', direction: 'min' },
  { metrics: algorithm('rv32.heat-metrics'), constraints: [{ metric: 'agree', op: '==', value: 1 }] });
```

The **Strategy trace** view then shows every candidate, its metrics, which were infeasible, and why the winner won. This is the "why was this chosen?" evidence that v6 already produces for the mesh lab.

## 8. Backend: lowering with correspondence, and selection as tiling

Instruction selection is a lowering pass from `typed.blocks` to `rv32.vcode`. Every emitted instruction records which statement and value it covers. This is exactly CW's "instructions cover statements", expressed as v6 correspondence.

```ts
compiler.register<{ project: string; rev: string; opts: SelectOptions }, VCode>({ // v6
  id: 'rv32.select', version: '1', kind: 'rv32.vcode',
  description: 'Tile value trees into RV32IM on virtual registers',
  async run(ctx, { project, rev, opts }) {
    const blocks = await ctx.require<TypedBlocks>(revisionTask(project, rev));   // the exact optimized revision
    const vcode = tile(openIR(blocks, blocksAdapter), RV32_TILES, opts);          // NEW schedule (E7)
    for (const insn of vcode.insns)
      ctx.derive(blocks, { from: insn.covers, to: [insn.id], relation: 'covers' }); // v6
    return vcode;
  },
});

// Tiles are v6 patterns with a cost. A tiling schedule chooses a minimum-cost cover bottom-up (maximal munch first).
export const RV32_TILES = [
  tileRule({ name: 'addi', cost: 1,                                              // NEW (E7) over v6 patterns
    match: op('add', capture('a'), capture('k', entity('value.const'))), when: fitsImm12('k'),
    emit: ({ a, k }, out) => out.insn('addi', out.reg(), out.use(a), imm(k)) }),
  tileRule({ name: 'add', cost: 1, match: op('add', capture('a'), capture('b')),
    emit: ({ a, b }, out) => out.insn('add', out.reg(), out.use(a), out.use(b)) }),
  tileRule({ name: 'lw-offset', cost: 1,                                         // fuse: load(base + k)
    match: op('load', op('add', capture('base'), capture('k', entity('value.const')))), when: fitsImm12('k'),
    emit: ({ base, k }, out) => out.insn('lw', out.reg(), out.use(base), imm(k)) }),
  tileRule({ name: 'div-magic', cost: 4, match: op('div', capture('x'), capture('d', entity('value.const'))),
    when: options('divmagic'), emit: ({ x, d }, out) => emitMagicDivision(out, x, d) }), // reused magic numbers
  // … the rest of CW backend.js select(), one rule per tile
];
```

Register allocation (`rv32.regalloc`: linear scan, callee-saved for values live across calls, frames) and encoding (`rv32.encode`: the reused encoders) are two more passes of the same shape. Their outputs are artifacts with correspondence back to vcode. Their contracts are `imageAgreesWithBlocks` plus the calling-convention checks that the reused emulator already makes at every call and return.

## 9. The workbench API on top

CW's `wb` API stays the user and agent surface. It becomes a thin layer of handles over v6 views, queries and records, which keeps all 44 projects' scripts working:

| CW call | Implemented with |
| --- | --- |
| `wb.projects.open('blend').program` | Run `typed.lift` on the project's files and open a `IRView<TypedBlocks>` at r0 |
| `p.apply('licm')`, `p.pipeline('O2')` | Run the `definePass` task or `execute(O2, …)`; each accepted pass publishes one revision |
| `p.undo()`, `p.checkout('r2')` | Move the program's head to an earlier artifact revision; revisions stay immutable |
| `p.why(id)` | Follow `because` edges from the transaction records (E2) |
| `p.lineage(id)`, `p.lines(insn)` | Compose correspondence across revisions and artifacts: `covers` → stmt → `lifted-from` → op → line (v6 `composeCorrespondence`) |
| `p.facts()`, `fn.fact('ranges')` | `AnalysisManager` queries for this exact revision, with fresh, transferred or stale status |
| `p.check()` | Run the `agreesWithR0` invariant standalone (v6 analyses work without a compiler) |
| `f.values().op('mul').count()` | Selections over `view.find` / `walk` with typed handles (E8) |
| `wb.pass('add-self')…` builder | Sugar for `definePass` or `rewrite` |

The `my-first-pass` project, as a user would write it in a project script on the new framework:

```js
// scripts/add-self.js: a pass written in the console or by the agent
const addSelf = wb.rewrite({                                                    // NEW sugar over v6 rewrite()
  id: 'user.add-self', about: 'x + x, for a pure x, becomes x * 2',
  match: pattern(capture('sum', op('add', capture('x'), sameAs('x')))).where(isPure('x')),   // v6 patterns
  replace: ({ sum, x }, edit) => edit.toOp(sum, 'mul', [x, edit.const(2)], { because: [x] }),
});
const r = p.apply(addSelf);     // gated by optimizationContract, so a wrong rule is rejected with a counterexample
return { rev: r.rev, edits: r.edits, why: p.why(r.changed[0]) };
```

## 10. Extensions to v6 this requires

| # | Extension | Where | Why (from CW) |
| --- | --- | --- | --- |
| E1 | A `control` relation category | `ir/types.ts` | CFG successor edges are neither containment nor data dependency |
| E2 | `because` on edits and on correspondence, plus a `why()` query | `ir/transactions`, `ir/correspondence` | CW separates *made from* (origin) from *valid because*; v6 has only the former |
| E3 | `definePass`: per-function passes with `needs` / `writes` / `preserves`, compiled to Pass, PassPolicy, contract transaction and IREdit | New layer over core, contracts and ir | Removes the hand wiring in `ir-examples/lab.ts`; declared writes are checked against the ChangeSet |
| E4 | `dataflow()` builder and lattices (set, flat, interval with widening, map); checked transfer from `reads` × ChangeSet | New, on `defineAnalysis` | CW's analyses; turns CW's `preserves` from a claim into a check |
| E5 | `differential()` invariant factory, case generation, `inconclusive`, and a `checked-sampled` assurance label | contracts | CW's three baselines; v6 knows only exact checkers |
| E6 | Passes and analyses registered as strategy algorithms automatically | strategy ↔ core bridge | lab.ts writes this bridge by hand |
| E7 | A tiling schedule (minimum-cost cover) using v6 patterns | `ir/rewrites` sibling | Instruction selection; v6 schedules rewrite, they do not choose covers |
| E8 | Readable-id handles and lazy selections over `IRView` | API layer | CW's handle proxies with did-you-mean errors |
| E9 | Linear revision UX (r0…rN, undo, checkout) over immutable artifacts | API layer | CW's timeline; v6 already keeps every revision |

None of these change v6's guarantees. Each one is either a new layer on top (E3, E4, E5, E6, E8, E9) or a small widening of an existing type (E1, E2, E7).

**What stays domain code**, ported from CW:

- lifting
- the evaluator
- case generation
- the analyses' transfer functions
- the passes' bodies
- tile rules, linear scan and frames

**Reused unchanged from ds-js-os:** the front end, encoders, disassembler, division magic and emulator.

## 11. What this buys over the CW prototype

- **Every stage is an artifact** with exact identity, cached and explained. Editing one `.typed` file re-lifts only what changed, and the explanation says why.
- **Provenance spans the whole compiler.** It follows a line from source op → statement → revision → instruction → image byte, and can be followed in both directions.
- **Preserved facts are checked, not trusted.**
- **Pass orders and backend options are data.** They are searchable alternatives with recorded selection evidence.
- **The same kernel can host a second domain** (v6 expressions or constraints) without touching the compiler code. That is the proof that the framework, rather than the Typed compiler, is what was built.
