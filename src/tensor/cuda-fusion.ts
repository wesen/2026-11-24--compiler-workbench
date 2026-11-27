import { plain, visit, type Affine, type Expr, type Fn, type Statement } from './model.js';

type Load = Extract<Expr, { kind: 'load' }>;
export interface KernelGroup {
  statements: Statement[];
  // A contiguous matrix staged once per block in the row schedule.
  rowInput?: string;
}

function inspect(s: Statement) {
  const loads: Load[] = [];
  let reduces = false;
  visit(s.expr, e => {
    if (e.kind === 'load') loads.push(e);
    if (e.kind === 'reduce') reduces = true;
  });
  return { loads, reduces };
}

// A dead row can be overwritten in place if every lane reads only its own
// column during the replacement. The preceding stage barrier covers older reads.
export function rowSlots(statements: Statement[], input: string) {
  const slots = new Map([[input, 0]]);
  const lastRead = new Map<string, number>();
  const reads = statements.map(s => inspect(s).loads);
  reads.forEach((loads, i) => loads.forEach(l => lastRead.set(l.name, i)));
  const occupants = [input];
  for (const [i, s] of statements.slice(0, -1).entries()) {
    if (s.axes.length !== 2) continue;
    let slot = occupants.findIndex(name => {
      if ((lastRead.get(name) ?? -1) > i) return false;
      return reads[i].every(l => l.name !== name || plain(l.indices[1]) === s.axes[1].id);
    });
    if (slot === -1) slot = occupants.length;
    slots.set(s.name, slot);
    occupants[slot] = s.name;
  }
  return { slots, count: occupants.length };
}

function sameShape(a: Affine[], b: Affine[]) {
  // Affine terms have canonical order in the checked IR.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function kernelGroups(fn: Fn, fuse: boolean): KernelGroup[] {
  if (!fuse) return fn.statements.map(s => ({ statements: [s] }));
  const facts = new Map(fn.statements.map(s => [s.name, inspect(s)]));
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const lastUse = new Map<string, number>();
  fn.statements.forEach((s, i) => facts.get(s.name)!.loads.forEach(l => lastUse.set(l.name, i)));
  lastUse.set(fn.result, Infinity);
  const groups: KernelGroup[] = [];
  for (let start = 0; start < fn.statements.length; ) {
    const first = fn.statements[start];
    const info = facts.get(first.name)!;
    const rowStart = (first.axes.length === 1 && info.reduces) || (first.axes.length === 2 && !info.reduces);
    const rowLoad = rowStart ? info.loads.find(load =>
      load.indices.length === 2 &&
      plain(load.indices[0]) === first.axes[0].id &&
      plain(load.indices[1]) !== undefined &&
      sameShape(tensors.get(load.name)!.shape.slice(0, first.axes.length), first.shape)
    ) : undefined;
    const rowMatrix = rowLoad && tensors.get(rowLoad.name)!;
    const internal = new Set([first.name]);
    let best: KernelGroup = { statements: [first] };
    let element = true;
    let row = !!rowLoad && info.loads.every(load =>
      load.name !== rowLoad.name || plain(load.indices[0]) === first.axes[0].id);
    // The last definition is materialized. Every earlier group member must
    // have its final use inside the group, including the function's return.
    let latestPrivateUse = lastUse.get(first.name) ?? -1;
    for (let end = start + 1; end < fn.statements.length; ++end) {
      const s = fn.statements[end], { loads, reduces } = facts.get(s.name)!;
      const uses = loads.filter(l => internal.has(l.name));
      if (!uses.length) break;
      element &&= !reduces && sameShape(s.shape, first.shape) &&
        uses.every(l => l.indices.every((a, i) => plain(a) === s.axes[i].id));
      row &&= (sameShape(s.shape, first.shape.slice(0, 1)) ||
        (!reduces && !!rowMatrix && sameShape(s.shape, rowMatrix.shape))) &&
        loads.every(l => (!internal.has(l.name) && l.name !== rowLoad?.name) ||
          plain(l.indices[0]) === s.axes[0].id);
      if (!element && !row) break;
      if (latestPrivateUse <= end) {
        best = {
          statements: fn.statements.slice(start, end + 1),
          rowInput: element ? undefined : rowLoad?.name,
        };
      }
      latestPrivateUse = Math.max(latestPrivateUse, lastUse.get(s.name) ?? -1);
      internal.add(s.name);
    }
    groups.push(best);
    start += best.statements.length;
  }
  return groups;
}
