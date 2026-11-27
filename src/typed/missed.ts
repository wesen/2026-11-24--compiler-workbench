/**
 * Missed optimizations, from provenance (IRWB-037-G): where the executed instructions of a revision are, by code
 * shape, and which passes made the code they run.
 *
 * `attributeSteps` (attribute.ts) credits the *difference* between two revisions to pass decisions. This asks the
 * opposite question of one revision: of the instructions that still run, which implement code no pass has touched,
 * and what does that code look like? For a set of calls the head image is run with per-instruction counts; every
 * executed instruction is credited, through the backend's `covers`, to
 *   - its statement, abstracted to a shape: locals are `x`, constants `#` (0, 1 and -1 stay), block names go;
 *   - its value node, as the pattern a rewrite rule would have to match: the operator over its operands' operators
 *     (`eq(load, #)`); an instruction that only builds a leaf (a constant, a read) is credited to the leaf's user.
 * Each site carries its provenance: the passes named by the origins of the statement and of every value under it
 * (`ingest` alone: the front end's code, as it was at r0). A shape's `untouched` count is the instructions at sites
 * whose provenance is `ingest` alone. Node patterns also say how many rules of the given tables have that root
 * operator, so "hot, untouched, and no rule looks at this operator" can be read off one row.
 *
 * The counts are the emulator's: the rows of each table sum to the executed instructions of the calls.
 */
import type { Artifact } from '../framework/core/types.js';
import type { AttributedCall } from './attribute.js';
import { lowerToImage, runImage, type BackendOptionsInput } from './backend/index.js';
import { storeOf } from './ir.js';
import { showStmt } from './listing.js';
import type { StmtRec, Store, TypedBlocks, ValueRec } from './model.js';
import type { Rule } from './rules/form.js';

export interface HotShape {
  readonly shape: string;
  /** Executed instructions credited to the shape, over all calls. */
  readonly instructions: number;
  /** Of those, the instructions at sites no pass touched (provenance `ingest` alone). */
  readonly untouched: number;
  /** Distinct statements (statement table) or value nodes (node table) with the shape that ran. */
  readonly sites: number;
  /** Instructions by provenance label: the passes in the site's origins, sorted and joined with `+`. */
  readonly provenance: Readonly<Record<string, number>>;
  /** The hottest site, with its statement's text. */
  readonly example: { readonly id: string; readonly text: string; readonly instructions: number };
  /** Node table: rules of the given tables whose pattern has this root operator. */
  readonly rules?: number;
}

export interface HotShapes {
  /** Executed instructions over all calls. */
  readonly total: number;
  /** Instructions that cover only their function (frames, saved registers) or nothing. */
  readonly frame: number;
  readonly statements: readonly HotShape[];
  readonly nodes: readonly HotShape[];
}

const leaf = (v: ValueRec): string | undefined =>
  v.op === 'get'
    ? 'x'
    : v.op === 'const'
      ? v.type === 'f32'
        ? '#f'
        : v.imm === 0 || v.imm === 1 || v.imm === -1
          ? String(v.imm)
          : '#'
      : undefined;

/** A value tree as a shape: operators, `x` for a read, `#` for a constant other than 0, 1, -1. */
export function valueShape(st: Store, id: string, depth = 8): string {
  const v = st.get(id) as ValueRec;
  const l = leaf(v);
  if (l) return l;
  if (depth <= 0) return '…';
  const head = v.op === 'aaddr' ? 'frame' : v.op === 'call' ? 'call' : v.op;
  return v.args.length ? `${head}(${v.args.map(a => valueShape(st, a, depth - 1)).join(', ')})` : head;
}

export function stmtShape(st: Store, id: string, depth = 8): string {
  const s = st.get(id) as StmtRec;
  const val = (x: string | undefined) => (x ? valueShape(st, x, depth) : '');
  switch (s.op) {
    case 'set':
      return `x = ${val(s.value)}`;
    case 'store':
      return `store[${val(s.addr)}] = ${val(s.value)}`;
    case 'br_if':
      return `if ${val(s.cond)}`;
    case 'return':
      return `return ${val(s.value)}`;
    case 'eval':
      return val(s.value);
    default:
      return s.op;
  }
}

/** The pattern a rule would match at a node: its operator over its operands' operators (or leaf kinds). */
function nodePattern(st: Store, v: ValueRec): string {
  const l = leaf(v);
  if (l) return l;
  return `${v.op}(${v.args.map(a => leaf(st.get(a) as ValueRec) ?? (st.get(a) as ValueRec).op).join(', ')})`;
}

interface Acc {
  instructions: number;
  untouched: number;
  sites: Map<string, number>;
  provenance: Map<string, number>;
  stmtOf: Map<string, string>;
}

