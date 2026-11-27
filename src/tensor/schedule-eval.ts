// IRWB-033-E: executing a schedule on the CPU. The interpreter follows the schedule's own structure (a tile
// kernel's tiles, patches, chunks and staging buffers; a block kernel's row buffers, staged terms and in-place
// rows) with f32 rounding, so a schedule step can be checked against the Tix meaning without the GPU. Every
// accumulation it performs on behalf of a restructured reduction asserts that the term it adds is the next one
// in the meaning's lexicographic order and that none is missing: the order argument is part of the check.
//
// What this does not see: the printed CUDA, races between threads (each phase is run thread by thread), and the
// compiler. The GPU check of the final lowering covers those.
import { seededRandom, type CheckResult } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { cudaCases, seed } from './contract.js';
import type { CudaInputs } from './cuda-runtime.js';
import { size, type BufferValue } from './evaluate.js';
import { outerReductions, type Reduce } from './fusion.js';
import { plain, value, visit, width, type Axis, type Expr, type Statement } from './model.js';
import { contractionOf, type BlockKernel, type Schedule, type TileKernel } from './schedule.js';

export class OrderViolation extends Error {}
export interface Forced {
  /** Tile configuration index for every tile kernel; an index past the list is stage 2's mapping. */
  tile: number;
  gate: 'fused' | 'unfused';
}
type Load = Extract<Expr, { kind: 'load' }>;
interface Hooks {
  load?: (e: Load, at: number[]) => number | undefined;
  reduce?: (e: Reduce) => number | undefined;
}
const f = Math.fround;
const operations: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  neg: a => -a,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  tanh: Math.tanh,
  max: Math.max,
  min: Math.min,
};
function decode(linear: number, extents: number[]): number[] {
  const out = extents.map(() => 0);
  for (let i = extents.length - 1; i >= 0; i--) {
    out[i] = linear % extents[i];
    linear = Math.floor(linear / extents[i]);
  }
  return out;
}

/**
 * `memo` (optional) holds, for one set of inputs, the tensors a kernel produced, keyed by what the kernel does
 * on the forced side and by the contents of the tensors it reads. A kernel is a function of those, so a later
 * step or side that leaves a kernel and its inputs unchanged reuses its result.
 */
