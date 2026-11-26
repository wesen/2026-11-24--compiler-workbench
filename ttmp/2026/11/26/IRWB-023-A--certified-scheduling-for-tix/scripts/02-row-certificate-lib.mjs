import { isDeepStrictEqual } from 'node:util';
import { createArtifact, defineInvariant, defineIR, defineTransformation } from '../../../../../../dist/framework/contracts/index.js';
import { TixIR } from '../../../../../../dist/tensor/ir.js';
import { plain } from '../../../../../../dist/tensor/model.js';

const selected = (base, name) => base.value.functions.find(fn => fn.name === name);
const same = isDeepStrictEqual;
const foldMode = expr => {
  if (expr.kind === 'reduce') return expr.op === 'max' ? 'max-join' : 'lex';
  return expr.kind === 'op' ? expr.args.map(foldMode).find(Boolean) : undefined;
};

// Deliberately modest proposal generator. The validator derives the facts afresh.
export function propose(base, name) {
  const fn = selected(base, name);
  return {
    base: base.revision, fn: name, lanes: 128, cap: 2048, prefetch: null,
    phases: fn.statements.map(st => ({
      tensor: st.name, lane: st.shape.length === 1 ? 'scalar' : 'cyclic',
      tail: 'guarded', fold: foldMode(st.expr) ?? 'none',
      after: st.name !== fn.result, expr: st.expr,
    })),
  };
}

export function verify(base, plan) {
  const reject = reason => ({ ok: false, reason });
  if (plan.base !== base.revision) return reject('stale revision');
  const fn = selected(base, plan.fn);
  if (!fn || fn.params[0]?.shape.length !== 2) return reject('missing rank-two row source');
  const [rows, cols] = fn.params[0].shape.map(plain);
  if (!rows || !cols || rows === cols) return reject('need distinct symbolic row and column dimensions');
  if (plan.prefetch !== null && plan.prefetch !== fn.params[0].name)
    return reject('prefetch must be the parameter defining this row domain');
  if (![32, 64, 128, 256].includes(plan.lanes) || !Number.isSafeInteger(plan.cap) || plan.cap < 1)
    return reject('unsupported launch geometry');

  const dimensions = tensor => tensor.shape.map(a => plain(a) ?? (a.terms.length ? null : a.constant));
  const statements = new Map(fn.statements.map(st => [st.name, st]));
  const output = statements.get(fn.result);
  if (!output || !same(dimensions(output), [rows, cols])) return reject('need row-shaped output');
  if (plan.phases.length !== statements.size) return reject('wrong phase count');

  const prior = new Map();
  let shapeOnlyVisits = 0, scalarSlots = 0, vectorSlots = Number(plan.prefetch !== null);
  for (const phase of plan.phases) {
    const st = statements.get(phase.tensor);
    if (!st || prior.has(phase.tensor)) return reject('unknown or duplicate phase');
    const dims = dimensions(st);
    const scalar = same(dims, [rows]);
    if (!scalar && !same(dims, [rows, cols])) return reject('unsupported phase shape');
    const row = st.axes[0].id;
    const column = st.axes[1]?.id;
    if (phase.lane !== (scalar ? 'scalar' : 'cyclic')) return reject('nonunique writer mapping');
    if (phase.tail !== 'guarded') return reject('column coverage is not exact for partial blocks');
    if (!same(phase.expr, st.expr)) return reject('scalar tree or address differs from source');
    if (typeof phase.after !== 'boolean') return reject('barrier mode must be block-uniform');
    if (st.name !== fn.result) {
      if (scalar) scalarSlots++;
      else vectorSlots++;
    }

    let verifiedFold = 'none';
    function expression(e, col, reduceAllowed) {
      shapeOnlyVisits++;
      if (e.kind === 'reduce') {
        if (!reduceAllowed || !scalar || verifiedFold !== 'none' || e.axes.length !== 1 ||
            e.axes[0].extent.kind !== 'dim' || plain(e.axes[0].extent.dim) !== cols)
          return 'unsupported reduction domain';
        verifiedFold = e.op === 'max' && phase.fold === 'max-join' ? 'max-join' : 'lex';
        return expression(e.body, e.axes[0].id, false);
      }
      if (e.kind === 'op') {
        for (const child of e.args) {
          const error = expression(child, col, reduceAllowed);
          if (error) return error;
        }
      }
      if (e.kind !== 'load') return undefined;
      const param = fn.params.find(p => p.name === e.name);
      const target = param ?? statements.get(e.name);
      if (!target) return 'unknown tensor';
      if (!param) {
        const writer = prior.get(e.name);
        if (!writer || e.name === fn.result) return 'read before a shared producer';
        if (!writer.after) return 'missing barrier after ' + e.name;
      }
      const got = e.indices.map(plain);
      const targetShape = dimensions(target);
      if (same(targetShape, [rows, cols]) && col && same(got, [row, col])) return undefined;
      if (same(targetShape, [rows]) && same(got, [row])) return undefined;
      if (param && same(targetShape, [cols]) && col && same(got, [col])) return undefined;
      if (param && same(targetShape, [1]) && same(e.indices, [{ constant: 0, terms: [] }]))
        return undefined;
      return 'load is outside its proved row or parameter domain';
    }

    const error = expression(st.expr, column, true);
    if (error) return reject(phase.tensor + ': ' + error);
    if (phase.fold !== verifiedFold) return reject('rounding recurrence differs');
    prior.set(phase.tensor, phase);
  }
  // Conservative distinct slots, three scalars of implementation overhead and per-lane maximum scratch.
  const sharedBytes = 4 * (scalarSlots + vectorSlots * plan.cap + plan.lanes + 3);
  if (!Number.isSafeInteger(sharedBytes) || sharedBytes > 49152) return reject('shared-memory guard insufficient');
  return {
    ok: true,
    evidence: { method: 'row-schedule-certificate', version: '1', relation: 'f32-nan-class',
      sourceRevision: base.revision, shapeOnlyVisits, vectorSlots, sharedBytes },
  };
}

const Schedule = defineIR({
  id: 'research.tix-row-schedule', version: '1', description: 'Restricted row schedule',
  validate(plan) {
    if (!plan || !Array.isArray(plan.phases)) throw Error('Expected phases');
  },
});
const ports = { source: TixIR, schedule: Schedule };
const certificate = defineInvariant({
  id: 'research.tix-row-schedule-certificate', version: '1', description: 'Check schedule structure',
  inputs: ports, check(_ctx, { source, schedule }) { return verify(source, schedule.value); },
});
export const transform = defineTransformation({
  id: 'research.tix-resident', version: '1', description: 'Select row schedule',
  inputs: { source: TixIR }, outputs: { schedule: Schedule },
  ensures: [{ invariant: certificate, bindings: {
    source: { from: 'inputs', port: 'source' }, schedule: { from: 'outputs', port: 'schedule' },
  } }],
});
export const artifact = plan => createArtifact(Schedule, 'tix-row/' + plan.fn, plan);
