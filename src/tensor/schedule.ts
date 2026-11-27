// The schedule retains Tix binder identities. Layout rewrites change kernel records only.
import { sameCanonical } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import { defineIR } from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../framework/ir/index.js';
import { applyNativePassSync, definePass } from '../framework/passes/index.js';
import { outerReductions, planFusion, unfusedPlan, type FusionGroup } from './fusion.js';
import { plain, visit, type Fn, type Statement } from './model.js';

interface Dot {
  left: string;
  right: string;
  transposed: boolean;
}
export interface Tile extends Dot {
  // output tile = lanes * registers along each output axis
  lanes: [number, number];
  registers: [number, number];
  depth: number;
  shared: boolean;
}
export interface KernelSchedule extends FusionGroup {
  form: 'element' | 'registers' | 'row';
  threadCap: number;
  tiles: Record<string, Tile>;
}
export interface Schedule {
  fn: Fn;
  groups: KernelSchedule[];
}
export const blockThreads = { rows: 128, contraction: 64, heavy: 256 };
function importGroup(fn: Fn, group: FusionGroup): KernelSchedule {
  const rows = [...group.staged, ...group.buffered];
  let globalReduction = false;
  for (const m of fn.statements.filter(s => group.statements.includes(s.name)))
    for (const r of outerReductions(m.expr))
      visit(r.body, e => { if (e.kind === 'load' && !rows.includes(e.name)) globalReduction = true; });
  return { ...group, form: group.statements.length === 1 ? 'element' : group.mapping === 'block' ? 'row' : 'registers',
    threadCap: group.heavy.length ? blockThreads.heavy : globalReduction ? blockThreads.contraction : blockThreads.rows, tiles: {} };
}

// Require the source strides too. Explicit output shapes can be smaller than an operand.
function contraction(fn: Fn, s: Statement): Dot | undefined {
  const rs = outerReductions(s.expr);
  if (rs.length !== 1 || s.axes.length !== 2) return;
  const [r] = rs;
  if (r.op !== 'sum' || r.axes.length !== 1 || r.axes[0].extent.kind !== 'dim' ||
      r.body.kind !== 'op' || r.body.op !== '*') return;
  const [i,j] = s.axes.map(a => a.id);
  const k = r.axes[0].id, extent = r.axes[0].extent.dim;
  const tensors = [...fn.params, ...fn.statements];
  for (const [a,b] of [r.body.args, [...r.body.args].reverse()]) {
    if (a.kind !== 'load' || b.kind !== 'load') continue;
    const ai = a.indices.map(plain), bi = b.indices.map(plain);
    const transposed = bi[0] === j && bi[1] === k;
    if (ai.length !== 2 || bi.length !== 2 || ai[0] !== i || ai[1] !== k ||
        !(transposed || (bi[0] === k && bi[1] === j))) continue;
    if (!sameCanonical(tensors.find(t => t.name === a.name)!.shape[1], extent) ||
        !sameCanonical(tensors.find(t => t.name === b.name)!.shape[1], transposed ? extent : s.shape[1])) continue;
    return { left: a.name, right: b.name, transposed };
  }
}

function validate(value: unknown) {
  const s = value as Schedule;
  if (!s.fn || !Array.isArray(s.groups)) throw Error('Invalid schedule');
  for (const g of s.groups) for (const [name,t] of Object.entries(g.tiles)) {
    const stmt = s.fn.statements.find(m => m.name === name);
    const dot = stmt && contraction(s.fn, stmt);
    if (!dot || !g.statements.includes(name) || dot.left !== t.left || dot.right !== t.right || dot.transposed !== t.transposed)
      throw Error('Tile operands must implement the original ordered dot product');
    if (![...t.lanes, ...t.registers, t.depth].every(n => Number.isSafeInteger(n) && n > 0) ||
        t.lanes[0] * t.lanes[1] > 1024) throw Error('Invalid rectangular tile partition');
  }
}
const entities = (s: Schedule) => [
  { id: 'algorithm', kind: 'algorithm', attributes: { fn: s.fn } },
  ...s.groups.map(g => ({ id: g.kernel, kind: 'kernel', attributes: { ...g } })),
];
export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule', version: '1', description: 'Ordered Tix algorithms and CUDA kernel layouts',
  entities: s => entities(s).map(e => e.id), validate,
});
const adapter = defineAdapter<Schedule>({
  id: 'tensor.schedule.adapter', version: '1', kind: ScheduleIR.id, schemaVersion: ScheduleIR.version,
  description: 'One entity per kernel and one for the unchanged algorithm', relationKinds: {}, relations: () => [],
  entities, resolve: (s,id) => entities(s).find(e => e.id === id), describe: (_,id) => ({ label: id }), validate,
});

function rewrite(id: string, description: string, edit: (fn: Fn, g: KernelSchedule) => KernelSchedule) {
  return definePass<Schedule>({
    id: 'tensor.schedule.' + id, version: '1', description, ir: ScheduleIR, adapter,
    writes: { entities: ['kernel'], relations: [] },
    run({ before }) {
      const { fn, groups } = before.value;
      return { native: { fn, groups: groups.map(g => edit(fn, g)) },
        correspondence: entities(before.value).map(e => ({ from:[e.id], to:[e.id], relation:'same-domain' })) };
    },
  });
}

const tile = rewrite('tile', 'Partition independent outputs and strip-mine the serial K loop', (fn,g) => {
  const tiles: Record<string,Tile> = {};
  for (const name of g.statements) {
    const dot = contraction(fn, fn.statements.find(s => s.name === name)!);
    if (dot && g.form !== 'registers')
      tiles[name] = { ...dot, lanes:[16,16], registers:[1,1], depth:16, shared:false };
  }
  return { ...g, tiles };
});
function mapTiles(g: KernelSchedule, f: (t: Tile) => Tile) {
  return { ...g, tiles: Object.fromEntries(Object.entries(g.tiles).map(([n,t]) => [n,f(t)])) };
}
const register = rewrite('register-tile', 'Give each lane independent accumulators for a rectangle', (_,g) =>
  mapTiles(g,t => ({ ...t, registers:[4,4] })));
const stage = rewrite('stage-panels', 'Cooperatively stage the two operand panels between block barriers', (_,g) =>
  mapTiles(g,t => ({ ...t, shared:true })));

export function orderCheck(before: Artifact<Schedule>, after: Artifact<Schedule>) {
  // Layout primitives can only enumerate k as panel * depth + local, clipped at K.
  // Erase the layout and check that every algorithm, group and placement decision survives.
  const erase = (s: Schedule) => ({ fn:s.fn, groups:s.groups.map(({ tiles, ...g }) => g) });
  return { ok: sameCanonical(erase(before.value), erase(after.value)), reason: 'Scheduling changed the original computation or fusion group' };
}
export function scheduleFunction(fn: Fn, fuse = true) {
  const plan = fuse ? planFusion(fn) : unfusedPlan(fn);
  let artifact = createIRArtifact(adapter, 'schedule/' + fn.name, { fn, groups:plan.groups.map(g => importGroup(fn,g)) });
  const steps = [];
  if (fuse) for (const pass of [tile, register, stage]) {
    const applied = applyNativePassSync(pass, artifact, orderCheck);
    artifact = applied.artifact;
    steps.push(applied);
  }
  return { artifact, steps };
}
