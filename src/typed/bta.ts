/**
 * Binding-time analysis for specialization on constant buffers (IRWB-036-G).
 *
 * Given the buffer parameters a host has bound to fixed cells, and the scalar parameters it has bound to a set of
 * candidate values, divide a function's locals into static (their value at every point is a function of the bound
 * data alone) and dynamic. The division is the greatest fixpoint: every candidate parameter and every local that is
 * not a parameter (it starts at the constant 0) begins static, and a local becomes dynamic when one of its
 * assignments has a value that is not static. A value is static when it is an i32 constant, a read of a static
 * local, a pure i32 operator (no division: it may trap) over static values, or a load from a bound buffer at a
 * static position: `load16u(caddr(get P, position)) + 4` (charCodeAt) and `load(get P) + 0` (length).
 *
 * The promise reaches a load only when the buffer parameter is never assigned, which `staticLoadOf` checks.
 */
import type { StmtRec, Store, ValueRec, WorkFn } from './model.js';

/** Pure i32 operators the specializer evaluates (the evaluator's `binop`, without div and rem). */
export const STATIC_BINARY: ReadonlySet<string> = new Set(
  ['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr', 'shru'].concat([
    'eq',
    'ne',
    'lt',
    'gt',
    'le',
    'ge',
    'ltu',
    'geu',
  ]),
);

export interface BufferLoad {
  /** The buffer parameter's local index. */
  readonly param: number;
  /** `cell`: a u16 cell at the position given by `position`; `length`: the buffer's length. */
  readonly kind: 'cell' | 'length';
  /** The value id of the position (cell loads). */
  readonly position?: string;
}

/** The buffer load a value is, if it is one from a parameter in `buffers`. */
export function bufferLoadOf(st: Store, id: string, buffers: ReadonlySet<number>): BufferLoad | undefined {
  const v = st.get(id) as ValueRec;
  if (v.op === 'load16u' && v.imm === 4) {
    const a = st.get(v.args[0]) as ValueRec;
    if (a.op !== 'caddr') return;
    const base = st.get(a.args[0]) as ValueRec;
    if (base.op === 'get' && buffers.has(base.imm as number))
      return { param: base.imm as number, kind: 'cell', position: a.args[1] };
  } else if (v.op === 'load' && v.imm === 0 && !v.type) {
    const base = st.get(v.args[0]) as ValueRec;
    if (base.op === 'get' && buffers.has(base.imm as number))
      return { param: base.imm as number, kind: 'length' };
  }
}

export interface Division {
  /** Local indices that are static. */
  readonly static: ReadonlySet<number>;
  /** For each dynamic local that is not a parameter: the assignment that made it dynamic. */
  readonly dynamicBecause: ReadonlyMap<number, string>;
  /** The loads from bound buffers whose position is static (value ids), and those whose position is dynamic. */
  readonly staticLoads: readonly string[];
  readonly dynamicLoads: readonly string[];
}

export function bindingTimes(
  st: Store,
  f: WorkFn,
  buffers: ReadonlySet<number>,
  candidates: ReadonlySet<number>,
): Division {
  const isStatic = new Set<number>();
  f.locals.forEach(l => {
    if (!l.param || candidates.has(l.index)) isStatic.add(l.index);
  });
  const staticValue = (id: string): boolean => {
    const v = st.get(id) as ValueRec;
    if (v.type === 'f32') return false;
    if (v.op === 'const') return true;
    if (v.op === 'get') return isStatic.has(v.imm as number);
    if (STATIC_BINARY.has(v.op) || v.op === 'eqz') return v.args.every(staticValue);
    const load = bufferLoadOf(st, id, buffers);
    return !!load && (load.kind === 'length' || staticValue(load.position!));
  };
  const sets: StmtRec[] = [];
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      if (s.op === 'set') sets.push(s);
    }
  const dynamicBecause = new Map<number, string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of sets)
      if (isStatic.has(s.local!) && !staticValue(s.value!)) {
        isStatic.delete(s.local!);
        dynamicBecause.set(s.local!, s.id);
        changed = true;
      }
  }
  const staticLoads: string[] = [],
    dynamicLoads: string[] = [];
  const walk = (id: string | undefined): void => {
    if (!id) return;
    const v = st.get(id) as ValueRec;
    const load = bufferLoadOf(st, id, buffers);
    if (load) (staticValue(id) ? staticLoads : dynamicLoads).push(id);
    v.args.forEach(walk);
  };
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      (walk(s.value), walk(s.cond), walk(s.addr));
    }
  return { static: isStatic, dynamicBecause, staticLoads, dynamicLoads };
}
