/**
 * The built-in optimization passes over `typed.blocks`, defined with the framework's `definePass` (E3).
 *
 * Each pass body is Compiler Workbench's (passes.js), run once per function through a `Tx` on a working copy of
 * the input revision. The framework computes the declared analyses for the exact input, diffs the result against
 * the input, enforces the declared entity kinds, checks the contract the host supplies (normally
 * `optimizationContract`: the program still means what r0 meant), and checks each preservation claim before the
 * new revision is published. Correspondence between the revisions comes from the origin records the transaction
 * wrote and from the `because` of each removal, so `why` can walk any entity back to the front end.
 */
import { defineTransformation } from '../framework/contracts/definitions.js';
import type { TransformationDefinition } from '../framework/contracts/types.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import { definePass, type Pass } from '../framework/passes/define-pass.js';
import type { DataflowResult } from '../framework/dataflow/analysis.js';
import {
  ANALYSES,
  domView,
  hasEffect,
  isPure,
  liveView,
  rangeView,
  reachView,
  readsOf,
  stmtValues,
  type Dominators,
  type DomView,
  type LiveView,
  type Loop,
  type RangeView,
  type ReachView,
} from './analyses.js';
import { F32_OPERANDS, F32_RESULT } from './f32.js';
import { BlocksIR, blocksAdapter, blocksEntities, entityIdSet } from './ir.js';
import { hash, meaningKept, type MeaningParams } from './evaluate.js';
import { tableBody } from './rules/compile.js';
import { FOLD_RULES } from './rules/fold.js';
import { BITWISE_RULES } from './rules/bitwise.js';
import { REASSOC_RULES } from './rules/reassoc.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import {
  Store,
  typeClass,
  type BlockRec,
  type StmtRec,
  type TypedBlocks,
  type ValueRec,
  type WorkFn,
} from './model.js';
import { Tx, TxError, type Edit, type ValueHandle, type WriteKind } from './tx.js';
import { rotateSpec } from './rotate.js';
import { makeInline } from './inline.js';

