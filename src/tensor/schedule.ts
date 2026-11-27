// The schedule retains Tix binder identities. Layout rewrites change kernel records only.
import { sameCanonical } from '../framework/core/data.js';
import type { Artifact } from '../framework/core/types.js';
import { defineIR } from '../framework/contracts/index.js';
import { createIRArtifact, defineAdapter } from '../framework/ir/index.js';
import { applyNativePassSync, definePass } from '../framework/passes/index.js';
import {
  gate,
  outerReductions,
  planFusion,
  unfusedPlan,
  type FusionGroup,
  type FusionPlan,
} from './fusion.js';
import { plain, visit, type Fn, type Statement, type Axis, type Expr } from './model.js';

interface Dot {
  fold: Axis;
  left: string;
  right: string;
  transposed: boolean;
  leftTransposed: boolean;
}
export interface Tile extends Dot {
  // output tile = lanes * registers along each output axis
  lanes: [number, number];
  registers: [number, number];
  depth: number;
  shared: boolean;
  vector: 1 | 4;
  fragment: 1 | 4;
  wide?: { registers: [number, number]; minBlocks: number };
  dispatch: { blocks: number; terms: number; aligned: boolean }[];
}
export interface BroadcastPatch {
  axis: number;
  common: number;
  width: number;
  minBlocks: number;
}
export interface Phase {
  kind: 'tile' | 'row' | 'element';
  statements: string[];
  inputs: string[];
  outputs: string[];
}
export interface KernelSchedule extends FusionGroup {
  form: 'element' | 'registers' | 'row';
  threadCap: number;
  gatePolicy: typeof gate;
  // Load placements in expression preorder, one vector per member statement.
  loads: ('global' | 'row' | 'register')[][];
  tiles: Record<string, Tile>;
  phases: Phase[];
  patch?: BroadcastPatch;
}
export const hasDispatch = (g: KernelSchedule) => g.gated || !!g.patch || Object.keys(g.tiles).length > 0;
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
      visit(r.body, e => {
        if (e.kind === 'load' && !rows.includes(e.name)) globalReduction = true;
      });
  const loads = group.statements.map(name => {
    const member = fn.statements.find(s => s.name === name)!;
    const spaces: KernelSchedule['loads'][number] = [];
    visit(member.expr, e => {
      if (e.kind !== 'load') return;
      const local = group.statements.includes(e.name);
      const ownRow = e.indices.slice(0, group.depth).every((a, i) => plain(a) === member.axes[i].id);
      if (group.mapping === 'block' && rows.includes(e.name) && ownRow) spaces.push('row');
      else if (group.mapping === 'thread' && local) spaces.push('register');
      else if (!local) spaces.push('global');
      else throw Error('Fused read outside its row: ' + e.name);
    });
    return spaces;
  });
  return {
    ...group,
    loads,
    gatePolicy: gate,
    form: group.statements.length === 1 ? 'element' : group.mapping === 'block' ? 'row' : 'registers',
    threadCap: group.heavy.length
      ? blockThreads.heavy
      : globalReduction
        ? blockThreads.contraction
        : blockThreads.rows,
    tiles: {},
    phases: [],
  };
}

// Require the source strides too. Explicit output shapes can be smaller than an operand.
function contraction(fn: Fn, s: Statement): Dot | undefined {
  const rs = outerReductions(s.expr);
  if (rs.length !== 1 || s.axes.length !== 2) return;
  const [r] = rs;
  if (
    r.op !== 'sum' ||
    r.axes.length !== 1 ||
    r.axes[0].extent.kind !== 'dim' ||
    r.body.kind !== 'op' ||
    r.body.op !== '*'
  )
    return;
  const [i, j] = s.axes.map(a => a.id);
  const k = r.axes[0].id,
    extent = r.axes[0].extent.dim;
  const tensors = [...fn.params, ...fn.statements];
  for (const [a, b] of [r.body.args, [...r.body.args].reverse()]) {
    if (a.kind !== 'load' || b.kind !== 'load') continue;
    const ai = a.indices.map(plain),
      bi = b.indices.map(plain);
    const leftTransposed = ai[0] === k && ai[1] === i;
    const transposed = bi[0] === j && bi[1] === k;
    if (
      ai.length !== 2 ||
      bi.length !== 2 ||
      !(leftTransposed || (ai[0] === i && ai[1] === k)) ||
      !(transposed || (bi[0] === k && bi[1] === j))
    )
      continue;
    if (
      !sameCanonical(tensors.find(t => t.name === a.name)!.shape[1], leftTransposed ? s.shape[0] : extent) ||
      !sameCanonical(tensors.find(t => t.name === b.name)!.shape[1], transposed ? extent : s.shape[1])
    )
      continue;
    return { fold: r.axes[0], left: a.name, right: b.name, leftTransposed, transposed };
  }
}

