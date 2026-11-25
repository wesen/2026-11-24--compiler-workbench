/**
 * Printing a working store as text (Compiler Workbench's `show`, `showStmt`, `listing`), and provenance queries
 * that follow `origin` records down to front-end ops (`lineage`, `linesOf`). The text format is the prototype's,
 * so listings can be compared with its book and its projects' notes.
 */
import { formatF32 } from './f32.js';
import type { BlockRec, StmtRec, Store, ValueRec, WorkFn } from './model.js';

export const SYMBOL: Readonly<Record<string, string>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  rem: '%',
  and: '&',
  or: '|',
  xor: '^',
  shl: '<<',
  shr: '>>',
  shru: '>>>',
  eq: '==',
  ne: '!=',
  lt: '<',
  gt: '>',
  le: '<=',
  ge: '>=',
  ltu: '<u',
  geu: '>=u',
  fadd: '+.',
  fsub: '-.',
  fmul: '*.',
  fdiv: '/.',
  feq: '==.',
  fne: '!=.',
  flt: '<.',
  fgt: '>.',
  fle: '<=.',
  fge: '>=.',
};
/** Operators whose result is 0 or 1. */
export const COMPARE = new Set(
  ['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'ltu', 'geu', 'eqz'].concat([
    'feq',
    'fne',
    'flt',
    'fgt',
    'fle',
    'fge',
  ]),
);

export function show(st: Store, id: string, fnEnt?: WorkFn): string {
  const v = st.get(id) as ValueRec,
    f = fnEnt || (st.get(v.fn) as WorkFn);
  const arg = (i: number) => show(st, v.args[i], f);
  switch (v.op) {
    case 'const':
      return v.type === 'f32' ? `${formatF32(v.imm as number)}f` : String(v.imm);
    case 'get':
      return f.locals[v.imm as number] ? f.locals[v.imm as number].name : `l${v.imm}`;
    case 'eqz':
      return `!(${arg(0)})`;
    case 'load':
      return `load${v.type === 'f32' ? 'f32' : '32'}[${arg(0)}+${v.imm}]`;
    case 'load16u':
      return `load16[${arg(0)}+${v.imm}]`;
    case 'call':
      return `${v.imm}(${v.args.map(a => show(st, a, f)).join(', ')})`;
    case 'caddr':
      return `caddr(${arg(0)}, ${arg(1)})`;
    case 'aaddr':
      return `frame+${v.imm}`;
    case 'result':
      return `result#${v.imm}`;
    case 'tuple':
      return `(${v.args.map(a => show(st, a, f)).join(', ')})`;
  }
  if (v.args.length === 1 || !SYMBOL[v.op]) return `${v.op}(${v.args.map(a => show(st, a, f)).join(', ')})`;
  return `(${arg(0)} ${SYMBOL[v.op]} ${arg(1)})`;
}

const short = (id: string | undefined) => id && id.replace(/^bb:[^.]+\./, '.');

export function showStmt(st: Store, id: string): string {
  const s = st.get(id) as StmtRec,
    f = st.get(s.fn) as WorkFn;
  switch (s.op) {
    case 'set':
      return `${f.locals[s.local!].name} = ${show(st, s.value!, f)}`;
    case 'store':
      return `store${s.width}[${show(st, s.addr!, f)}+${s.offset}] = ${show(st, s.value!, f)}`;
    case 'eval':
      return show(st, s.value!, f);
    case 'br':
      return `goto ${short(s.to)}`;
    case 'br_if':
      return `if ${show(st, s.cond!, f)} goto ${short(s.then)} else ${short(s.else)}`;
    case 'return':
      return `return ${show(st, s.value!, f)}`;
    case 'trap':
      return 'trap';
    case 'zero':
      return `zero frame+${s.offset}, ${s.bytes} bytes`;
  }
  return s.op;
}

export function listing(st: Store, fname?: string): string {
  const out: string[] = [];
  for (const f of fname ? [st.fn(fname)] : st.fns.values()) {
    const params = f.params.map((t, i) => `${f.locals[i].name}: ${t}`).join(', ');
    out.push(`function ${f.name}(${params}): ${f.result}`);
    for (const b of f.blocks) {
      out.push(`${b.id}  -> [${b.succ.map(short).join(', ')}]`);
      for (const s of b.stmts) out.push(`    ${s.padEnd(13)}${showStmt(st, s)}`);
    }
  }
  return out.join('\n');
}

/** Front-end op ids an entity derives from: through origin, value arguments, statement fields and covers. */
export function lineage(lookup: (id: string) => any, id: string, seen = new Set<string>()): string[] {
  const e = lookup(id);
  if (!e || seen.has(id)) return [];
  seen.add(id);
  if (e.kind === 'op') return [id];
  const out: string[] = [];
  for (const o of e.origin || [])
    if (o.from && o.from !== 'source') out.push(...lineage(lookup, o.from, seen));
  for (const a of e.args || []) out.push(...lineage(lookup, a, seen));
  for (const k of ['value', 'cond', 'addr']) if (e[k]) out.push(...lineage(lookup, e[k], seen));
  if (e.covers) for (const c of e.covers) out.push(...lineage(lookup, c, seen));
  return [...new Set(out)];
}

export function linesOf(lookup: (id: string) => any, id: string): number[] {
  const lines = new Set<number>();
  for (const o of lineage(lookup, id)) {
    const at = lookup(o)?.at;
    if (at) lines.add(at.line);
  }
  return [...lines].sort((a, b) => a - b);
}

export function describeText(st: Store, id: string): string {
  const e = st.get(id);
  if (!e) return id;
  if (e.kind === 'op')
    return (
      `${e.op}${e.operands?.length ? ' ' + e.operands.join(' ') : ''}` + (e.at ? ` (line ${e.at.line})` : '')
    );
  if (e.kind === 'value') return show(st, id);
  if (e.kind === 'stmt') return showStmt(st, id);
  if (e.kind === 'block')
    return `${(e as BlockRec).stmts.length} statements -> ${(e as BlockRec).succ.map(short).join(', ')}`;
  if (e.kind === 'function') return `${e.name}(${e.params.join(', ')}): ${e.result}`;
  if (e.kind === 'insn') return e.text;
  return e.kind;
}
