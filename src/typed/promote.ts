/**
 * IRWB-036-F: frame-array promotion. When every access to a function's frame array area has a constant address
 * (as `pe` leaves the bytecode VM's operand stack and locals), each 4-byte cell becomes a local: a 32-bit store
 * becomes a `set`, an i32 load a `get`, and `zero` a `set` of 0 per cell. Valid because the area is private to
 * the call (the meaning compares guest memory only) and each access names exactly one cell. Any other use of a
 * frame address (a dynamic index, an address in arithmetic or a call, an f32 or 16-bit access, an access across
 * cells) leaves the function unchanged.
 *
 * The spec is wrapped by `typedPass` in passes.ts (`promote`), as `rotate` is.
 */
import type { TypedPassSpec } from './passes.js';
import type { StmtRec, ValueRec } from './model.js';

export const promoteSpec: TypedPassSpec = {
  name: 'promote',
  about:
    'frame-array promotion: frame array cells that are only accessed at constant addresses become locals',
  writes: ['stmts', 'values', 'locals', 'frame'],
  preserves: ['cfg', 'dominators'],
  body({ st, f, tx }) {
    const area = f.arrayBytes ?? 0;
    if (!area) return;
    const cellOf = (byte: number) => (byte % 4 === 0 && byte >= 0 && byte + 4 <= area ? byte / 4 : null);
    const used = new Set<number>();
    // every aaddr must be the whole address of a 32-bit store or of an i32 load, naming one cell
    const ok = (id: string, allowed: boolean, extra: number): boolean => {
      const v = st.get(id) as ValueRec;
      if (v.op === 'aaddr') {
        const c = allowed ? cellOf((v.imm as number) + extra) : null;
        if (c === null) return false;
        used.add(c);
        return true;
      }
      if (v.op === 'load' && !v.type) {
        const a = st.get(v.args[0]) as ValueRec;
        if (a.op === 'aaddr') return ok(v.args[0], true, v.imm as number);
      }
      return v.args.every(a => ok(a, false, 0));
    };
    for (const b of f.blocks)
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'zero') {
          if (s.offset! % 4 || s.bytes! % 4) return;
          continue;
        }
        if (s.op === 'store') {
          const a = st.get(s.addr!) as ValueRec;
          if (!(s.width === 32 && a.op === 'aaddr' ? ok(s.addr!, true, s.offset!) : ok(s.addr!, false, 0)))
            return;
          if (!ok(s.value!, false, 0)) return;
          continue;
        }
        for (const k of ['value', 'cond'] as const) if (s[k] && !ok(s[k]!, false, 0)) return;
      }
    if (!used.size) return;
    const because = [`${f.id}: every frame array access has a constant address`];
    const locals = new Map<number, number>();
    const local = (c: number) => {
      let l = locals.get(c);
      if (l === undefined) locals.set(c, (l = tx.local(`frame${4 * c}`, { because })));
      return l;
    };
    tx.rewrite(v => {
      if (v.op !== 'load' || v.args[0].op !== 'aaddr') return;
      const c = ((v.args[0].imm as number) + (v.imm as number)) / 4;
      return tx.get(local(c), { because, note: `frame cell ${4 * c}` });
    });
    for (const b of f.blocks)
      for (const sid of b.stmts.slice()) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'store') {
          const c = ((st.get(s.addr!) as ValueRec).imm as number) / 4 + s.offset! / 4;
          tx.replaceStmt(sid, { op: 'set', local: local(c), value: s.value }, { because });
        } else if (s.op === 'zero') {
          const cells: number[] = [];
          for (let byte = s.offset!; byte < s.offset! + s.bytes!; byte += 4)
            if (used.has(byte / 4)) cells.push(byte / 4);
          let at = sid;
          if (!cells.length) {
            tx.remove(sid, { because, note: 'zeroes only cells nothing reads' });
            continue;
          }
          at = tx.replaceStmt(
            sid,
            { op: 'set', local: local(cells[0]), value: tx.const(0, { because }) },
            { because },
          );
          for (const c of cells.slice(1)) {
            const n = tx.set(local(c), tx.const(0, { because }), { from: sid, because });
            tx.insert(tx.at.after(at), n, { because });
            at = n;
          }
        }
      }
    // every access was promoted: the function no longer needs its frame array area
    delete f.arrayBytes;
    tx.record('frame', { fn: f.name, bytes: area, because });
  },
};