type AnalysisName = keyof typeof ANALYSES;
interface FactViews {
  cfg?: unknown;
  dom?: DomView;
  loops?: readonly Loop[];
  live?: LiveView;
  reach?: ReachView;
  ranges?: RangeView;
  [alias: string]: unknown;
}
interface BodyContext {
  readonly st: Store;
  readonly f: WorkFn;
  readonly tx: Tx;
  readonly facts: FactViews;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TypedPassSpec {
  readonly name: string;
  readonly about: string;
  readonly needs?: Readonly<Record<string, AnalysisName>>;
  readonly writes: readonly WriteKind[];
  readonly preserves?: readonly AnalysisName[];
  body(ctx: BodyContext): void;
  /** A pass over the whole program (it removes functions), not per function: never restricted to one function. */
  readonly program?: true;
}

/** Compiler Workbench write kinds -> the entity and relation kinds of the projection they may change. */
const ENTITY_WRITES: Record<WriteKind, { entities: string[]; relations: string[] }> = {
  values: { entities: ['value.*'], relations: ['operand', 'reads', 'uses'] },
  stmts: {
    entities: ['stmt.*', 'value.*'],
    relations: ['contains', 'uses', 'operand', 'reads', 'writes', 'jump'],
  },
  locals: { entities: ['local'], relations: ['declares'] },
  cfg: {
    entities: ['block', 'stmt.*', 'value.*'],
    relations: ['succ', 'jump', 'contains', 'uses', 'operand', 'reads'],
  },
};

export interface RevisionReport {
  readonly pass: string;
  readonly rev: number;
  readonly edits: readonly Edit[];
  readonly fns: readonly string[];
  readonly kinds: Readonly<Record<string, number>>;
}

const view = (name: AnalysisName, value: unknown, st: Store, fname: string): unknown => {
  switch (name) {
    case 'liveness':
      return liveView(value as DataflowResult, st, fname);
    case 'reaching':
      return reachView(value as DataflowResult, st, fname);
    case 'ranges':
      return rangeView(value as DataflowResult, st, fname);
    case 'dominators':
      return domView((value as Record<string, Dominators>)[fname]);
    default:
      return (value as Record<string, unknown>)[fname];
  }
};

/** Correspondence entries from origins of new entities and the reasons of removals. */
export function revisionCorrespondence(
  before: TypedBlocks,
  after: TypedBlocks,
  edits: readonly Edit[],
): CorrespondenceEntry[] {
  const src = entityIdSet(before),
    dst = entityIdSet(after);
  const groups = new Map<
    string,
    { to: Set<string>; because: Set<string>; notes: string[]; relation: string }
  >();
  const group = (from: string, relation: string) => {
    let g = groups.get(from);
    if (!g)
      groups.set(
        from,
        (g = { to: new Set(dst.has(from) ? [from] : []), because: new Set(), notes: [], relation }),
      );
    return g;
  };
  for (const table of [after.values, after.stmts, after.blocks] as const)
    for (const e of Object.values(table) as (ValueRec | StmtRec | BlockRec)[]) {
      if (src.has(e.id)) continue;
      const o = e.origin[0];
      if (!o || !o.from || !src.has(o.from)) continue;
      const g = group(o.from, o.via);
      g.to.add(e.id);
      for (const b of o.because ?? []) g.because.add(b);
      if (o.note) g.notes.push(o.note);
    }
  for (const e of edits)
    if (e.kind === 'remove' && src.has(e.stmt as string) && !dst.has(e.stmt as string)) {
      const g = group(e.stmt as string, e.pass);
      for (const b of (e.because as string[]) ?? []) g.because.add(b);
      if (e.note) g.notes.push(e.note as string);
    }
  return [...groups].map(([from, g]) => ({
    from: [from],
    to: [...g.to].sort(),
    relation: g.to.size ? g.relation : 'removed',
    ...(g.because.size ? { because: [...g.because].sort() } : {}),
    ...(g.notes.length ? { note: [...new Set(g.notes)].join(' > ') } : {}),
  }));
}

export type TypedPass = Pass<TypedBlocks, Record<string, any>, Record<string, unknown>> & {
  readonly typed: TypedPassSpec;
};

export function typedPass(spec: TypedPassSpec): TypedPass {
  const needs = Object.fromEntries(
    Object.entries(spec.needs ?? {}).map(([alias, name]) => [alias, ANALYSES[name]]),
  );
  const writes = { entities: new Set<string>(), relations: new Set<string>() };
  for (const k of spec.writes) {
    ENTITY_WRITES[k].entities.forEach(e => writes.entities.add(e));
    ENTITY_WRITES[k].relations.forEach(r => writes.relations.add(r));
  }
  const pass = definePass<TypedBlocks, Record<string, any>, Record<string, unknown>>({
    id: `typed.${spec.name}`,
    version: '1',
    description: spec.about,
    ir: BlocksIR,
    adapter: blocksAdapter,
    needs,
    writes: { entities: [...writes.entities], relations: [...writes.relations] },
    preserves: (spec.preserves ?? []).map(n => ANALYSES[n]),
    run({ before, facts, params }) {
      const st = Store.from(before.value),
        rev = before.value.rev + 1;
      const edits: Edit[] = [],
        touched: string[] = [];
      for (const f of st.fns.values()) {
        const views: FactViews = {};
        for (const [alias, name] of Object.entries(spec.needs ?? {}))
          views[alias] = view(name, facts[alias], st, f.name);
        const tx = new Tx(st, f, { name: spec.name, writes: spec.writes }, rev);
        spec.body({ st, f, tx, facts: views, params: (params ?? {}) as Record<string, unknown> });
        tx.commit();
        if (tx.edits.length) {
          edits.push(...tx.edits);
          touched.push(f.name);
        }
      }
      if (!edits.length) return;
      st.rev = rev;
      const native = st.toNative();
      const kinds = edits.reduce<Record<string, number>>(
        (m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m),
        {},
      );
      const report: RevisionReport = { pass: spec.name, rev, edits, fns: touched, kinds };
      return {
        native,
        correspondence: revisionCorrespondence(before.value, native, edits),
        edits: edits.length,
        report,
      };
    },
  });
  return Object.freeze({ ...pass, typed: spec }) as TypedPass;
}

const contracts = new Map<string, TransformationDefinition<any, any>>();
/** The gate every optimization passes: the output still agrees with the origin (r0) on generated cases. */
export function optimizationContract(params: MeaningParams = {}): TransformationDefinition<any, any> {
  const check = meaningKept(params);
  let c = contracts.get(check.version);
  if (!c) {
    c = defineTransformation({
      id: 'typed.optimization',
      version: check.version,
      description: 'an optimization keeps the meaning of the original program',
      inputs: { input: BlocksIR, origin: BlocksIR },
      outputs: { output: BlocksIR },
      ensures: [
        {
          invariant: check,
          bindings: {
            origin: { from: 'inputs', port: 'origin' },
            candidate: { from: 'outputs', port: 'output' },
          },
        },
      ],
    });
    contracts.set(check.version, c);
  }
  return c;
}

// ---------- the passes ----------
const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
const log2 = (n: number) => 31 - Math.clz32(n);
const lastStmt = (st: Store, b: BlockRec) =>
  b.stmts.length ? (st.get(b.stmts.at(-1)!) as StmtRec) : undefined;

/**
 * Folding is i32 arithmetic (Compiler Workbench's rules), plus the f32 operators in `F32_FOLDABLE`, evaluated on
 * bits exactly as the target computes them (f32.ts): rounded to nearest even, which is the rule the target applies
 * statically, so a folded constant is the value the program would compute. Operators that round in another direction
 * (floor, ceil, trunc, the saturating conversions) are not folded.
 *
 * The cases are the rule table FOLD_RULES (rules/fold.ts), one rule per operator, compiled into the rewrite visitor
 * (IRWB-006). The hand-written body it replaced is kept in rules/handwritten.ts; on the corpus (every pipeline) and
 * on Candela's O2 both give identical revisions, edit lists and correspondences.
 */
export const fold = typedPass({
  name: 'fold',
  about: 'constant folding: an operator whose operands are constants becomes a constant',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops', 'liveness', 'reaching'],
  body: tableBody(FOLD_RULES.rules),
});

/**
 * The identities are i32 identities. None holds for f32 (x + 0 is not x for x = -0; x * 0 is not 0 for NaN or ∞;
 * x - x is not 0 for ∞; !(a < b) is not a >= b for NaN), so f32 operators are left alone; their own names keep
 * them out of the rules.
 *
 * The identities are the rule table SIMPLIFY_RULES (rules/simplify.ts), each rule verified once for all inputs
 * (rules/verify.ts, rules/evidence.ts), compiled into the rewrite visitor (IRWB-006). The hand-written body it
 * replaced is kept in rules/handwritten.ts; both give identical revisions on the corpus and on Candela's O2.
 */
export const simplify = typedPass({
  name: 'simplify',
  about: 'algebraic identities: x+0, x*1, x*2^k, x-x, !!x and inverted comparisons',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body: tableBody(SIMPLIFY_RULES.rules),
});

/**
 * IRWB-037-F: the rule table REASSOC_RULES (rules/reassoc.ts), each rule proved by the verifier: constants move
 * outwards, where the backend folds them into an address offset. Placed after the substitutions that build the
 * trees it matches (bcm's `caddr(r, p + Δ) - 2Δ` after subst).
 */
export const reassoc = typedPass({
  name: 'reassoc',
  about:
    'reassociation: constants move outwards, (x+a)+b → x+(a+b), (x+a)<<k → (x<<k)+(a<<k), y+(x+c) → (y+x)+c',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body: tableBody(REASSOC_RULES.rules),
});

/** IRWB-037-F: the rule table BITWISE_RULES (rules/bitwise.ts): choice and majority with one operator fewer. */
export const bitwise = typedPass({
  name: 'bitwise',
  about: 'bitwise identities: (x & y) ^ (~x & z) and (x & y) ^ (x & z) ^ (y & z) with one operator fewer',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body: tableBody(BITWISE_RULES.rules),
});

export const constprop = typedPass({
  name: 'constprop',
  about:
    'constant propagation: a read whose reaching definitions all assign the same constant becomes that constant',
  needs: { reach: 'reaching' },
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx, facts }) {
    const reach = facts.reach!;
    for (const b of f.blocks)
      tx.rewrite(
        v => {
          if (v.op !== 'get') return;
          const sid = v.statement;
          if (!sid) return;
          const defs = reach.reachingAt(sid, v.imm as number);
          if (!defs.length) return;
          const consts = defs.map(d =>
            d.startsWith('init:')
              ? 0
              : d.startsWith('param:')
                ? null
                : (st.get((st.get(d) as StmtRec).value!) as ValueRec).op === 'const'
                  ? ((st.get((st.get(d) as StmtRec).value!) as ValueRec).imm as number)
                  : null,
          );
          if (consts.some(c => c === null) || new Set(consts).size !== 1) return;
          const real = defs.filter(d => !d.startsWith('init:'));
          // the constant has the local's type: an f32 local's constant is its bits (+0 for a local's initial 0)
          return tx.const(consts[0]!, {
            because: real.length ? real : [`local:${f.name}/${f.locals[v.imm as number].name} starts at 0`],
            type: typeClass(f.locals[v.imm as number].type),
          });
        },
        [b],
      );
  },
});

export const dce = typedPass({
  name: 'dce',
  about: 'dead-code elimination: an assignment nobody reads, or a value computed for nothing, goes',
  needs: { live: 'liveness' },
  writes: ['stmts'],
  // Compiler Workbench also claims 'loops'; false: adding or removing a `set` in a loop changes its assigned locals.
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx, facts }) {
    const live = facts.live!;
    for (const sid of f.blocks.flatMap(b => b.stmts)) {
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set' && !live.liveAfter(s.id).has(s.local!) && !hasEffect(st, s.value!))
        tx.remove(s.id, { because: [`fact:liveness(${f.name})@r${tx.rev - 1}`] });
      else if (s.op === 'eval' && !hasEffect(st, s.value!)) tx.remove(s.id, { because: ['no effect'] });
    }
  },
});

