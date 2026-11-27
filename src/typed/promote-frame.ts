/** Promote private frame words once all addresses and their initialization are explicit. */
import type { StmtRec, ValueRec } from './model.js';
import type { TypedPassSpec } from './passes.js';

export const promoteFrameSpec: TypedPassSpec = {
  name: 'promote-frame',
  about: 'replace fixed, initialized i32 frame slots with scalar locals',
  writes: ['frame', 'locals', 'stmts', 'values'],
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx }) {
    if (!f.arrayBytes) return;
    const frameBytes = f.arrayBytes;
    const loads = new Map<string, number>();
    const stores = new Map<string, number>();
    const zeros: StmtRec[] = [];
    const words = new Set<number>();
    const slot = (addr: string, offset: number) => {
      const base = st.get(addr) as ValueRec;
      if (base.op !== 'aaddr') return;
      const at = (base.imm as number) + offset;
      if (at % 4 === 0 && at >= 0 && at + 4 <= frameBytes) return at;
    };
    function safe(id: string): boolean {
      const v = st.get(id) as ValueRec;
      if (v.op === 'load' && !v.type) {
        const at = slot(v.args[0], v.imm as number);
        if (at === undefined) return false;
        loads.set(id, at);
        words.add(at);
        return true;
      }
      if (['call', 'aaddr', 'load', 'load16u', 'caddr'].includes(v.op)) return false;
      return v.args.every(safe);
    }
    const covers = (s: StmtRec, at: number) => at >= s.offset! && at + 4 <= s.offset! + s.bytes!;
    const entry: StmtRec[] = [];
    for (const id of f.blocks[0].stmts) {
      const s = st.get(id) as StmtRec;
      if (s.op !== 'zero') break;
      entry.push(s);
    }
    for (const block of f.blocks) {
      for (const id of block.stmts) {
        const s = st.get(id) as StmtRec;
        if (s.op === 'zero') {
          if (s.offset! % 4 !== 0 || s.bytes! % 4 !== 0) return;
          zeros.push(s);
        }
        if (s.op === 'store') {
          const at = slot(s.addr!, s.offset!);
          if (at === undefined || s.width !== 32 || (st.get(s.value!) as ValueRec).type) return;
          stores.set(id, at);
          words.add(at);
        }
        if (s.value && !safe(s.value)) return;
        if (s.cond && !safe(s.cond)) return;
      }
    }
    if (![...words].every(at => entry.some(s => covers(s, at)))) return;

    const locals = new Map(
      [...words]
        .sort((a, b) => a - b)
        .map(at => [at, tx.local(`frame_${at}`, { because: [entry.find(s => covers(s, at))!.id] })]),
    );
    tx.rewrite(v => {
      const at = loads.get(v.id);
      if (at !== undefined) return tx.get(locals.get(at)!, { from: v.id, because: [v.args[0].id] });
    });
    for (const [id, at] of stores) {
      const s = st.get(id) as StmtRec;
      tx.replaceStmt(id, { op: 'set', local: locals.get(at)!, value: s.value }, { because: [s.addr!] });
    }
    for (const s of zeros) {
      for (const [at, local] of locals) {
        if (!covers(s, at)) continue;
        const value = tx.const(0, { from: s.id });
        tx.insert(tx.at.before(s.id), tx.set(local, value, { from: s.id }), { because: [s.id] });
      }
      tx.remove(s.id, { because: [s.id], note: 'the covered words are scalar locals' });
    }
    tx.dropFrame(zeros.map(s => s.id));
  },
};
