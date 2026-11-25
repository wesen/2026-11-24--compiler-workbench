/**
 * Passes written from inside the workbench: Compiler Workbench's builder,
 *   wb.pass('add-self').about('x + x becomes x * 2').writes('values').preserves('cfg', …).run((fn, tx, facts) => …)
 * producing an ordinary framework pass (`typedPass` → `definePass`). A user pass is held to the same rules as a
 * built-in one: its transaction refuses undeclared write kinds and reasonless removals, the framework refuses
 * changes outside the declared entity kinds, checks every preservation claim (audit mode included), and gates the
 * result with the meaning contract against r0. Built-in passes stay read-only; user passes are registered beside
 * them, and a user pass cannot shadow a built-in name.
 */
import { ANALYSES, stmtValues } from './analyses.js';
import { describeText } from './listing.js';
import type { StmtRec, Store, ValueRec, WorkFn } from './model.js';
import { PASSES, typedPass, type TypedPass } from './passes.js';
import { Tx, TxError, valueHandle, WRITE_KINDS, type ValueHandle, type WriteKind } from './tx.js';

export interface StmtHandle {
  readonly id: string;
  readonly op: StmtRec['op'];
  readonly local?: number;
  readonly localName: string | null;
  readonly value: ValueHandle | null;
  readonly cond: ValueHandle | null;
  readonly addr: ValueHandle | null;
  readonly block: string | null;
  readonly text: string;
}
export interface FnHandle {
  readonly id: string;
  readonly name: string;
  readonly params: readonly string[];
  readonly result: string;
  locals(): { id: string; index: number; name: string; type: string; param: boolean }[];
  blocks(): { list(): string[] };
  stmts(): { list(): StmtHandle[] };
  values(): { list(): ValueHandle[] };
  readonly _ent: WorkFn;
  readonly _st: Store;
}

export function stmtHandle(st: Store, f: WorkFn, sid: string): StmtHandle {
  const s = st.get(sid) as StmtRec;
  const v = (id: string | undefined) => (id ? valueHandle(st, id, { stmt: sid }) : null);
  return {
    id: sid,
    op: s.op,
    local: s.local,
    localName: s.local !== undefined ? f.locals[s.local].name : null,
    get value() {
      return v(s.value);
    },
    get cond() {
      return v(s.cond);
    },
    get addr() {
      return v(s.addr);
    },
    get block() {
      return f.blocks.find(b => b.stmts.includes(sid))?.id ?? null;
    },
    get text() {
      return describeText(st, sid);
    },
  };
}

export function fnHandle(st: Store, f: WorkFn): FnHandle {
  return {
    id: f.id,
    name: f.name,
    params: f.params.slice(),
    result: f.result,
    locals: () =>
      f.locals.map(l => ({
        id: `local:${f.name}/${l.name}`,
        index: l.index,
        name: l.name,
        type: l.type,
        param: l.param,
      })),
    blocks: () => ({ list: () => f.blocks.map(b => b.id) }),
    stmts: () => ({ list: () => f.blocks.flatMap(b => b.stmts).map(sid => stmtHandle(st, f, sid)) }),
    values: () => ({
      list: () => {
        const out: ValueHandle[] = [];
        const walk = (id: string | undefined, sid: string) => {
          if (!id) return;
          out.push(valueHandle(st, id, { stmt: sid }));
          (st.get(id) as ValueRec).args.forEach(a => walk(a, sid));
        };
        for (const b of f.blocks)
          for (const sid of b.stmts) stmtValues(st.get(sid) as StmtRec).forEach(v => walk(v, sid));
        return out;
      },
    }),
    _ent: f,
    _st: st,
  };
}

export type UserPassBody = (
  fn: FnHandle,
  tx: Tx,
  facts: Record<string, unknown>,
  params: Record<string, unknown>,
) => void;

/** User passes by name (beside the built-in PASSES). */
export const USER_PASSES = new Map<string, TypedPass>();

export class BuilderError extends Error {
  constructor(
    readonly code: 'unknownAnalysis' | 'badArgument' | 'reservedName' | 'incomplete',
    message: string,
    readonly fix?: string,
  ) {
    super(`[${code}] ${message}${fix ? `\n  fix: ${fix}` : ''}`);
    this.name = 'BuilderError';
  }
}

export function passBuilder(name: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    throw new BuilderError('badArgument', `pass names are lower-case words joined by -, not "${name}"`);
  if (PASSES[name])
    throw new BuilderError(
      'reservedName',
      `"${name}" is a built-in pass; built-in passes are read-only`,
      `choose another name, e.g. "${name}-mine"`,
    );
  const spec = {
    about: '',
    needs: {} as Record<string, keyof typeof ANALYSES>,
    writes: [] as WriteKind[],
    preserves: [] as (keyof typeof ANALYSES)[],
  };
  const analysisName = (a: string) => {
    if (!(a in ANALYSES))
      throw new BuilderError(
        'unknownAnalysis',
        `no analysis "${a}"`,
        `analyses: ${Object.keys(ANALYSES).join(', ')}`,
      );
    return a as keyof typeof ANALYSES;
  };
  const b = {
    about(text: string) {
      spec.about = text;
      return b;
    },
    needs(m: Record<string, string>) {
      for (const [alias, a] of Object.entries(m)) spec.needs[alias] = analysisName(a);
      return b;
    },
    writes(...kinds: string[]) {
      for (const k of kinds)
        if (!WRITE_KINDS.includes(k as WriteKind))
          throw new BuilderError('badArgument', `writes: "${k}" is not one of ${WRITE_KINDS.join(', ')}`);
      spec.writes = kinds as WriteKind[];
      return b;
    },
    preserves(...analyses: string[]) {
      spec.preserves = analyses.map(analysisName);
      return b;
    },
    run(body: UserPassBody): TypedPass {
      if (!spec.writes.length)
        throw new BuilderError(
          'incomplete',
          `pass "${name}" declares no writes`,
          ".writes('values') (or 'stmts', 'locals', 'cfg')",
        );
      const pass = typedPass({
        name,
        about: spec.about || `user pass ${name}`,
        needs: spec.needs,
        writes: spec.writes,
        preserves: spec.preserves,
        body: ({ st, f, tx, facts, params }) =>
          body(fnHandle(st, f), tx, facts as Record<string, unknown>, params),
      });
      USER_PASSES.set(name, pass);
      return pass;
    },
  };
  return b;
}

/** A pass by name: built-in first, then user passes. */
export function findPass(name: string): TypedPass | undefined {
  return PASSES[name] ?? USER_PASSES.get(name);
}

export { TxError };