export const cfg = typedPass({
  name: 'cfg',
  about: 'control-flow cleanup: constant branches, jumps through empty blocks, merging straight-line blocks',
  needs: { cfg: 'cfg' },
  writes: ['stmts', 'cfg'],
  preserves: [],
  body({ st, f, tx }) {
    for (const b of f.blocks) {
      const last = lastStmt(st, b);
      if (!last || last.op !== 'br_if') continue;
      const c = st.get(last.cond!) as ValueRec;
      if (c.op === 'const')
        tx.replaceStmt(
          last.id,
          { op: 'br', to: c.imm ? last.then : last.else },
          { because: [c.id], note: 'branch on a constant' },
        );
      else if (last.then === last.else && isPure(st, last.cond!))
        tx.replaceStmt(
          last.id,
          { op: 'br', to: last.then },
          { because: [last.id], note: 'both arms go to the same block' },
        );
    }
    // thread jumps through blocks that only jump
    const forward = new Map<string, string>();
    for (const b of f.blocks)
      if (
        b.stmts.length === 1 &&
        (st.get(b.stmts[0]) as StmtRec).op === 'br' &&
        b.id !== f.blocks[0].id &&
        (st.get(b.stmts[0]) as StmtRec).to !== b.id
      )
        forward.set(b.id, (st.get(b.stmts[0]) as StmtRec).to!);
    const final = (id: string) => {
      const seen = new Set<string>();
      while (forward.has(id) && !seen.has(id)) {
        seen.add(id);
        id = forward.get(id)!;
      }
      return id;
    };
    for (const b of f.blocks) {
      const last = lastStmt(st, b);
      if (!last) continue;
      for (const field of ['to', 'then', 'else'] as const)
        if (last[field] && final(last[field]!) !== last[field])
          tx.setField(last.id, field, final(last[field]!), { because: [last[field]!] });
    }
    tx.commit();
    // merge b into a when a ends with br b and b has a as its only predecessor
    let merged = true;
    while (merged) {
      merged = false;
      const preds = new Map(f.blocks.map(b => [b.id, [] as string[]]));
      for (const b of f.blocks) for (const s of b.succ) if (preds.has(s)) preds.get(s)!.push(b.id);
      for (const a of f.blocks) {
        const last = lastStmt(st, a);
        if (!last || last.op !== 'br') continue;
        const bId = last.to!;
        if (bId === a.id || bId === f.blocks[0].id || preds.get(bId)!.length !== 1) continue;
        const b = st.get(bId) as BlockRec;
        tx.remove(last.id, { because: [bId], note: 'merged with its only successor' });
        for (const sid of b.stmts.slice())
          tx.move(sid, { block: a, index: a.stmts.length }, { because: [last.id] });
        a.succ = b.succ.slice();
        b.succ = [];
        tx.record('merge', { block: bId, into: a.id });
        tx.commit();
        merged = true;
        break;
      }
    }
  },
});

export const licm = typedPass({
  name: 'licm',
  about:
    'loop-invariant code motion: pure expressions whose operands the loop never assigns move to the preheader',
  needs: { loops: 'loops' },
  writes: ['stmts', 'values', 'locals', 'cfg'],
  preserves: [],
  body({ st, f, tx, facts, params }) {
    for (const L of facts.loops!) {
      let pre = L.preheader;
      if (!pre) {
        pre = tx.block({ because: [L.id], note: 'preheader' });
        tx.insert(tx.at.start(pre), tx.stmt({ op: 'br', to: L.head }, { because: [L.id] }), {
          because: [L.id],
        });
        for (const b of f.blocks) {
          if (L.body.includes(b.id) || b.id === pre) continue;
          const last = lastStmt(st, b);
          if (!last) continue;
          for (const field of ['to', 'then', 'else'] as const)
            if (last[field] === L.head) tx.setField(last.id, field, pre, { because: [L.id] });
        }
        if (f.blocks[0].id === L.head) throw new TxError('unsupported', 'licm: a loop at the entry block');
      }
      const assigned = new Set(L.assigned);
      const INV = [
        'get',
        'const',
        'add',
        'sub',
        'mul',
        'shl',
        'shr',
        'and',
        'or',
        'xor',
        'eq',
        'ne',
        'lt',
        'gt',
        'le',
        'ge',
        'eqz',
        // f32 operators are pure and never trap, so hoisting one out of a loop is safe
        ...F32_OPERANDS,
        ...F32_RESULT,
        'aaddr',
      ];
      // IRWB-037-F: a buffer's length, `load32[b+0]` for a buffer local b the loop does not assign. No statement
      // writes a length word: stores into a buffer go through positions checked against the length (offset 4 and
      // up), and a buffer local holds a buffer, so the load cannot trap. Off unless `lengths: true` (the pass
      // `licm-lengths`, which speed runs): O2 stays the book's O2.
      // Only an outermost loop hoists a length: its body holds the inner loops' lengths too, so each is loaded
      // once per call instead of once per entry of an inner loop.
      const outermost = !facts.loops!.some(M => M !== L && M.body.includes(L.head));
      const lengths = params.lengths === true && outermost;
      const lengthLocal = (v: ValueRec): number | undefined => {
        if (v.op !== 'load' || v.imm !== 0) return undefined;
        const b = st.get(v.args[0]) as ValueRec;
        return b.op === 'get' && f.locals[b.imm as number].type === 'buffer' ? (b.imm as number) : undefined;
      };
      // a length read once per iteration saves one load per iteration and holds a register across the loop; with
      // two reads or more it saves at least two (measured on chess-search: one read lost under the tuned options)
      const reads = new Map<number, number>();
      const countReads = (id: string): void => {
        const v = st.get(id) as ValueRec;
        const b = lengthLocal(v);
        if (b !== undefined) reads.set(b, (reads.get(b) ?? 0) + 1);
        v.args.forEach(countReads);
      };
      if (lengths)
        for (const bid of L.body)
          for (const sid of (st.get(bid) as BlockRec).stmts)
            for (const k of ['value', 'cond', 'addr'] as const) {
              const x = (st.get(sid) as StmtRec)[k];
              if (x) countReads(x);
            }
      const isLengthOf = (v: ValueRec) => {
        const b = lengths ? lengthLocal(v) : undefined;
        return b !== undefined && (reads.get(b) ?? 0) >= 2;
      };
      const inv = (id: string): boolean => {
        const v = st.get(id) as ValueRec;
        if (isLengthOf(v)) return v.args.every(inv);
        if (!INV.includes(v.op)) return false;
        if (v.op === 'get') return !assigned.has(v.imm as number);
        return v.args.every(inv);
      };
      // IRWB-034-G: structurally equal invariant trees of a loop get one local (the bytecode VM's dispatch loop has
      // fifteen uses of two frame addresses; a local per use filled the registers). `share: false` is the old way.
      const share = params.share !== false;
      const keyOf = (id: string): string => {
        const v = st.get(id) as ValueRec;
        return `${v.op}:${v.imm ?? ''}:${v.type ?? ''}(${v.args.map(keyOf).join(',')})`;
      };
      const hoisted = new Map<string, { t: number; set: string }>();
      const hoist = (id: string): string => {
        const v = st.get(id) as ValueRec;
        if (v.op !== 'const' && v.op !== 'get' && inv(id)) {
          const key = share ? keyOf(id) : id;
          let h = hoisted.get(key);
          if (!h) {
            const t = tx.local('inv', { because: [L.id], type: v.type ?? 'i32' });
            const set = tx.set(t, id, { because: [L.id], note: `hoisted out of ${L.id}` });
            tx.insert(tx.at.end(pre!), set, { because: [L.id] });
            hoisted.set(key, (h = { t, set }));
          }
          return tx.get(h.t, { from: id, because: [h.set] });
        }
        const args = v.args.map(hoist);
        return args.some((a, i) => a !== v.args[i])
          ? tx.make(v.op, ...args, { imm: v.imm, from: id, type: v.type ?? 'i32' })
          : id;
      };
      for (const bid of L.body)
        for (const sid of (st.get(bid) as BlockRec).stmts.slice()) {
          const s = st.get(sid) as StmtRec;
          for (const k of ['value', 'cond', 'addr'] as const)
            if (s[k]) {
              const n = hoist(s[k]!);
              if (n !== s[k]) tx.setField(sid, k, n, { because: [L.id] });
            }
        }
    }
  },
});