export function runSchedule(
  schedule: Schedule,
  inputs: CudaInputs,
  forced: Forced,
  memo?: Map<string, Map<string, { shape: number[]; data: Float32Array }>>,
): BufferValue {
  const { fn } = schedule;
  const shapes = new Map<string, number>(),
    tensors = new Map<string, { shape: number[]; data: Float32Array }>();
  for (const p of fn.params) {
    p.shape.forEach((a, i) => {
      const n = plain(a);
      if (n) shapes.set(n, inputs[p.name].shape[i]);
    });
    tensors.set(p.name, { shape: inputs[p.name].shape, data: Float32Array.from(inputs[p.name].data) });
  }
  const index = new Map<string, number>();
  const extentOf = (a: Axis) => {
    const dim = value(a.extent.dim, shapes);
    return a.extent.kind === 'blocks'
      ? Math[a.extent.rounding](dim / width)
      : a.extent.kind === 'tail'
        ? Math.min(width, dim - width * index.get(a.extent.block)!)
        : dim;
  };
  const global = (e: Load, at: number[]) => {
    const t = tensors.get(e.name)!;
    return t.data[at.reduce((o, ix, i) => o * t.shape[i] + ix, 0)];
  };
  function scalar(e: Expr, hooks: Hooks): number {
    switch (e.kind) {
      case 'literal':
        return f(Number(e.text));
      case 'shape':
        return f(shapes.get(e.name)!);
      case 'load': {
        const at = e.indices.map(a => value(a, index));
        return hooks.load?.(e, at) ?? global(e, at);
      }
      case 'op':
        return f(operations[e.op](scalar(e.args[0], hooks), e.args.length === 2 ? scalar(e.args[1], hooks) : 0));
      case 'reduce': {
        const ready = hooks.reduce?.(e);
        if (ready !== undefined) return ready;
        let acc = e.op === 'sum' ? 0 : -Infinity;
        const loop = (i: number) => {
          if (i === e.axes.length) {
            const x = scalar(e.body, hooks);
            acc = f(e.op === 'sum' ? acc + x : Math.max(acc, x));
            return;
          }
          const n = extentOf(e.axes[i]);
          for (let j = 0; j < n; j++) {
            index.set(e.axes[i].id, j);
            loop(i + 1);
          }
        };
        loop(0);
        return acc;
      }
    }
  }
  const byName = new Map(fn.statements.map(s => [s.name, s]));
  const shapeOf = (s: Statement) => s.shape.map(a => value(a, shapes));
  const allocate = (s: Statement) => {
    const shape = shapeOf(s);
    const t = { shape, data: new Float32Array(size(shape)) };
    tensors.set(s.name, t);
    return t;
  };
  // Stage 2's mapping: one element at a time, in any order (each element is one thread's own work).
  function plainStatement(s: Statement) {
    const t = allocate(s);
    for (let e = 0; e < t.data.length; e++) {
      decode(e, t.shape).forEach((ix, p) => index.set(s.axes[p].id, ix));
      t.data[e] = scalar(s.expr, {});
    }
  }

  function tile(k: TileKernel) {
    const s = byName.get(k.statements[0])!;
    const config = k.configs[forced.tile];
    if (!config) return plainStatement(s);
    const c = contractionOf(s);
    if ('refused' in c) throw Error(c.refused);
    const { reduction } = c;
    if (reduction.body.kind !== 'op') throw Error('not a product');
    const [left, right] = reduction.body.args;
    const t = allocate(s);
    const axis = new Map(s.axes.map((a, p) => [a.id, p]));
    const extents = (ids: string[]) => ids.map(id => t.shape[axis.get(id)!]);
    const rowE = extents(k.roles.rows),
      colE = extents(k.roles.cols),
      batchE = extents(k.roles.batch);
    const termE = reduction.axes.map(a => value(a.extent.dim, shapes));
    const rows = size(rowE),
      cols = size(colE),
      batch = size(batchE),
      terms = Math.max(0, size(termE));
    const set = (ids: string[], e: number[], linear: number) =>
      decode(linear, e).forEach((ix, i) => index.set(ids[i], ix));
    const termIds = reduction.axes.map(a => a.id);
    const [tm, tn] = config.tile,
      [rm, rn] = config.patch;
    const tk = config.chunk || Math.max(terms, 1);
    // A factor's value at (row or column, term) for the current batch point. It is a function of that position
    // only, so it is computed once and kept (the kernel recomputes or stages it; the bits are the same).
    let leftTable = new Float32Array(0),
      rightTable = new Float32Array(0),
      known = new Uint8Array(0);
    const leftAt = (r: number, kk: number) => {
      const slot = r * terms + kk;
      if (!(known[slot] & 1)) {
        set(k.roles.rows, rowE, r);
        set(termIds, termE, kk);
        leftTable[slot] = scalar(left, {});
        known[slot] |= 1;
      }
      return leftTable[slot];
    };
    const rightAt = (q: number, kk: number) => {
      const slot = q * terms + kk;
      if (!(known[slot] & 2)) {
        set(k.roles.cols, colE, q);
        set(termIds, termE, kk);
        rightTable[slot] = scalar(right, {});
        known[slot] |= 2;
      }
      return rightTable[slot];
    };
    for (let b = 0; b < batch; b++) {
      leftTable = new Float32Array(rows * terms);
      rightTable = new Float32Array(cols * terms);
      known = new Uint8Array(Math.max(rows, cols) * terms);
      for (let r0 = 0; r0 < rows; r0 += tm)
        for (let c0 = 0; c0 < cols; c0 += tn) {
          set(k.roles.batch, batchE, b);
          // one block: accumulators of every thread's patch, and how many terms each has taken
          const acc = new Float32Array(tm * tn),
            taken = new Int32Array(tm * tn);
          const sa = new Float32Array(tk * tm).fill(NaN),
            sb = new Float32Array(tk * tn).fill(NaN);
          for (let k0 = 0; k0 < terms; k0 += tk) {
            const kn = Math.min(tk, terms - k0);
            if (config.staged) {
              // staging: every slot of the chunk is written by one thread, then a barrier
              for (let e = 0; e < tm * tk; e++) {
                const r = Math.floor(e / tk),
                  kk = e % tk;
                if (r0 + r < rows && kk < kn) sa[kk * tm + r] = leftAt(r0 + r, k0 + kk);
              }
              for (let e = 0; e < tk * tn; e++) {
                const kk = Math.floor(e / tn),
                  q = e % tn;
                if (c0 + q < cols && kk < kn) sb[kk * tn + q] = rightAt(c0 + q, k0 + kk);
              }
            }
            for (let pr = 0; pr < tm; pr += rm)
              for (let pc = 0; pc < tn; pc += rn)
                // one thread: its patch takes the chunk's terms in order
                for (let kk = 0; kk < kn; kk++)
                  for (let r = pr; r < pr + rm; r++)
                    for (let q = pc; q < pc + rn; q++) {
                      if (r0 + r >= rows || c0 + q >= cols) continue;
                      const a = config.staged ? sa[kk * tm + r] : leftAt(r0 + r, k0 + kk);
                      const bq = config.staged ? sb[kk * tn + q] : rightAt(c0 + q, k0 + kk);
                      const slot = r * tn + q;
                      if (taken[slot]++ !== k0 + kk)
                        throw new OrderViolation(
                          `${k.name}: output (${r0 + r}, ${c0 + q}) takes term ${k0 + kk} after ${taken[slot] - 1} terms`,
                        );
                      acc[slot] = f(acc[slot] + f(a * bq));
                    }
          }
          for (let r = 0; r < tm && r0 + r < rows; r++)
            for (let q = 0; q < tn && c0 + q < cols; q++) {
              if (taken[r * tn + q] !== terms)
                throw new OrderViolation(`${k.name}: output (${r0 + r}, ${c0 + q}) took ${taken[r * tn + q]} of ${terms} terms`);
              set(k.roles.rows, rowE, r0 + r);
              set(k.roles.cols, colE, c0 + q);
              set(k.roles.batch, batchE, b);
              const at = s.axes.map(a => index.get(a.id)!);
              const v = scalar(s.expr, { reduce: e => (e === reduction ? acc[r * tn + q] : undefined) });
              t.data[at.reduce((o, ix, i) => o * t.shape[i] + ix, 0)] = v;
            }
        }
    }
  }

  function block(k: BlockKernel) {
    const members = k.statements.map(n => byName.get(n)!);
    if (k.gate && forced.gate === 'unfused') return members.forEach(plainStatement);
    const d = k.depth;
    const stored = new Map(members.filter(m => k.stored.includes(m.name)).map(m => [m.name, allocate(m)]));
    const grid = shapeOf(members[0]).slice(0, d);
    const over = new Map(k.inPlace.map(p => [p.statement, p.over]));
    const rowShapes = new Map<string, number[]>();
    const rowShape = (name: string) => {
      let shape = rowShapes.get(name);
      if (!shape) {
        const t = byName.get(name) ?? fn.params.find(p => p.name === name)!;
        rowShapes.set(name, (shape = t.shape.slice(d).map(a => value(a, shapes))));
      }
      return shape;
    };
    const ownRow = new Map<Load, boolean>();
    for (let point = 0; point < size(grid); point++) {
      const at = decode(point, grid);
      const rows = new Map<string, Float32Array>();
      for (const name of k.staged) {
        const n = size(rowShape(name));
        rows.set(name, tensors.get(name)!.data.slice(point * n, point * n + n));
      }
      for (const m of members) {
        at.forEach((ix, p) => index.set(m.axes[p].id, ix));
        const own = (e: Load) => {
          let is = ownRow.get(e);
          if (is === undefined)
            ownRow.set(e, (is = e.indices.slice(0, d).every((a, p) => plain(a) === m.axes[p].id)));
          return is;
        };
        const load = (e: Load, ix: number[]) => {
          const row = rows.get(e.name);
          if (!row || !own(e)) {
            if (k.statements.includes(e.name)) throw Error(`${k.name}: ${m.name} reads ${e.name} outside its row`);
            return undefined;
          }
          const shape = rowShape(e.name);
          return row[ix.slice(d).reduce((o, x, i) => o * shape[i] + x, 0)];
        };
        // term pass: all threads compute the terms; then one thread folds them in slot order
        const outer = outerReductions(m.expr);
        const ready = new Map<Reduce, number>();
        for (const t of k.terms.filter(x => x.statement === m.name)) {
          const r = outer[t.reduction];
          const e = r.axes.map(extentOf);
          if (r.axes.some(a => a.extent.kind === 'tail')) throw Error('staged terms over a tail axis');
          const count = Math.max(0, size(e));
          const terms = new Float32Array(count);
          for (let slot = count - 1; slot >= 0; slot--) {
            // (threads fill the slots in no particular order; here: backwards)
            decode(slot, e).forEach((ix, i) => index.set(r.axes[i].id, ix));
            terms[slot] = scalar(r.body, { load });
          }
          let acc = r.op === 'sum' ? 0 : -Infinity;
          for (let slot = 0; slot < count; slot++) acc = f(r.op === 'sum' ? acc + terms[slot] : Math.max(acc, terms[slot]));
          ready.set(r, acc);
        }
        const shape = rowShape(m.name);
        const n = size(shape);
        const buffer = k.buffered.includes(m.name)
          ? over.has(m.name)
            ? rows.get(over.get(m.name)!)!
            : new Float32Array(n)
          : undefined;
        const out = stored.get(m.name);
        for (let e = 0; e < n; e++) {
          decode(e, shape).forEach((ix, i) => index.set(m.axes[d + i].id, ix));
          const v = scalar(m.expr, { load, reduce: r => ready.get(r) });
          if (buffer) buffer[e] = v;
          if (out) out.data[point * n + e] = v;
        }
        if (buffer) rows.set(m.name, buffer);
      }
    }
  }

  // tensors with equal contents share one identity, so a memo key can name a kernel's inputs
  const identity = new Map<object, string>();
  const identify = (t: { shape: number[]; data: Float32Array }) => {
    let id = identity.get(t);
    if (!id) {
      const words = new Uint32Array(t.data.buffer, t.data.byteOffset, t.data.length);
      let h1 = 0x811c9dc5,
        h2 = 0x1234567;
      for (let i = 0; i < words.length; i++) {
        h1 = Math.imul(h1 ^ words[i], 0x01000193);
        h2 = (Math.imul(h2, 31) + words[i]) | 0;
      }
      identity.set(t, (id = `${t.shape}:${h1}:${h2}`));
    }
    return id;
  };
  for (const k of schedule.kernels) {
    // What the kernel does on this side: stage 2's mapping (whatever the kernel's other fields say), one tile
    // configuration, or the kernel's own record. Names and reasons do not matter.
    const { name: _name, reasons: _reasons, ...record } = k;
    const config = k.kind === 'tile' ? k.configs[forced.tile] : undefined;
    const effect =
      k.kind === 'thread' || (k.kind === 'tile' && !config) || (k.kind === 'block' && k.gate && forced.gate === 'unfused')
        ? ['plain', k.statements]
        : k.kind === 'tile'
          ? ['tile', k.statements, k.roles, config]
          : record;
    const reads = new Set<string>();
    for (const n of k.statements)
      visit(byName.get(n)!.expr, e => {
        if (e.kind === 'load' && !k.statements.includes(e.name)) reads.add(e.name);
      });
    const key = JSON.stringify([effect, [...reads].map(n => [n, identify(tensors.get(n)!)])]);
    const hit = memo?.get(key);
    if (hit) {
      for (const [name, t] of hit) tensors.set(name, t);
      continue;
    }
    if (k.kind === 'tile') tile(k);
    else if (k.kind === 'block') block(k);
    else k.statements.forEach(n => plainStatement(byName.get(n)!));
    memo?.set(key, new Map(k.statements.flatMap(n => (tensors.has(n) ? [[n, tensors.get(n)!] as const] : []))));
  }
  return tensors.get(fn.result)!;
}