// One full small panel case for the GPU checker. Keep its recipe a pure function
// of the baseline, including when checking hand-mutated CUDA with no schedule metadata.
export function panelAssignments(fn: Fn) {
  const assignments: Record<string, number>[] = [];
  for (const s of fn.statements) {
    const dot = contraction(fn, s);
    if (!dot) continue;
    const sizes = new Map<string, number>();
    const dims = [...s.shape, dot.fold.extent.dim];
    // Two successive 16-term panels exercise the barrier before panel reuse.
    const values = [64, 64, 32];
    let usable = true;
    for (const [i, d] of dims.entries()) {
      const symbol = plain(d);
      if (symbol) sizes.set(symbol, Math.max(sizes.get(symbol) ?? 0, values[i]));
      else if (d.terms.length || d.constant % values[i]) usable = false;
    }
    if (usable) assignments.push(Object.fromEntries(sizes));
  }
  return assignments;
}

// Coalesced input rows can be reused across an independent output channel.
function broadcastAxis(s: Statement): BroadcastPatch | undefined {
  const r = s.expr;
  if (s.axes.length < 3 || r.kind !== 'reduce' || r.op !== 'sum' || r.body.kind !== 'op' || r.body.op !== '*')
    return;
  const last = s.axes.at(-1)!.id;
  for (const common of [0, 1]) {
    const a = r.body.args[common],
      b = r.body.args[1 - common];
    if (
      a.kind !== 'load' ||
      b.kind !== 'load' ||
      !a.indices.at(-1)?.terms.some(([id, k]) => id === last && k === 1)
    )
      continue;
    const depends = (load: typeof a, axis: string) =>
      load.indices.some(d => d.terms.some(([id]) => id === axis));
    if (depends(b, last)) continue;
    const axis = s.axes.findIndex(({ id }) => id !== last && !depends(a, id) && depends(b, id));
    if (axis >= 0) return { axis, common, width: 4, minBlocks: 48 };
  }
}

function reads(s: Statement) {
  const names = new Set<string>();
  visit(s.expr, e => {
    if (e.kind === 'load') names.add(e.name);
  });
  return names;
}
function elementEpilogue(s: Statement, producer: Statement, locals: string[]) {
  if (!sameCanonical(s.shape, producer.shape) || outerReductions(s.expr).length) return false;
  let own = true;
  visit(s.expr, e => {
    if (e.kind === 'load' && locals.includes(e.name))
      own &&= e.indices.every((a, i) => plain(a) === s.axes[i]?.id);
  });
  return own;
}

// Split the tiled route only where cross-block synchronization requires a launch.
// The original row group remains the owner of the row placement and in-place decisions.
function phasesFor(fn: Fn, g: KernelSchedule, combine: boolean) {
  const members = g.statements.map(n => fn.statements.find(s => s.name === n)!);
  const phases: Phase[] = [];
  for (let i = 0; i < members.length; ) {
    const start = i,
      first = members[i++];
    const statements = [first.name];
    const dot = Object.hasOwn(g.tiles, first.name);
    if (combine)
      while (
        i < members.length &&
        !Object.hasOwn(g.tiles, members[i].name) &&
        (!dot || elementEpilogue(members[i], first, statements))
      )
        statements.push(members[i++].name);
    const prior = g.statements.slice(0, start);
    const needed = new Set(members.slice(start, i).flatMap(s => [...reads(s)]));
    const later = new Set(members.slice(i).flatMap(s => [...reads(s)]));
    phases.push({
      kind: dot ? 'tile' : statements.length > 1 ? 'row' : 'element',
      statements,
      inputs: prior.filter(n => needed.has(n)),
      outputs: statements.filter(n => g.stored.includes(n) || later.has(n)),
    });
  }
  return phases;
}

