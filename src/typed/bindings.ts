/**
 * Host promises about a program's inputs, shared by the `specialize` and `peval` passes (IRWB-036-E): the
 * `typed.bindings` artifact — parameter values, record fields, and buffer contents a host promises are fixed —
 * and the checks a promise must pass. This module imports nothing from passes.ts, so both passes can use it
 * without an import cycle.
 */
import { defineIR } from '../framework/contracts/definitions.js';
import type { Artifact } from '../framework/core/types.js';
import type { Store } from './model.js';
import { TxError } from './tx.js';

/**
 * A parameter binding (`fn`, `param`): that parameter's value. A field binding (`record`, `field`): that field of
 * every record of the type a function receives as a parameter (Candela: `K.scene`), in every function. A buffer
 * binding (`fn`, `param`, `cells`, IRWB-036-E): that buffer parameter's contents are fixed — a host promise the
 * specializers consume as a constant memory (the peval pass, which propagates it through loads).
 */
export interface Binding {
  /** The function whose parameter is bound. */
  readonly fn?: string;
  /** The parameter's name. */
  readonly param?: string;
  /** The record type whose field is bound (field form). */
  readonly record?: string;
  /** The field's name (field form). */
  readonly field?: string;
  /** Its value (an enum case's value for enum parameters). */
  readonly value?: number;
  /** The fixed contents, one u16 per cell (buffer form). */
  readonly cells?: readonly number[];
  /** The entity of the outer artifact that establishes the fact (e.g. `candela:scene/cornell#K.scene`). */
  readonly entity: string;
  readonly note?: string;
}
export const isBufferBinding = (b: Binding): b is Binding & { readonly cells: readonly number[] } =>
  Array.isArray(b.cells) && b.cells.length > 0 && b.cells.every(c => Number.isInteger(c));
export interface Bindings {
  readonly formatVersion: 1;
  /** What produced the facts (e.g. `candela`). */
  readonly source: string;
  readonly bindings: readonly Binding[];
}

export const BindingsIR = defineIR<Bindings>({
  id: 'typed.bindings',
  version: '1',
  description:
    'parameter values a program will always be called with, and the outer entities that establish them',
  validate(value) {
    const v = value as Bindings;
    if (!v || v.formatVersion !== 1 || typeof v.source !== 'string' || !Array.isArray(v.bindings))
      throw new Error('typed.bindings: formatVersion 1, source and bindings required');
    for (const b of v.bindings) {
      const param = typeof b.fn === 'string' && typeof b.param === 'string';
      const field = typeof b.record === 'string' && typeof b.field === 'string';
      const forms = [param, field].filter(Boolean).length;
      if (forms !== 1 || typeof b.entity !== 'string')
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
      if (field) {
        if (!Number.isInteger(b.value)) throw new Error(`typed.bindings: a field binding needs a value`);
        continue;
      }
      if (isBufferBinding(b)) continue;
      if (!Number.isInteger(b.value)) throw new Error(`typed.bindings: a parameter binding needs a value`);
    }
  },
});

/** The reason a specialization cites: the outer artifact, its exact revision, and the entity. */
export const factRef = (art: Artifact<Bindings>, b: Binding) =>
  `fact:${art.kind}:${art.id}@${art.revision.slice(0, 12)}#${b.entity}`;

/**
 * A buffer binding's promise is checked the way a field binding's is: refuse if the function could write through
 * an address derived from the bound parameter. A store's address is suspect when its value tree contains a
 * `caddr` (or a load) on the parameter; `aaddr` addresses the function's own frame, which no parameter aliases.
 * Shared by the `specialize` and `peval` passes (IRWB-036-E).
 */
export function checkBufferBinding(
  st: Store,
  fnName: string,
  locals: readonly { name: string; param: boolean }[],
  param: string,
): { index: number; because: string[] } {
  const i = locals.findIndex(l => l.param && l.name === param);
  if (i < 0) throw new TxError('unknownLocal', `${fnName} has no parameter "${param}"`);
  const suspect = (id: string | undefined, depth = 0): string | null => {
    if (!id || depth > 64) return null;
    const v = st.get(id) as { op?: string; imm?: unknown; args?: string[] } | undefined;
    if (!v) return null;
    if (v.op === 'call') return id;
    if (v.op === 'get' && v.imm === i) return id;
    for (const a of v.args ?? []) {
      const hit = suspect(a, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const why: string[] = [];
  for (const b of st.fns.get(fnName)?.blocks ?? [])
    for (const sid of b.stmts) {
      const s = st.get(sid) as { op?: string; addr?: string } | undefined;
      if (!s || s.op !== 'store') continue;
      const hit = suspect(s.addr);
      if (hit) why.push(`${sid} stores through ${hit}`);
    }
  if (why.length)
    throw new TxError(
      'unsupported',
      `the buffer promise on ${fnName}.${param} cannot hold: ${why.slice(0, 3).join('; ')}`,
    );
  return { index: i, because: [`param:${fnName}/${param}`] };
}
