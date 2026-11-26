import { createHash } from 'node:crypto';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { plain } from '../../../../../../dist/tensor/model.js';
import { artifact, propose, transform } from './02-row-certificate-lib.mjs';

const floatWord = new DataView(new ArrayBuffer(4));
function literal(text) {
  floatWord.setFloat32(0, Number(text));
  return '__uint_as_float(0x' + floatWord.getUint32(0).toString(16) + 'u)';
}

function emit(fn, plan, evidence) {
  const emitters = new Map(fn.params.map((p, i) => [p.name, 'p' + i]));
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const [rowDim, colDim] = fn.params[0].shape.map(plain);
  const params = fn.params.map(p => 'const float* ' + emitters.get(p.name));
  const lines = [
    'constexpr int cert_cap = ' + plan.cap + ';',
    'constexpr int cert_lanes = ' + plan.lanes + ';',
    'constexpr unsigned cert_vectors = ' + evidence.vectorSlots + ';',
    '__global__ void certified_row(' + [...params, 'float* output', 'int n', 'int rows'].join(', ') + ') {',
    '  extern __shared__ float row_storage[];',
    '  const size_t offset = static_cast<size_t>(blockIdx.x) * n;',
  ];
  const append = (...xs) => lines.push(...xs);
  const shared = new Map();
  let slot = 0;
  if (plan.prefetch !== null) {
    shared.set(plan.prefetch, 'input_row');
    append('  float* input_row = row_storage;',
      '  for (int j = threadIdx.x; j < n; j += blockDim.x) input_row[j] = p0[offset + j];',
      '  __syncthreads();');
    slot++;
  }
  for (const [i, phase] of plan.phases.entries()) {
    if (phase.tensor === fn.result) continue;
    const label = 's' + i;
    shared.set(phase.tensor, label);
    if (phase.lane === 'scalar') append('  __shared__ float ' + label + ';');
    else append('  float* ' + label + ' = row_storage + static_cast<size_t>(' + slot++ + ') * n;');
  }
  if (plan.phases.some(p => p.fold === 'max-join')) append('  __shared__ float scratch[cert_lanes];');
  if (slot !== evidence.vectorSlots) throw Error('Verifier and emitter storage sizes differ');

  for (const phase of plan.phases) {
    const st = tensors.get(phase.tensor);
    const row = st.axes[0].id;
    const column = st.axes[1]?.id;
    const destination = phase.tensor === fn.result ? 'output[offset + j]'
      : shared.get(phase.tensor) + (column ? '[j]' : '');

    function expression(e, columnBinder, accumulator) {
      switch (e.kind) {
        case 'literal': return literal(e.text);
        case 'shape':
          if (e.name === colDim) return '__int2float_rn(n)';
          if (e.name === rowDim) return '__int2float_rn(rows)';
          throw Error('Unemittable shape ' + e.name);
        case 'reduce': return accumulator;
        case 'load': {
          const dims = tensors.get(e.name).shape;
          const [first, second] = e.indices.map(plain);
          const memory = shared.get(e.name), param = emitters.get(e.name);
          if (dims.length === 2 && first === row && second === columnBinder)
            return memory ? memory + '[j]' : param + '[offset + j]';
          if (first === row) return memory ?? param + '[blockIdx.x]';
          if (first === columnBinder && first !== undefined) return param + '[j]';
          return param + '[0]';
        }
        case 'op': {
          const args = e.args.map(x => expression(x, columnBinder, accumulator));
          const intrinsics = { '+': '__fadd_rn', '-': '__fsub_rn', '*': '__fmul_rn',
            '/': '__fdiv_rn', sqrt: '__fsqrt_rn' };
          if (intrinsics[e.op]) return intrinsics[e.op] + '(' + args.join(', ') + ')';
          if (e.op === 'neg') return '-(' + args[0] + ')';
          if (e.op === 'min' || e.op === 'max') return 'minmax(' + args.join(', ') + ', ' + (e.op === 'max') + ')';
          if (['exp', 'log', 'tanh'].includes(e.op))
            return '__double2float_rn(' + e.op + '(static_cast<double>(' + args[0] + ')))';
          throw Error('Unsupported operation ' + e.op);
        }
      }
      throw Error('Unsupported expression');
    }

    function reduction(e) {
      if (e.kind === 'reduce') return e;
      if (e.kind === 'op') return e.args.map(reduction).find(Boolean);
    }
    const fold = reduction(phase.expr);
    if (phase.lane === 'cyclic') {
      append('  for (int j = threadIdx.x; j < n; j += blockDim.x) {',
        '    ' + destination + ' = ' + expression(phase.expr, column) + ';', '  }');
    } else if (phase.fold === 'max-join') {
      append('  {',
        '    float local = -INFINITY;',
        '    for (int j = threadIdx.x; j < n; j += blockDim.x)',
        '      local = minmax(local, ' + expression(fold.body, fold.axes[0].id) + ', true);',
        '    scratch[threadIdx.x] = local;',
        '    __syncthreads();',
        '    for (int stride = blockDim.x / 2; stride; stride /= 2) {',
        '      if (threadIdx.x < stride) scratch[threadIdx.x] = minmax(scratch[threadIdx.x], scratch[threadIdx.x + stride], true);',
        '      __syncthreads();',
        '    }',
        '    if (threadIdx.x == 0) ' + destination + ' = ' + expression(phase.expr, undefined, 'scratch[0]') + ';',
        '  }');
    } else {
      append('  if (threadIdx.x == 0) {');
      if (fold) {
        const term = expression(fold.body, fold.axes[0].id);
        const maximum = fold.op === 'max';
        const recurrence = maximum ? 'minmax(acc, ' + term + ', true)' : '__fadd_rn(acc, ' + term + ')';
        append('    float acc = ' + (maximum ? '-INFINITY' : '0.0f') + ';',
          '    for (int j = 0; j < n; ++j) acc = ' + recurrence + ';');
      }
      append('    ' + destination + ' = ' + expression(phase.expr, undefined, 'acc') + ';', '  }');
    }
    if (phase.after) append('  __syncthreads();');
  }
  append('}', '');
  return lines.join('\n');
}

export async function emitCertifiedRow(source, name) {
  const fn = source.value.functions.find(f => f.name === name);
  const plan = artifact({ ...propose(source, name), prefetch: fn.params[0].name });
  const manager = new AnalysisManager();
  const verified = await manager.verifyTransformation({ source }, { schedule: plan }, transform);
  const evidence = verified.execution.checks[0].evidence;
  const code = emit(fn, plan.value, evidence);
  return { code, sourceRevision: source.revision, scheduleRevision: plan.revision,
    cudaSha256: createHash('sha256').update(code).digest('hex'), evidence };
}