/**
 * IRWB-037-F: licm with `lengths: true`, as a pass of its own because a pipeline names passes and cannot give one
 * a parameter. speed runs it in licm's place.
 */
export const licmLengths = typedPass({
  ...licm.typed,
  name: 'licm-lengths',
  about: `${licm.typed.about}; also a buffer's length read twice or more in an outermost loop`,
  body: ctx => licm.typed.body({ ...ctx, params: { ...ctx.params, lengths: true } }),
});

export const lvn = typedPass({
  name: 'lvn',
  about: 'local value numbering: the same pure expression computed twice in a block is computed once',
  writes: ['stmts', 'values', 'locals'],
  // Compiler Workbench also claims 'loops'; false: adding or removing a `set` in a loop changes its assigned locals.
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx }) {
    // a key names the operator, its immediate (an array offset, a load offset) and type, so an f32 constant and an
    // i32 constant with the same bits, or two frame addresses, never share a number
    const key = (id: string): string => {
      const v = st.get(id) as ValueRec;
      const t = v.type === 'f32' ? 'f' : '';
      return v.op === 'const'
        ? `#${t}${v.imm}`
        : v.op === 'get'
          ? `@${v.imm}`
          : `${v.op}${v.imm === undefined ? '' : `[${v.imm}]`}${t}(${v.args.map(key).join(',')})`;
    };
    const size = (id: string): number => 1 + (st.get(id) as ValueRec).args.reduce((n, a) => n + size(a), 0);
    for (const b of f.blocks) {
      const seen = new Map<string, { stmt: string; value: string }>();
      for (const sid of b.stmts.slice()) {
        const s = st.get(sid) as StmtRec;
        const visit = (id: string): boolean => {
          const v = st.get(id) as ValueRec;
          if (v.op !== 'tuple' && v.args.length && size(id) >= 3 && isPure(st, id)) {
            const k = key(id),
              first = seen.get(k);
            if (first && first.value !== id) {
              const t = tx.local('vn', { because: [first.value], type: v.type ?? 'i32' });
              const set = tx.set(t, first.value, {
                because: [first.value, id],
                note: `computed once for ${first.stmt} and ${sid}`,
              });
              tx.replace(first.value, tx.get(t, { from: first.value, because: [set] }));
              tx.replace(id, tx.get(t, { from: id, because: [set] }));
              tx.insert(tx.at.before(first.stmt), set, { because: [first.value, id] });
              // IRWB-037-F: the two replacements rebuilt the trees of both statements with new ids, so an entry
              // for an enclosing tree of either names a value no statement uses any more
              for (const [key, e] of [...seen]) if (e.stmt === first.stmt || e.stmt === sid) seen.delete(key);
              return true;
            }
            if (!first) seen.set(k, { stmt: sid, value: id });
          }
          return v.args.some(visit);
        };
        for (const k of ['addr', 'value', 'cond'] as const) if (s[k] && visit(s[k]!)) break;
        if (s.op === 'set')
          for (const [k, e] of [...seen]) if (readsOf(st, e.value).has(s.local!)) seen.delete(k);
      }
    }
  },
});

export const strength = typedPass({
  name: 'strength',
  about:
    'strength reduction with proof: x / 2^k and x % 2^k become shifts and masks when ranges prove x is not negative',
  needs: { ranges: 'ranges' },
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ f, tx, facts }) {
    const ranges = facts.ranges!;
    tx.rewrite(v => {
      if ((v.op !== 'div' && v.op !== 'rem') || !v.args[1].isConst || !isPow2(v.args[1].imm as number))
        return;
      const sid = v.statement!,
        r = ranges.of(sid, v.args[0].id);
      if (r[0] < 0) return;
      const k = v.args[1].imm as number,
        why = [`fact:ranges(${f.name})@r${tx.rev - 1}: ${v.args[0].text} in [${r[0]}, ${r[1]}]`];
      return v.op === 'div'
        ? tx.make('shr', v.args[0].id, tx.const(log2(k)), { because: why, note: `x / ${k} with x ≥ 0` })
        : tx.make('and', v.args[0].id, tx.const(k - 1), { because: why, note: `x % ${k} with x ≥ 0` });
    });
  },
});

export const divToShift = typedPass({
  name: 'div-to-shift',
  about: 'deliberately wrong: x / 2^k becomes x >> k with no proof that x is not negative',
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body: ({ tx }) =>
    tx.rewrite(v => {
      if (v.op === 'div' && v.args[1].isConst && isPow2(v.args[1].imm as number))
        return tx.make('shr', v.args[0].id, tx.const(log2(v.args[1].imm as number)), {
          note: 'no range check: wrong for negative x',
        });
    }),
});