function validate(value: unknown) {
  const s = value as Schedule;
  if (!s.fn || !Array.isArray(s.groups)) throw Error('Invalid schedule');
  if (
    !sameCanonical(
      s.groups.flatMap(g => g.statements),
      s.fn.statements.map(m => m.name),
    )
  )
    throw Error('Kernel groups must partition statements in definition order');
  for (const g of s.groups) {
    if (
      g.patch &&
      (g.form !== 'element' ||
        !sameCanonical(g.patch, broadcastAxis(s.fn.statements.find(m => m.name === g.statements[0])!)))
    )
      throw Error('Register patch requires an invariant contraction operand');
    if (!!g.phases.length !== !!Object.keys(g.tiles).length)
      throw Error('Tile schedule lacks a launch phase');
    if (g.form === 'registers' && g.phases.length > 1) throw Error('Register epilogue needs one phase');
    if (
      g.phases.length &&
      !sameCanonical(g.phases, phasesFor(s.fn, g, true)) &&
      !sameCanonical(g.phases, phasesFor(s.fn, g, false))
    )
      throw Error('Invalid phase dependencies or stores');
  }
  for (const g of s.groups)
    for (const [name, t] of Object.entries(g.tiles)) {
      const stmt = s.fn.statements.find(m => m.name === name);
      const dot = stmt && contraction(s.fn, stmt);
      if (
        !dot ||
        !g.statements.includes(name) ||
        !sameCanonical(dot.fold, t.fold) ||
        dot.left !== t.left ||
        dot.right !== t.right ||
        dot.transposed !== t.transposed ||
        dot.leftTransposed !== t.leftTransposed
      )
        throw Error('Tile operands must implement the original ordered dot product');
      if (
        t.wide &&
        (!Number.isSafeInteger(t.wide.minBlocks) ||
          t.wide.minBlocks <= 0 ||
          t.wide.registers.length !== 2 ||
          !t.wide.registers.every(n => Number.isSafeInteger(n) && n > 0 && n % 4 === 0))
      )
        throw Error('Wide tile requires whole register fragments');
      if (t.fragment === 4 && (!t.shared || t.registers.some(n => n % 4)))
        throw Error('Vector register fragments require whole four-word patches');
      if (
        t.vector === 4 &&
        (!t.shared ||
          t.depth % 4 ||
          (t.lanes[1] * t.registers[1]) % 4 ||
          (t.leftTransposed && (t.lanes[0] * t.registers[0]) % 4 !== 0))
      )
        throw Error('Four-word loads require complete aligned shared panel rows');
      if (
        t.lanes.length !== 2 ||
        t.registers.length !== 2 ||
        ![...t.lanes, ...t.registers, t.depth].every(n => Number.isSafeInteger(n) && n > 0) ||
        t.lanes[0] * t.lanes[1] > 1024
      )
        throw Error('Invalid rectangular tile partition');
      // Two aligned/edge specializations each have an A and a B array. The
      // default static shared-memory budget is 48 KiB per block.
      for (const [ry, rx] of [t.registers, ...(t.wide ? [t.wide.registers] : [])]) {
        const panelWords = (t.lanes[0] * ry + t.fragment + t.lanes[1] * rx) * t.depth;
        if (t.shared && 2 * Float32Array.BYTES_PER_ELEMENT * panelWords > 48 * 1024)
          throw Error('Staged panels exceed the static shared-memory budget');
      }
    }
}
export function foldsOf(stmt: Statement) {
  const folds: { id: string; expression: Extract<Expr, { kind: 'reduce' }> }[] = [];
  visit(stmt.expr, e => {
    if (e.kind === 'reduce') folds.push({ id: 'fold/' + stmt.name + '/' + folds.length, expression: e });
  });
  return folds;
}
const entities = (s: Schedule) => [
  { id: 'algorithm', kind: 'algorithm', attributes: { fn: s.fn } },
  ...s.groups.map(g => ({ id: g.kernel, kind: 'kernel', attributes: { ...g } })),
  ...s.fn.statements.flatMap(stmt =>
    foldsOf(stmt).map(({ id, expression: r }) => ({
      id,
      kind: 'fold',
      attributes: { statement: stmt.name, operation: r.op, axes: r.axes, body: r.body },
    })),
  ),
];
export const ScheduleIR = defineIR<Schedule>({
  id: 'tensor.schedule',
  version: '1',
  description: 'Ordered Tix algorithms and CUDA kernel layouts',
  entities: s => entities(s).map(e => e.id),
  validate,
});
const adapter = defineAdapter<Schedule>({
  id: 'tensor.schedule.adapter',
  version: '1',
  kind: ScheduleIR.id,
  schemaVersion: ScheduleIR.version,
  description: 'One entity per kernel and one for the unchanged algorithm',
  relationKinds: {},
  relations: () => [],
  entities,
  resolve: (s, id) => entities(s).find(e => e.id === id),
  describe: (_, id) => ({ label: id }),
  validate,
});

