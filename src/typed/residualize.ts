/** Online partial evaluation over Typed blocks. No bytecode instruction semantics live here. */
import { binop } from './evaluate.js';
import type { BlockRec, StmtRec, ValueRec } from './model.js';
import type { TypedPassSpec } from './passes.js';
import type { Binding } from './specialize.js';
import { TxError } from './tx.js';

type Static = number | { frame: number } | { buffer: number };
type Value = Static | { tree: string };
type Env = Map<number, Static>;
type Context = Parameters<TypedPassSpec['body']>[0];

const binary = new Set('add sub mul and or xor shl shr shru eq ne lt gt le ge ltu geu'.split(' '));
function unsupported(message: string): never {
  throw new TxError('unsupported', message);
}

export function residualize({ st, f, tx, facts, params }: Context, bindings: Binding[], because: string[]) {
  // Symbols identify parameters and private frame offsets, never absolute guest addresses.
  const images = new Map<number, readonly number[]>();
  const initial: Env = new Map();
  for (const b of bindings) {
    const i = f.locals.findIndex(l => l.param && l.name === b.param);
    if (i < 0) unsupported(`${f.name} has no parameter "${b.param}"`);
    if (typeof b.value === 'number') {
      if (f.params[i] === 'f32' || f.params[i] === 'buffer')
        unsupported(`${f.name} needs an integer parameter for "${b.param}"`);
      initial.set(i, b.value | 0);
    } else {
      if (f.params[i] !== 'buffer') unsupported(`${f.name} needs buffer parameter "${b.param}"`);
      images.set(i, b.value.cells);
      initial.set(i, { buffer: i });
    }
  }
  for (const e of st.ents.values()) {
    if (e.kind === 'value' && e.op === 'call' && e.imm === f.name)
      unsupported(`internal call to buffer-specialized entry ${f.name}`);
    if (e.kind === 'stmt' && e.fn === f.id && e.op === 'set' && images.has(e.local!))
      unsupported(`${f.name} reassigns a bound buffer parameter`);
  }

  const entry = f.blocks[0];
  const frameBytes = f.arrayBytes ?? 0;
  const words = new Map<number, number>();
  // Frame contents can survive previous calls. Only promote words explicitly initialized at entry.
  for (const sid of entry.stmts) {
    const s = st.get(sid) as StmtRec;
    if (s.op !== 'zero') break;
    for (let off = s.offset!; off < s.offset! + s.bytes!; off += 4)
      if (off % 4 === 0 && off + 4 <= frameBytes && off + 4 <= s.offset! + s.bytes!)
        words.set(off, tx.local(`frameWord${off / 4}`, { from: sid, because }));
  }
  const word = (off: number) => words.get(off) ?? unsupported(`unpromotable frame word at byte ${off}`);
  const longestImage = Math.max(1, ...Array.from(images.values(), cells => cells.length));
  const maxStates = params.maxStates ?? f.blocks.length * longestImage;
  if (typeof maxStates !== 'number' || !Number.isSafeInteger(maxStates) || maxStates < 1)
    unsupported('maxStates must be a positive integer');
  const budget = maxStates;
  const versions = new Map<string, string>();
  const queue: { original: BlockRec; block: string; env: Env }[] = [];
  function version(id: string, incoming: Env): string {
    const env: Env = new Map();
    for (const i of facts.live!.liveIn(id)) if (incoming.has(i)) env.set(i, incoming.get(i)!);
    const key = JSON.stringify([id, [...env]]);
    const seen = versions.get(key);
    if (seen) return seen;
    if (versions.size >= budget) unsupported(`specialization exceeded ${budget} block states`);
    const block = tx.block({ from: id, because });
    versions.set(key, block);
    queue.push({ original: st.get(id) as BlockRec, block, env });
    return block;
  }

  const first = version(entry.id, initial);
  for (const { original, block, env } of queue) {
    function emit(v: Value, from: string): string {
      const why = { from, because };
      if (typeof v === 'number') return tx.const(v, why);
      if ('tree' in v) return v.tree;
      if ('buffer' in v) return tx.get(v.buffer, why);
      return unsupported(`private frame address escapes at ${from}`);
    }
    function value(id: string): Value {
      const v = st.get(id) as ValueRec;
      const why = { from: id, because, imm: v.imm, type: v.type };
      if (v.type === 'f32') unsupported('buffer specialization needs integer values');
      if (v.op === 'const') return v.imm as number;
      if (v.op === 'get') return env.get(v.imm as number) ?? { tree: tx.get(v.imm as number, why) };
      if (v.op === 'aaddr') return { frame: v.imm as number };
      if (v.op === 'load16u' && v.imm === 4) {
        const addr = st.get(v.args[0]) as ValueRec;
        if (addr.op === 'caddr') {
          const base = value(addr.args[0]);
          const index = value(addr.args[1]);
          if (typeof base === 'object' && 'buffer' in base) {
            const cells = images.get(base.buffer)!;
            if (typeof index === 'number' && (index >>> 0) < cells.length) return cells[index];
            const checked = tx.make('caddr', emit(base, addr.args[0]), emit(index, addr.args[1]), {
              from: addr.id,
              because,
            });
            return { tree: tx.make(v.op, checked, why) };
          }
        }
      }
      const args = v.args.map(value);
      const [a, b] = args;
      if (v.op === 'load' && typeof a === 'object') {
        if ('frame' in a) return { tree: tx.get(word(a.frame + Number(v.imm)), { from: id, because }) };
        if ('buffer' in a && v.imm === 0) return images.get(a.buffer)!.length;
      }
      if (v.op === 'add' && typeof a === 'object' && 'frame' in a && typeof b === 'number')
        return { frame: (a.frame + b) | 0 };
      if (v.op === 'eqz' && typeof a === 'number') return +(a === 0);
      if (binary.has(v.op) && typeof a === 'number' && typeof b === 'number') return binop(v.op, a, b);
      if (!binary.has(v.op) && !['div', 'rem', 'eqz'].includes(v.op))
        unsupported(`unsupported ${v.op} at ${id} in buffer specialization`);
      return { tree: tx.make(v.op, ...args.map((x, i) => emit(x, v.args[i])), why) };
    }
    for (const sid of original.stmts) {
      const s = st.get(sid) as StmtRec;
      const why = { from: sid, because };
      const append = (fields: Partial<StmtRec> & { op: StmtRec['op'] }) =>
        tx.insert(tx.at.end(block), tx.stmt(fields, why), why);
      switch (s.op) {
        case 'zero':
          if (s.bytes! % 4 !== 0) unsupported('partial frame word zero');
          for (let off = s.offset!; off < s.offset! + s.bytes!; off += 4)
            append({ op: 'set', local: word(off), value: tx.const(0, why) });
          break;
        case 'set': {
          const v = value(s.value!);
          if (typeof v === 'object' && 'tree' in v) {
            env.delete(s.local!);
            append({ op: 'set', local: s.local, value: v.tree });
          } else env.set(s.local!, v);
          break;
        }
        case 'store': {
          if (s.width !== 32) unsupported(`store at ${sid} may write the bound buffer`);
          const addr = value(s.addr!);
          if (typeof addr !== 'object' || !('frame' in addr))
            unsupported(`store at ${sid} may write the bound buffer`);
          append({ op: 'set', local: word(addr.frame + s.offset!), value: emit(value(s.value!), s.value!) });
          break;
        }
        case 'br':
          append({ op: 'br', to: version(s.to!, env) });
          break;
        case 'br_if': {
          const cond = value(s.cond!);
          if (typeof cond === 'number') append({ op: 'br', to: version(cond ? s.then! : s.else!, env) });
          else {
            append({
              op: 'br_if',
              cond: emit(cond, s.cond!),
              then: version(s.then!, env),
              else: version(s.else!, env),
            });
          }
          break;
        }
        case 'trap':
          append({ op: 'trap', ...(s.why ? { why: s.why } : {}) });
          break;
        case 'eval':
        case 'return':
          append({ op: s.op, value: emit(value(s.value!), s.value!) });
          break;
      }
    }
  }
  // Tx.commit derives successors and prunes the displaced source blocks from this new entry.
  f.blocks = [st.get(first) as BlockRec, ...f.blocks.filter(b => b.id !== first)];
}