export const bce = typedPass({
  name: 'bce',
  about:
    'bounds-check elimination: a check i >=u buf.length goes when a dominating branch proved i < buf.length and ranges prove i ≥ 0, or a dominating check of i proved it against a bound no larger',
  needs: { dom: 'dominators', reach: 'reaching', ranges: 'ranges' },
  writes: ['stmts', 'cfg'],
  preserves: [],
  body({ st, f, tx, facts }) {
    const dom = facts.dom!,
      reach = facts.reach!,
      ranges = facts.ranges!;
    /**
     * An index as a local plus a constant (IRWB-037-F: the constant; before, a local alone): `x`, `x + c`, `x - c`,
     * or a local t whose one reaching definition is `t = x`, `t = x + c` or `t = x - c`. `sid` is the statement where
     * x is read; the index's value is wrap(x + offset) with x's value there.
     */
    const resolve = (
      sid: string,
      id: string,
    ): { id: string; local: number | null; offset: number; sid: string } => {
      const linear = (vid: string): { local: number; offset: number } | undefined => {
        const v = st.get(vid) as ValueRec;
        if (v.op === 'get') return { local: v.imm as number, offset: 0 };
        if (v.op !== 'add' && v.op !== 'sub') return undefined;
        const [x, k] = v.args.map(a => st.get(a) as ValueRec);
        if (x.op !== 'get' || k.op !== 'const') return undefined;
        return { local: x.imm as number, offset: v.op === 'add' ? (k.imm as number) : -(k.imm as number) };
      };
      const v = st.get(id) as ValueRec;
      if (v.op === 'get') {
        const defs = reach.reachingAt(sid, v.imm as number);
        if (defs.length === 1 && defs[0].startsWith('s:')) {
          const d = st.get(defs[0]) as StmtRec;
          const l = linear(d.value!);
          if (l) return { id: d.value!, ...l, sid: d.id };
        }
        return { id, local: v.imm as number, offset: 0, sid };
      }
      const l = linear(id);
      return l ? { id, ...l, sid } : { id, local: null, offset: 0, sid };
    };
    /**
     * The buffer local whose length the value at statement sid is: `load32[b+0]`, or (IRWB-037-F) a local whose one
     * reaching definition is `t = load32[b+0]` with b unchanged since, the form licm leaves when it hoists a length.
     */
    const lengthBuf = (sid: string, id: string): number | undefined => {
      const isLoad = (x: string) => {
        const v = st.get(x) as ValueRec;
        return v.op === 'load' && v.imm === 0 && (st.get(v.args[0]) as ValueRec).op === 'get'
          ? ((st.get(v.args[0]) as ValueRec).imm as number)
          : undefined;
      };
      const direct = isLoad(id);
      if (direct !== undefined) return direct;
      const v = st.get(id) as ValueRec;
      if (v.op !== 'get') return undefined;
      const defs = reach.reachingAt(sid, v.imm as number);
      if (defs.length !== 1 || !defs[0].startsWith('s:')) return undefined;
      const d = st.get(defs[0]) as StmtRec;
      const b = isLoad(d.value!);
      return b !== undefined && sameDefs(b, d.id, sid) ? b : undefined;
    };
    // a bounds check: `if (i >=u bound) trap`, the bound a constant (a frame array) or a buffer's length
    const checkOf = (s: StmtRec | undefined) => {
      if (!s || s.op !== 'br_if') return undefined;
      const c = st.get(s.cond!) as ValueRec;
      if (c.op !== 'geu') return undefined;
      const bound = st.get(c.args[1]) as ValueRec;
      const buf = bound.op === 'const' ? undefined : lengthBuf(s.id, c.args[1]);
      if (bound.op !== 'const' && buf === undefined) return undefined;
      const trapB = st.get(s.then!) as BlockRec;
      if (!trapB.stmts.length || (st.get(trapB.stmts[0]) as StmtRec).op !== 'trap') return undefined;
      const idx = resolve(s.id, c.args[0]);
      if (idx.local === null) return undefined;
      return bound.op === 'const' ? { idx, k: (bound.imm as number) >>> 0 } : { idx, buf };
    };
    type Check = NonNullable<ReturnType<typeof checkOf>>;
    const where = new Map<string, { block: string; index: number }>();
    for (const blk of f.blocks) blk.stmts.forEach((id, index) => where.set(id, { block: blk.id, index }));
    /** Statement a runs before b on every path to b (a's block dominates b's, or a is earlier in b's block). */
    const before = (a: string, z: string) => {
      const x = where.get(a),
        y = where.get(z);
      if (!x || !y) return false;
      return x.block === y.block ? x.index < y.index : dom.dominates(x.block, y.block);
    };
    const preds = new Map<string, string[]>(f.blocks.map(blk => [blk.id, []]));
    for (const blk of f.blocks) for (const x of blk.succ) preds.get(x)?.push(blk.id);
    const sets = (blk: string, from: number, to: number, l: number) =>
      (st.get(blk) as BlockRec).stmts
        .slice(from, to)
        .some(id => (st.get(id) as StmtRec).op === 'set' && (st.get(id) as StmtRec).local === l);
    /**
     * Local l holds the same value at statement z as at statement a: a runs before z on every path (so it ran),
     * and no path from a to z that does not pass a again assigns l. The blocks of such paths are those reachable
     * from a's block without entering it and from which z's block is reachable without passing a's block.
     */
    const sameDefs = (l: number, a: string, z: string): boolean => {
      if (a === z) return true;
      if (!before(a, z)) return false;
      const A = where.get(a)!,
        Z = where.get(z)!;
      if (A.block === Z.block) return !sets(A.block, A.index + 1, Z.index, l);
      if (sets(A.block, A.index + 1, Infinity, l) || sets(Z.block, 0, Z.index, l)) return false;
      const walk = (start: readonly string[], next: (id: string) => readonly string[]) => {
        const seen = new Set<string>(),
          todo = [...start];
        while (todo.length) {
          const x = todo.pop()!;
          if (x === A.block || seen.has(x)) continue;
          seen.add(x);
          todo.push(...next(x));
        }
        return seen;
      };
      const forward = walk((st.get(A.block) as BlockRec).succ, x => (st.get(x) as BlockRec).succ);
      const backward = walk(preds.get(Z.block)!, x => preds.get(x)!);
      for (const x of forward) if (backward.has(x) && x !== Z.block && sets(x, 0, Infinity, l)) return false;
      // z's block on a cycle that avoids a: the rest of it is on a path from a to z
      return !(backward.has(Z.block) && forward.has(Z.block) && sets(Z.block, Z.index, Infinity, l));
    };
    /**
     * IRWB-037-F: a dominating bounds check of the same index proves this one, `i <u k` on the dominating check's
     * fall-through arm giving `i <u k'` for every k' >= k (unsigned, so no range fact is needed): the same local
     * holding the same value at both checks (sameDefs), and a constant bound no larger, or the same buffer's
     * length with the buffer holding the same value. The nearest such check is cited.
     */
    const dominatingCheck = (b: BlockRec, last: StmtRec, here: Check): boolean => {
      for (let d = dom.idom.get(b.id), child = b.id; d && d !== child; child = d, d = dom.idom.get(d)) {
        const t = lastStmt(st, st.get(d) as BlockRec);
        const there = checkOf(t);
        if (!there || !dom.dominates(t!.else!, b.id)) continue;
        if (there.idx.local !== here.idx.local || there.idx.offset !== here.idx.offset) continue;
        if (!sameDefs(here.idx.local!, there.idx.sid, here.idx.sid)) continue;
        if ('k' in here ? !('k' in there) || there.k! > here.k! : !('buf' in there) || there.buf !== here.buf)
          continue;
        if ('buf' in here && !sameDefs(here.buf!, t!.id, last.id)) continue;
        tx.replaceStmt(
          last.id,
          { op: 'br', to: last.else },
          {
            because: [t!.id],
            note: `${t!.id} already checked ${f.locals[here.idx.local!].name}${here.idx.offset ? ` + ${here.idx.offset}` : ''} against a bound no larger`,
          },
        );
        return true;
      }
      return false;
    };
    for (const b of f.blocks) {
      const last = lastStmt(st, b);
      const check = checkOf(last);
      if (!check || !last) continue;
      if (dominatingCheck(b, last, check)) continue;
      if (!('buf' in check)) continue;
      const c = st.get(last.cond!) as ValueRec;
      const idx = check.idx as typeof check.idx & { local: number },
        buf = check.buf!;
      // walk up the dominator tree for a branch whose taken edge proves idx < buf.length
      for (let d = dom.idom.get(b.id), child = b.id; d && d !== child; child = d, d = dom.idom.get(d)) {
        const t = lastStmt(st, st.get(d) as BlockRec);
        if (!t || t.op !== 'br_if') continue;
        let cond = st.get(t.cond!) as ValueRec,
          onTrue = true;
        if (cond.op === 'eqz') {
          cond = st.get(cond.args[0]) as ValueRec;
          onTrue = false;
        }
        if (cond.op === 'ge')
          onTrue = !onTrue; // x >= len taken means x < len on the other arm
        else if (cond.op !== 'lt') continue;
        const arm = onTrue ? t.then! : t.else!;
        if (!dom.dominates(arm, b.id)) continue;
        if (lengthBuf(t.id, cond.args[1]) !== buf) continue;
        // the index and the buffer are the same values at the branch and at the check
        const same = (l: number) => {
          const a = reach.reachingAt(t.id, l).sort().join(),
            z = reach.reachingAt(idx.sid, l).sort().join();
          return a === z;
        };
        // the branch's case takes a plain local: `x + c < length` proves the index x + c only when the ranges exclude
        // the overflow at the top, where the check must trap; tried, it fired nowhere in the corpus (IRWB-037-F)
        const x = st.get(cond.args[0]) as ValueRec;
        if (idx.offset !== 0 || x.op !== 'get' || x.imm !== idx.local) continue;
        if (!same(idx.local) || !same(buf)) continue;
        if (ranges.at(t.id, idx.local)[0] < 0) continue;
        tx.replaceStmt(
          last.id,
          { op: 'br', to: last.else },
          {
            because: [t.id, `fact:ranges(${f.name}): ${f.locals[idx.local].name} ≥ 0`],
            note: `${t.id} already proved ${f.locals[idx.local].name} < length`,
          },
        );
        break;
      }
    }
  },
});

