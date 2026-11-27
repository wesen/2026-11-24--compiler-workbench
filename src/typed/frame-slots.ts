/**
 * Frame-slot promotion (IRWB-036-G): a frame array area that is only ever read and written one whole word at a
 * constant offset becomes one local per word.
 *
 * It applies when every address of the area the function forms is a constant one (`aaddr`, `aaddr + constant`)
 * that is used as the address of a 32-bit i32 `load` or `store` at a word-aligned offset inside the area, either
 * directly or through a local assigned earlier in the same block (the front end's `t = address; store32[t] = …`),
 * and every `zero` covers whole words. Then no address of the area outlives its access, so nothing else can read
 * or write it: `store32` becomes a `set`, the load a `get`, `zero` a `set` of 0 per word, and the assignments of
 * addresses to locals are removed. If any use has another shape (a dynamic index, an address read in another
 * block, an f32) the pass changes nothing. The frame is not part of the memory the meaning contract compares.
 *
 * After `specialize-buffer` has made an interpreter's stack pointer and operands constants, this is what turns
 * the interpreter's stack and variables into registers. Run it before licm and lvn, which move the constant
 * addresses into locals shared across blocks.
 */
import type { StmtRec, ValueRec } from './model.js';
import { typedPass } from './passes.js';

export const frameSlots = typedPass({
  name: 'frame-slots',
  about: 'frame-slot promotion: a frame array area accessed only by word at constant offsets becomes locals',
  writes: ['values', 'stmts', 'locals'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ st, f, tx }) {
    const size = f.arrayBytes ?? 0;
    if (!size) return;
    const val = (id: string) => st.get(id) as ValueRec;
    const word = (off: number | undefined): off is number =>
      off !== undefined && off >= 0 && off % 4 === 0 && off + 4 <= size;
    /** A constant frame address written out: `aaddr` or `aaddr + constant`. */
    const literal = (id: string): number | undefined => {
      const v = val(id);
      if (v.op === 'aaddr') return v.imm as number;
      if (v.op !== 'add') return undefined;
      const [a, b] = v.args.map(val);
      if (a.op === 'aaddr' && b.op === 'const' && !b.type) return ((a.imm as number) + (b.imm as number)) | 0;
      if (b.op === 'aaddr' && a.op === 'const' && !a.type) return ((b.imm as number) + (a.imm as number)) | 0;
      return undefined;
    };
    // locals that are ever assigned a frame address: each read of one must be the address of an access
    const addressLocals = new Set<number>();
    const stmts = f.blocks.flatMap(b => b.stmts.map(sid => st.get(sid) as StmtRec));
    for (const s of stmts) if (s.op === 'set' && literal(s.value!) !== undefined) addressLocals.add(s.local!);

    // ---- check every block; record what each access resolves to
    const loads = new Map<string, number>(), // load value -> frame offset
      stores = new Map<string, number>(), // store statement -> frame offset
      addressSets: string[] = [];
    let ok = true,
      any = false;
    for (const b of f.blocks) {
      const known = new Map<number, number>(); // address local -> the offset it holds here
      const address = (id: string): number | undefined => {
        const lit = literal(id);
        if (lit !== undefined) return lit;
        const v = val(id);
        return v.op === 'get' ? known.get(v.imm as number) : undefined;
      };
      const check = (id: string | undefined): void => {
        if (!id || !ok) return;
        const v = val(id);
        if (v.op === 'load') {
          const at = address(v.args[0]);
          if (at !== undefined) {
            const off = at + ((v.imm as number | undefined) ?? 0);
            if (v.type || !word(off)) ok = false;
            else loads.set(id, off);
            any = true;
            return;
          }
        }
        if (v.op === 'aaddr' || (v.op === 'get' && addressLocals.has(v.imm as number))) ok = false;
        v.args.forEach(check);
      };
      for (const sid of b.stmts) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'zero') {
          any = true;
          if (s.offset! % 4 || s.bytes! % 4) ok = false;
        } else if (s.op === 'set' && literal(s.value!) !== undefined) {
          known.set(s.local!, literal(s.value!)!);
          addressSets.push(sid);
          continue;
        } else if (s.op === 'store' && address(s.addr!) !== undefined) {
          any = true;
          const off = address(s.addr!)! + (s.offset ?? 0);
          if (s.width !== 32 || val(s.value!).type || !word(off)) ok = false;
          else stores.set(sid, off);
        } else check(s.addr);
        (check(s.value), check(s.cond));
        if (s.op === 'set') known.delete(s.local!);
        if (!ok) return;
      }
    }
    if (!any) return;

    // ---- one local per word that is accessed
    const slots = new Map<number, number>();
    const slot = (off: number): number => {
      let l = slots.get(off);
      if (l === undefined) slots.set(off, (l = tx.local(`slot${off}`, { because: [f.id] })));
      return l;
    };
    const because = [f.id];
    tx.rewrite(v => {
      const off = loads.get(v.id);
      if (off === undefined) return;
      return tx.get(slot(off), { from: v.id, because, note: `frame+${off} is a local` });
    });
    for (const b of f.blocks)
      for (const sid of b.stmts.slice()) {
        const s = st.get(sid) as StmtRec;
        if (s.op === 'zero') {
          let at = tx.at.before(sid);
          for (let off = s.offset!; off < s.offset! + s.bytes!; off += 4) {
            tx.insert(at, tx.set(slot(off), tx.const(0, { from: sid, because }), { from: sid, because }), {
              because,
            });
            at = { block: at.block, index: at.index + 1 };
          }
          tx.remove(sid, { because, note: 'the frame words are locals' });
        } else if (stores.has(sid)) {
          tx.replaceStmt(sid, { op: 'set', local: slot(stores.get(sid)!), value: s.value }, { because });
        } else if (addressSets.includes(sid)) {
          tx.remove(sid, { because, note: 'the address was only used by accesses that are now locals' });
        }
      }
  },
});