function rewrite(id: string, description: string, edit: (fn: Fn, g: KernelSchedule) => KernelSchedule) {
  return definePass<Schedule>({
    id: 'tensor.schedule.' + id,
    version: '1',
    description,
    ir: ScheduleIR,
    adapter,
    writes: { entities: ['kernel'], relations: [] },
    postcondition: orderCheck,
    run({ before }) {
      const { fn, groups } = before.value;
      return {
        native: { fn, groups: groups.map(g => edit(fn, g)) },
        correspondence: entities(before.value).map(e => ({
          from: [e.id],
          to: [e.id],
          relation: 'same-domain',
        })),
      };
    },
  });
}

const tile = rewrite('tile', 'Partition independent outputs and strip-mine the serial K loop', (fn, g) => {
  const tiles: Record<string, Tile> = Object.create(null);
  for (const name of g.statements) {
    const dot = contraction(fn, fn.statements.find(s => s.name === name)!);
    if (
      dot &&
      (g.form !== 'registers' ||
        (name === g.statements[0] &&
          g.statements
            .slice(1)
            .every((n, i) =>
              elementEpilogue(
                fn.statements.find(s => s.name === n)!,
                fn.statements.find(s => s.name === name)!,
                g.statements.slice(0, i + 1),
              ),
            )))
    )
      tiles[name] = {
        ...dot,
        lanes: [16, 16],
        registers: [1, 1],
        depth: 16,
        shared: false,
        vector: 1,
        fragment: 1,
        dispatch: [{ blocks: 1, terms: 16, aligned: false }],
      };
  }
  const next = { ...g, tiles };
  if (Object.keys(tiles).length) next.phases = phasesFor(fn, next, g.form === 'registers');
  return next;
});
function mapTiles(g: KernelSchedule, f: (t: Tile) => Tile) {
  return { ...g, tiles: Object.fromEntries(Object.entries(g.tiles).map(([n, t]) => [n, f(t)])) };
}
const broadcast = rewrite(
  'broadcast-patch',
  'Reuse an invariant operand across adjacent output channels',
  (fn, g) => {
    const patch = g.form === 'element' && broadcastAxis(fn.statements.find(s => s.name === g.statements[0])!);
    return patch ? { ...g, patch } : g;
  },
);
const register = rewrite('register-tile', 'Give each lane independent accumulators for a rectangle', (_, g) =>
  mapTiles(g, t => ({ ...t, registers: [4, 4] })),
);
const stage = rewrite(
  'stage-panels',
  'Cooperatively stage the two operand panels between block barriers',
  (_, g) => mapTiles(g, t => ({ ...t, shared: true })),
);