/**
 * Bounds-check merging for checked text addresses. `caddr(r, p)` traps unless p <u capacity(r) and gives r + 2p.
 * When one block computes several of them on the same receiver, with positions that are one base plus constant
 * offsets (p = B + k, B possibly 0), checking the smallest and the largest position covers every position between:
 * if B + kmin and B + kmax are both below the capacity, so is every B + k with kmin ≤ k ≤ kmax. (For a symbolic
 * B this uses that a text's capacity is below 2^31 units, as its units occupy 2·capacity bytes of a 32-bit
 * address space, so B + kmin + (kmax - kmin) cannot wrap. For constant positions, all ≥ 0, the largest suffices.)
 *
 * The group's first site checks the largest position and its second site the smallest, each rewritten as
 * `caddr(r, p + Δ) - 2Δ` when its own position is not the one checked; every later site becomes the unchecked
 * `r + 2p`. The merged checks run before the original check of the largest position did, which changes only
 * where the program traps, never whether it does:
 * - every caddr of a block runs whenever the block runs (no value operator evaluates its arguments
 *   conditionally), unless something traps first;
 * - a trap aborts the program.
 * A group ends at anything that could break that or change a capacity: a call (it might not return), a store not
 * provably inside a buffer's data, or `zero`.
 *
 * Linear forms are exact modulo 2^32 (add, sub, shifts and products by constants). A symbolic term names either a
 * definition earlier in the same block (one execution per block execution, so equal names are equal values) or
 * a local the block never assigns.
 */