export function hotShapes(
  head: Artifact<TypedBlocks>,
  calls: readonly AttributedCall[],
  options: {
    readonly backend?: BackendOptionsInput;
    readonly rules?: readonly Rule[];
    readonly limit?: number;
  } = {},
): HotShapes {
  const st = storeOf(head.value);
  const { image } = lowerToImage(head, options.backend ?? {});
  const counts = new Map<number, number>();
  for (const c of calls) {
    const run = runImage(image, c.fn, c.args, c.memory, { limit: options.limit ?? 2e5 });
    if (run.trap || run.limit || run.fault || !run.counts)
      throw new Error(`hotShapes: ${c.fn} did not finish`);
    run.counts.forEach((n, w) => n && counts.set(w, (counts.get(w) ?? 0) + n));
  }

  // per statement: its provenance label, and each value's parent (a value has one user)
  const parent = new Map<string, string>(),
    label = new Map<string, string>();
  const provenanceOf = (sid: string): string => {
    let l = label.get(sid);
    if (l !== undefined) return l;
    const s = st.get(sid) as StmtRec,
      vias = new Set<string>();
    for (const o of s.origin) vias.add(o.via);
    const walk = (id: string | undefined, up: string) => {
      if (!id) return;
      const v = st.get(id) as ValueRec;
      parent.set(id, up);
      for (const o of v.origin) vias.add(o.via);
      for (const a of v.args) walk(a, id);
    };
    walk(s.value, sid);
    walk(s.cond, sid);
    walk(s.addr, sid);
    if (vias.size > 1) vias.delete('ingest');
    label.set(sid, (l = [...vias].sort().join('+')));
    return l;
  };

  const statements = new Map<string, Acc>(),
    nodes = new Map<string, Acc>();
  const credit = (table: Map<string, Acc>, shape: string, site: string, sid: string, n: number) => {
    let a = table.get(shape);
    if (!a)
      table.set(
        shape,
        (a = { instructions: 0, untouched: 0, sites: new Map(), provenance: new Map(), stmtOf: new Map() }),
      );
    const prov = provenanceOf(sid);
    a.instructions += n;
    if (prov === 'ingest') a.untouched += n;
    a.sites.set(site, (a.sites.get(site) ?? 0) + n);
    a.provenance.set(prov, (a.provenance.get(prov) ?? 0) + n);
    a.stmtOf.set(site, sid);
  };
  const kindOf = (id: string) => (st.has(id) ? (st.get(id) as { kind?: string }).kind : undefined);
  let total = 0,
    frame = 0;
  for (const m of image.value.insns) {
    const n = counts.get(m.offset >>> 2);
    if (!n) continue;
    total += n;
    const sid = m.covers.find(c => kindOf(c) === 'stmt');
    if (!sid) {
      frame += n;
      continue;
    }
    credit(statements, stmtShape(st, sid), sid, sid, n);
    provenanceOf(sid);
    let vid = m.covers.find(c => kindOf(c) === 'value');
    // an instruction for a leaf belongs to the node that uses the leaf
    while (vid && leaf(st.get(vid) as ValueRec) && kindOf(parent.get(vid) ?? '') === 'value')
      vid = parent.get(vid);
    const s = st.get(sid) as StmtRec;
    if (!vid || leaf(st.get(vid) as ValueRec))
      credit(nodes, `${s.op}${vid ? ` ${leaf(st.get(vid) as ValueRec)}` : ''}`, sid, sid, n);
    else {
      // a comparison fused into its branch is one pattern with it
      const v = st.get(vid) as ValueRec;
      const pat = nodePattern(st, v);
      credit(nodes, s.op === 'br_if' && s.cond === vid ? `if ${pat}` : pat, vid, sid, n);
    }
  }

  const rootCount = new Map<string, number>();
  for (const r of options.rules ?? []) rootCount.set(r.lhs.op, (rootCount.get(r.lhs.op) ?? 0) + 1);
  const rows = (table: Map<string, Acc>, withRules: boolean): HotShape[] =>
    [...table]
      .map(([shape, a]) => {
        const [id, n] = [...a.sites].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
        const root = /^(?:if )?([a-z0-9]+)\(/.exec(shape)?.[1];
        return {
          shape,
          instructions: a.instructions,
          untouched: a.untouched,
          sites: a.sites.size,
          provenance: Object.fromEntries([...a.provenance].sort((x, y) => y[1] - x[1])),
          example: { id, text: showStmt(st, a.stmtOf.get(id)!), instructions: n },
          ...(withRules && options.rules ? { rules: root ? (rootCount.get(root) ?? 0) : 0 } : {}),
        };
      })
      .sort((x, y) => y.instructions - x.instructions || (x.shape < y.shape ? -1 : 1));
  return { total, frame, statements: rows(statements, false), nodes: rows(nodes, true) };
}

/** Both tables as text, the `top` hottest rows of each. */
export function formatHotShapes(h: HotShapes, top = 20): string {
  const pct = (n: number) => `${((100 * n) / h.total).toFixed(1)}%`.padStart(6);
  const table = (title: string, rows: readonly HotShape[], rules: boolean) => [
    '',
    `${title}`,
    `   instr  share untouched sites ${rules ? 'rules ' : ''}shape`,
    ...rows.slice(0, top).flatMap(r => [
      `${String(r.instructions).padStart(8)} ${pct(r.instructions)} ${String(r.untouched).padStart(9)} ${String(r.sites).padStart(5)} ${rules ? String(r.rules ?? '').padStart(5) + ' ' : ''}${r.shape}`,
      `${' '.repeat(rules ? 39 : 33)}${Object.entries(r.provenance)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')};  ${r.example.id}: ${r.example.text}`,
    ]),
  ];
  const untouched = h.statements.reduce((n, r) => n + r.untouched, 0);
  return [
    `${h.total} instructions; ${untouched} (${pct(untouched).trim()}) at statements no pass touched; ${h.frame} frame and backend`,
    ...table('statement shapes', h.statements, false),
    ...table('node patterns (what a rule would match)', h.nodes, true),
  ].join('\n');
}