const vectorize = rewrite('vectorize', 'Load aligned panels four adjacent f32 words at a time', (_, g) =>
  mapTiles(g, t =>
    t.shared && t.depth % 4 === 0 && (t.lanes[1] * t.registers[1]) % 4 === 0 ? { ...t, vector: 4 } : t,
  ),
);
const fragments = rewrite(
  'pack-registers',
  'Read contiguous four-word fragments of each shared panel',
  (_, g) => mapTiles(g, t => (t.shared && t.registers.every(n => n % 4 === 0) ? { ...t, fragment: 4 } : t)),
);
const wideTile = rewrite(
  'wide-tile',
  'Double panel reuse when a grid of larger blocks covers two blocks per SM',
  (_, g) => mapTiles(g, t => (t.fragment === 4 ? { ...t, wide: { registers: [8, 8], minBlocks: 96 } } : t)),
);
// 08-shapes / 08-crossover: fully occupied grids amortize tiling for shorter K.
const chooseShapes = rewrite(
  'dispatch',
  'Retain the original launch for skinny grids and short reductions',
  (_, g) =>
    mapTiles(g, t => ({
      ...t,
      dispatch: [
        { blocks: 16, terms: 128, aligned: true },
        { blocks: 48, terms: 32, aligned: true },
        { blocks: 48, terms: 128, aligned: false },
      ],
    })),
);
const fusePhases = rewrite(
  'fuse-phases',
  'Keep same-element epilogues in registers and intervening rows in one block',
  (fn, g) => (g.phases.length ? { ...g, phases: phasesFor(fn, g, true) } : g),
);

// Each entry can be applied separately with applyNativePassSync, with the same structural gate.
export const schedulePasses = Object.freeze({
  tile,
  register,
  stage,
  vectorize,
  fragments,
  wideTile,
  fusePhases,
  chooseShapes,
  broadcast,
});

export function orderCheck(before: Artifact<Schedule>, after: Artifact<Schedule>) {
  // Layout primitives can only enumerate k as panel * depth + local, clipped at K.
  // Erase the layout and check that every algorithm, group and placement decision survives.
  const erase = (s: Schedule) => ({ fn: s.fn, groups: s.groups.map(({ tiles, phases, patch, ...g }) => g) });
  if (!sameCanonical(erase(before.value), erase(after.value)))
    return { ok: false, reason: 'Scheduling changed the original computation or fusion group' };
  const panels = after.value.groups.flatMap(g =>
    Object.entries(g.tiles).map(([statement, t]) => ({
      statement,
      axis: t.fold.id,
      extent: t.fold.extent,
      increasingPanelStep: t.depth,
      innerStep: 1,
    })),
  );
  return {
    ok: true,
    evidence: { order: 'lexicographic', initial: 'unchanged', accumulators: 'one per output', panels },
  };
}
export function initialSchedule(fn: Fn, plan: FusionPlan) {
  return createIRArtifact(adapter, 'schedule/' + fn.name, {
    fn,
    groups: plan.groups.map(g => importGroup(fn, g)),
  });
}
export function scheduleFunction(fn: Fn, fuse = true) {
  const initial = initialSchedule(fn, fuse ? planFusion(fn) : unfusedPlan(fn));
  let artifact = initial;
  const steps: ReturnType<typeof applyNativePassSync<Schedule, unknown>>[] = [];
  function apply(pass: typeof tile) {
    const applied = applyNativePassSync(pass, artifact);
    artifact = applied.artifact;
    steps.push(applied);
    return applied.changed;
  }
  if (fuse) {
    if (apply(tile))
      for (const pass of [register, stage, vectorize, fragments, wideTile, fusePhases, chooseShapes])
        apply(pass);
    if (fn.statements.some(s => s.axes.length >= 3)) apply(broadcast);
  }
  return { initial, artifact, steps };
}