export const bcm = typedPass({
  name: 'bcm',
  about:
    'bounds-check merging: checked text addresses on one receiver whose positions differ by constants are checked once for the smallest and once for the largest position',
  needs: { reach: 'reaching' },
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx, facts }) {
    const reach = facts.reach!;
    type Lin = { t: Map<string, number>; k: number };
    type Site = { vid: string; sid: string; key: string; k: number; symbolic: boolean };
    /** keep: the site's own check is one of the group's; check: rewrite to check `check`; unchecked: r + 2p */
    type Plan = { site: Site; first: Site; mode: 'keep' | 'check' | 'unchecked'; check?: number };
    const plan = new Map<string, Plan>();
    const isLit = (v: ValueRec) => v.op === 'const' && !v.type;
    const add = (a: Lin, b: Lin, sign = 1): Lin => {
      const t = new Map(a.t);
      for (const [x, c] of b.t) t.set(x, ((t.get(x) ?? 0) + sign * c) | 0);
      return { t, k: (a.k + sign * b.k) | 0 };
    };
    const scale = (a: Lin, c: number): Lin => ({
      t: new Map([...a.t].map(([x, y]) => [x, Math.imul(y, c)])),
      k: Math.imul(a.k, c),
    });
    const baseKey = (a: Lin) =>
      [...a.t]
        .filter(([, c]) => c !== 0)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([x, c]) => `${c}*${x}`)
        .join('+');
    for (const b of f.blocks) {
      const index = new Map(b.stmts.map((sid, i) => [sid, i]));
      const assigned = new Set<number>();
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'set') assigned.add(s.local!);
      }
      // a local read at `sid` as a stable name within one execution of the block, or null
      const name = (sid: string, l: number): { def?: StmtRec; key: string } | null => {
        const defs = reach.reachingAt(sid, l);
        if (defs.length === 1 && defs[0].startsWith('s:')) {
          const d = st.get(defs[0]) as StmtRec;
          if (index.has(d.id) && index.get(d.id)! < index.get(sid)!) return { def: d, key: d.id };
          // a single definition of a literal is the same constant wherever it reaches
          if (d.op === 'set' && isLit(st.get(d.value!) as ValueRec)) return { def: d, key: `=${d.id}` };
        }
        if (!assigned.has(l)) return { key: `L${l}` };
        return null;
      };
      const lin = (sid: string, id: string, depth = 0): Lin | null => {
        const v = st.get(id) as ValueRec;
        if (v.type) return null;
        if (isLit(v)) return { t: new Map(), k: v.imm as number };
        if (depth > 12) return null;
        if (v.op === 'get') {
          const n = name(sid, v.imm as number);
          if (!n) return null;
          if (n.def) {
            const inner = lin(n.def.id, n.def.value!, depth + 1);
            if (inner) return inner;
          }
          return { t: new Map([[n.key, 1]]), k: 0 };
        }
        const x = v.args[0] && lin(sid, v.args[0], depth + 1),
          y = v.args[1] && lin(sid, v.args[1], depth + 1);
        if (!x || !y) return null;
        const yc = y.t.size === 0 || [...y.t.values()].every(c => c === 0) ? y.k : null;
        const xc = x.t.size === 0 || [...x.t.values()].every(c => c === 0) ? x.k : null;
        switch (v.op) {
          case 'add':
            return add(x, y);
          case 'sub':
            return add(x, y, -1);
          case 'shl':
            return yc !== null && yc >= 0 && yc < 32 ? scale(x, (2 ** yc) | 0) : null;
          case 'mul':
            return yc !== null ? scale(x, yc) : xc !== null ? scale(y, xc) : null;
          default:
            return null;
        }
      };
      const recvKey = (sid: string, id: string): string | null => {
        const v = st.get(id) as ValueRec;
        if (v.op !== 'get') return null;
        return name(sid, v.imm as number)?.key ?? null;
      };
      let open = new Map<string, Site[]>();
      const close = () => {
        const role = (x: Site, first: Site, target: number) =>
          plan.set(
            x.vid,
            x.k === target
              ? { site: x, first, mode: 'keep' }
              : { site: x, first, mode: 'check', check: target },
          );
        for (const sites of open.values()) {
          if (sites.length < 2) continue;
          const ks = sites.map(x => x.k),
            max = Math.max(...ks),
            min = Math.min(...ks);
          const [first, second, ...rest] = sites;
          if (!first.symbolic || min === max) {
            // constant positions ≥ 0, or one position repeated: one check covers the group
            role(first, first, max);
            for (const x of [second, ...rest]) plan.set(x.vid, { site: x, first, mode: 'unchecked' });
          } else {
            if (sites.length < 3) continue;
            role(first, first, max);
            role(second, first, min);
            for (const x of rest) plan.set(x.vid, { site: x, first, mode: 'unchecked' });
          }
        }
        open = new Map();
      };
      // a store keeps every capacity word intact when it writes a buffer's data: a checked caddr at a constant
      // position c ≥ 0 with 2c + offset ≥ 4 (the capacity is the first 4 bytes)
      const safeStore = (s: StmtRec): boolean => {
        const a = st.get(s.addr!) as ValueRec;
        if (a.op !== 'caddr') return false;
        const p = lin(s.id, a.args[1]);
        return !!p && baseKey(p) === '' && p.k >= 0 && 2 * p.k + (s.offset ?? 0) >= 4;
      };
      const visit = (sid: string, id: string): void => {
        const v = st.get(id) as ValueRec;
        v.args.forEach(a => visit(sid, a));
        if (v.op === 'call') close();
        else if (v.op === 'caddr') {
          const recv = recvKey(sid, v.args[0]),
            p = lin(sid, v.args[1]);
          if (recv === null || !p) return;
          const base = baseKey(p);
          if (!base && p.k < 0) return;
          const key = `${recv}|${base}`;
          const sites = open.get(key) ?? [];
          sites.push({ vid: id, sid, key, k: p.k, symbolic: base !== '' });
          open.set(key, sites);
        }
      };
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        // the evaluator's order: a store's address, then its value; otherwise the one value or condition
        const fields = s.op === 'store' ? (['addr', 'value'] as const) : (['value', 'cond'] as const);
        for (const k of fields) if (s[k]) visit(sid, s[k]!);
        if ((s.op === 'store' && !safeStore(s)) || s.op === 'zero') close();
      }
      close();
    }
    if (![...plan.values()].some(p => p.mode !== 'keep')) return;
    tx.rewrite(v => {
      const p = plan.get(v.id);
      if (!p || p.mode === 'keep' || v.op !== 'caddr') return;
      const recv = v.args[0].id,
        pos = v.args[1].id;
      if (p.mode === 'check') {
        const d = (p.check! - p.site.k) | 0;
        const checked = tx.make('caddr', recv, tx.make('add', pos, tx.const(d)), {
          note: `checks position ${p.site.symbolic ? 'base + ' : ''}${p.check} for the group on this receiver`,
        });
        return tx.make('add', checked, tx.const(Math.imul(-2, d)), {
          note: 'this address, from the group check',
        });
      }
      return tx.make('add', recv, tx.make('shl', pos, tx.const(1)), {
        because: [p.first.sid],
        note: `covered by the group's checks, made where ${p.first.sid} computes the first address on this receiver`,
      });
    });
  },
});

/**
 * Dead-function elimination: functions no call reaches from the program's entries are removed. The entries are a
 * parameter (`params.roots`: the functions the host calls, e.g. the four of Candela's gallery slot); a program
 * cannot know them from its own text, since an uncalled function may be exactly what the host calls.
 *
 * Valid under a contract that compares only the entries (`MeaningParams.roots`): a removed function was not
 * callable from any entry, so no entry's result can depend on it. Typically run after a specialization has turned
 * dispatches into direct calls, when whole families of functions lose their last caller.
 */
const dfeDefinition = definePass<TypedBlocks, Record<string, any>, Record<string, unknown>>({
  id: 'typed.dfe',
  version: '1',
  description:
    'dead-function elimination: functions no call reaches from the entries (params.roots) are removed',
  ir: BlocksIR,
  adapter: blocksAdapter,
  needs: {},
  writes: {
    entities: ['fn', 'local', 'block', 'stmt.*', 'value.*', 'op'],
    relations: ['declares', 'contains', 'emits', 'uses', 'operand', 'reads', 'writes', 'succ', 'jump'],
  },
  preserves: [],
  run({ before, params }) {
    const roots = ((params ?? {}) as { roots?: readonly string[] }).roots ?? [];
    if (!roots.length)
      throw new TxError('unsupported', 'dfe needs params.roots: the functions the host calls');
    const st = Store.from(before.value);
    for (const r of roots) st.fn(r);
    const callees = (f: WorkFn): string[] => {
      const out = new Set<string>();
      const walk = (id: string | undefined) => {
        if (!id) return;
        const v = st.get(id) as ValueRec;
        if (v.op === 'call') out.add(v.imm as string);
        v.args.forEach(walk);
      };
      for (const b of f.blocks)
        for (const sid of b.stmts) {
          const s = st.get(sid) as StmtRec;
          walk(s.value);
          walk(s.cond);
          walk(s.addr);
        }
      return [...out];
    };
    const reached = new Set<string>(roots),
      todo = [...roots];
    while (todo.length)
      for (const c of callees(st.fn(todo.pop()!))) if (!reached.has(c)) (reached.add(c), todo.push(c));
    const dead = [...st.fns.keys()].filter(n => !reached.has(n));
    if (!dead.length) return;
    const rev = before.value.rev + 1;
    for (const n of dead) {
      const f = st.fn(n);
      st.fns.delete(n);
      st.ents.delete(f.id);
      for (const id of [...st.ents.keys()]) if (id.startsWith(`op:${n}#`)) st.ents.delete(id);
    }
    st.rev = rev;
    const native = st.toNative();
    const because = [`entries: ${[...roots].sort().join(', ')}`];
    const after = new Set(blocksEntities(native).map(e => e.id));
    const correspondence: CorrespondenceEntry[] = blocksEntities(before.value)
      .map(e => e.id)
      .filter(id => !after.has(id))
      .sort()
      .map(id => ({ from: [id], to: [], relation: 'removed', because }));
    const edits: Edit[] = dead.map((fn, i) => ({
      id: `edit:r${rev}.${i}`,
      rev,
      pass: 'dfe',
      fn,
      kind: 'removeFn',
      because,
      note: `no call reaches ${fn} from the entries`,
    }));
    const report: RevisionReport = { pass: 'dfe', rev, edits, fns: dead, kinds: { removeFn: dead.length } };
    return { native, correspondence, edits: edits.length, report };
  },
});
export const dfe: TypedPass = Object.freeze({
  ...dfeDefinition,
  typed: {
    name: 'dfe',
    about: 'dead-function elimination: functions no call reaches from the entries (params.roots) are removed',
    writes: ['cfg', 'locals'],
    program: true,
    body: () => {
      throw new TxError('unsupported', 'dfe works on the whole program');
    },
  },
}) as TypedPass;