/** The sides a schedule can take at launch: every tile configuration (and stage 2's mapping), both gate sides. */
export function scheduleSides(schedule: Schedule): Forced[] {
  const configs = Math.max(0, ...schedule.kernels.map(k => (k.kind === 'tile' ? k.configs.length : 0)));
  const tiled = schedule.kernels.some(k => k.kind === 'tile');
  const gated = schedule.kernels.some(k => k.kind === 'block' && k.gate);
  const n = Math.max(tiled ? configs + 1 : 1, gated ? 2 : 1);
  return Array.from({ length: n }, (_, i) => ({
    tile: tiled ? i % (configs + 1) : 0,
    gate: i % 2 ? 'unfused' : 'fused',
  }));
}

const sampleCache = new WeakMap<object, ReturnType<typeof cudaCases>>();
const memos = new WeakMap<object, Map<string, Map<string, { shape: number[]; data: Float32Array }>>>();
/**
 * The check of one schedule step: the candidate, executed by the interpreter on every side, gives the function's
 * f32 meaning bit for bit on the lowering's samples, with the order assertions on. The IR's validator has already re-checked legality.
 */
export function scheduleGate(_before: Artifact<Schedule>, candidate: Artifact<Schedule>): CheckResult {
  const { fn } = candidate.value;
  let samples = sampleCache.get(fn);
  if (!samples) {
    // `signed` everywhere; `half-ulp` (sums that depend on the order by construction) at the small shapes
    samples = cudaCases(fn, seededRandom(seed)).filter(
      c => c.stream === 'signed' || (c.stream === 'half-ulp' && c.shapeValues.every(n => n <= 11)),
    );
    sampleCache.set(fn, samples);
  }
  const sides = scheduleSides(candidate.value);
  let runs = 0;
  for (const sample of samples)
    for (const side of sides) {
      runs++;
      const where = JSON.stringify({ shapeValues: sample.shapeValues, stream: sample.stream, ...side });
      let got: BufferValue;
      try {
        if (!memos.has(sample)) memos.set(sample, new Map());
        got = runSchedule(candidate.value, sample.inputs, side, memos.get(sample));
      } catch (error) {
        if (error instanceof OrderViolation) return { ok: false, reason: `${where}: ${error.message}` };
        throw error;
      }
      const a = new Uint32Array(sample.reference.data.buffer, 0, sample.reference.data.length),
        b = new Uint32Array(got.data.buffer, 0, got.data.length);
      if (a.length !== b.length) return { ok: false, reason: `${where}: output length differs` };
      for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i] && !(Number.isNaN(sample.reference.data[i]) && Number.isNaN(got.data[i])))
          return {
            ok: false,
            reason: `${where}: at offset ${i}, expected ${sample.reference.data[i]}, the schedule gives ${got.data[i]}`,
          };
    }
  return { ok: true, evidence: { samples: samples.length, sides: sides.length, runs } };
}