const countReads = (st: Store, id: string, l: number): number => {
  const v = st.get(id) as ValueRec;
  return (v.op === 'get' && v.imm === l ? 1 : 0) + v.args.reduce((n, a) => n + countReads(st, a, l), 0);
};
const copyTree = (tx: Tx, st: Store, id: string, from: string, because: string): string => {
  const v = st.get(id) as ValueRec;
  return tx.make(v.op, ...v.args.map(a => copyTree(tx, st, a, from, because)), {
    imm: v.imm,
    from: id,
    because: [because],
    type: v.type ?? 'i32',
  });
};

export const subst = typedPass({
  name: 'subst',
  about:
    'forward substitution: a temporary assigned a pure value and read once in the same block is replaced by the value',
  needs: { live: 'liveness' },
  writes: ['stmts', 'values'],
  // Compiler Workbench also claims 'loops'; false: adding or removing a `set` in a loop changes its assigned locals.
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx, facts }) {
    const live = facts.live!;
    const defCount = new Map<number, number>();
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'set') defCount.set(s.local!, (defCount.get(s.local!) || 0) + 1);
      }
    for (const b of f.blocks) {
      for (let i = 0; i < b.stmts.length; i++) {
        const d = st.get(b.stmts[i]) as StmtRec;
        if (
          d.op !== 'set' ||
          defCount.get(d.local!) !== 1 ||
          f.locals[d.local!].param ||
          !isPure(st, d.value!)
        )
          continue;
        const operands = readsOf(st, d.value!);
        let users = 0,
          user: StmtRec | null = null,
          blocked = false;
        for (let j = i + 1; j < b.stmts.length; j++) {
          const s = st.get(b.stmts[j]) as StmtRec;
          const n = stmtValues(s).reduce((m, v) => m + countReads(st, v, d.local!), 0);
          if (n) {
            users += n;
            if (!user) user = s;
            else break;
          }
          if (s.op === 'set' && (operands.has(s.local!) || s.local === d.local)) {
            if (!user) blocked = true;
            break;
          }
        }
        if (blocked || users !== 1 || live.liveAfter(user!.id).has(d.local!)) continue;
        tx.rewrite(
          v => (v.op === 'get' && v.imm === d.local ? copyTree(tx, st, d.value!, v.id, d.id) : undefined),
          [b],
        );
        tx.remove(d.id, { because: [user!.id], note: 'substituted into its only reader' });
        break; // one per block per run: liveness changed; the pipeline repeats
      }
    }
  },
});

/** IRWB-003: loop rotation by header duplication (src/typed/rotate.ts). */
export const rotate = typedPass(rotateSpec);
/** IRWB-003: inlining, a whole-program pass like dfe (src/typed/inline.ts). */
export const inline = makeInline(revisionCorrespondence);

export const PASSES: Readonly<Record<string, TypedPass>> = Object.freeze({
  fold,
  simplify,
  constprop,
  dce,
  cfg,
  licm,
  'licm-lengths': licmLengths,
  lvn,
  strength,
  'div-to-shift': divToShift,
  bce,
  subst,
  bcm,
  dfe,
  rotate,
  inline,
  reassoc,
  bitwise,
});

/** Compiler Workbench's pipelines, by pass name. */
export const PIPELINES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  O0: [],
  O1: ['cfg', 'fold', 'simplify', 'constprop', 'fold', 'simplify', 'dce', 'cfg'],
  O2: [
    'cfg',
    'fold',
    'simplify',
    'constprop',
    'fold',
    'simplify',
    'dce',
    'cfg',
    'licm',
    'lvn',
    'strength',
    'bce',
    'subst',
    'subst',
    'dce',
    'cfg',
  ],
  /**
   * O2 followed by one subst: after O2's final dce and cfg, a copy such as `t3 = i` has a single reader and subst
   * removes it. Found by the ordering search (diary step 9): 11 of the 12 projects that beat O2 do so this way.
   * O2 itself stays as Compiler Workbench defines it, for parity with the book.
   */
  'O2+': [
    'cfg',
    'fold',
    'simplify',
    'constprop',
    'fold',
    'simplify',
    'dce',
    'cfg',
    'licm',
    'lvn',
    'strength',
    'bce',
    'subst',
    'subst',
    'dce',
    'cfg',
    'subst',
  ],
  /**
   * IRWB-003: two levels of inlining, then O2+, then loop rotation and a cfg to merge what rotation leaves in a
   * line. Meant for the backend options chains, coalesce and homes. No dfe: it needs the program's entries.
   * IRWB-037-F: licm-lengths in licm's place also hoists buffer lengths; bcm after bce merges the checked text addresses inlining puts in one block; after the last subst
   * has built the trees, reassoc moves constants out to address offsets, bitwise rewrites SHA's choice and
   * majority, simplify takes the `x + 0` reassoc leaves,
   * and lvn shares the subtrees the substitutions duplicated. Each placement measured on the corpus (ticket).
   */
  speed: [
    'inline',
    'inline',
    'cfg',
    'fold',
    'simplify',
    'constprop',
    'fold',
    'simplify',
    'dce',
    'cfg',
    'licm-lengths',
    'lvn',
    'strength',
    'bce',
    'bcm',
    'subst',
    'subst',
    'dce',
    'cfg',
    'subst',
    'reassoc',
    'bitwise',
    'simplify',
    'lvn',
    'rotate',
    'cfg',
  ],
  loops: ['cfg', 'simplify', 'licm', 'lvn', 'subst', 'dce', 'cfg'],
  checks: ['cfg', 'simplify', 'bce', 'cfg'],
  broken: ['div-to-shift'],
});

export type { ValueHandle };
