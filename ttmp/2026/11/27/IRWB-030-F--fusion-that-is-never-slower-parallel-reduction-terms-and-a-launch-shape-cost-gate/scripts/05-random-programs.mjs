// IRWB-030-F script 05: random Tix programs, checked under the exact relation fused, and run through the gated
// runTixCuda path against the f32 interpreter, before and after inline + split-sum. Same generator as
// IRWB-029-D script 09 (row reductions, broadcasts, contractions, elementwise chains), so the two stages are
// comparable; this stage also records the staged reductions each program's plan carries.
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/05-random-programs.mjs [count=20] [seed=29]
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, optimizeTix, runTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';

const [count = 20, seed = 29] = process.argv.slice(2).map(Number);
const random = seededRandom(seed);
const pick = list => list[Math.floor(random() * list.length)];
const at = { NC: '[i,j]', N: '[i]', C: '[j]' };

export function generate() {
  const tensors = { NC: ['x', 'z'], N: [], C: ['v'], ND: [], CD: ['w'] };
  const statements = [];
  const leaf = kinds => {
    const kind = pick(kinds.filter(k => tensors[k].length));
    const tensor = random() < 0.5 ? tensors[kind].at(-1) : pick(tensors[kind]);
    return random() < 0.15 ? pick(['0.5', '2', '-1.25', '3']) : tensor + at[kind];
  };
  const expr = (kinds, depth = 0) => {
    if (depth >= 2 || random() < 0.3) return leaf(kinds);
    if (random() < 0.25) return `${pick(['exp', 'tanh', 'sqrt', 'log'])}(${expr(kinds, depth + 1)})`;
    if (random() < 0.15) return `${pick(['max', 'min'])}(${expr(kinds, depth + 1)}, ${expr(kinds, depth + 1)})`;
    return `(${expr(kinds, depth + 1)} ${pick(['+', '-', '*', '/'])} ${expr(kinds, depth + 1)})`;
  };
  const n = 2 + Math.floor(random() * 5);
  for (let s = 0; s < n; s++) {
    const name = 't' + s;
    const form = pick(['nc', 'nc', 'row', 'row', 'contract', 'rowd', 'n']);
    if (form === 'nc' || (form === 'rowd' && !tensors.ND.length) || (form === 'n' && !tensors.N.length)) {
      statements.push(`${name}[i,j]: f32[N,C] = ${expr(['NC', 'N', 'C'])};`);
      tensors.NC.push(name);
    } else if (form === 'row') {
      const witness = pick([...tensors.NC.slice(-2).map(t => t + '[i,j]'), 'v[j]']);
      statements.push(`${name}[i]: f32[N] = ${pick(['sum', 'max'])}(j) ${witness} ${pick(['*', '-', '+'])} ${expr(['NC', 'N', 'C'])};`);
      tensors.N.push(name);
    } else if (form === 'contract') {
      statements.push(`${name}[i,k] = sum(j) ${tensors.NC.at(-1)}[i,j] * w[j,k];`);
      tensors.ND.push(name);
    } else if (form === 'rowd') {
      statements.push(`${name}[i] = ${pick(['sum', 'max'])}(k) ${tensors.ND.at(-1)}[i,k];`);
      tensors.N.push(name);
    } else {
      statements.push(`${name}[i] = ${tensors.N.at(-1)}[i] * 2 + ${pick(tensors.N)}[i];`);
      tensors.N.push(name);
    }
  }
  const result = statements.at(-1).match(/^(\w+)\[([^\]]*)\]/);
  const shape = { 'i,j': 'N,C', i: 'N', 'i,k': 'N,D' }[result[2]];
  return `fn f(x: f32[N,C], z: f32[N,C], v: f32[C], w: f32[C,D]): f32[${shape}] {\n  ${statements.join('\n  ')}\n  return ${result[1]};\n}`;
}

const words = value => new Uint32Array(value.data.buffer, value.data.byteOffset, value.data.length);
const identical = (a, b) => {
  const wa = words(a),
    wb = words(b);
  return (
    a.shape.length === b.shape.length &&
    a.shape.every((n, i) => n === b.shape[i]) &&
    wa.length === wb.length &&
    wa.every((w, i) => w === wb[i] || (Number.isNaN(a.data[i]) && Number.isNaN(b.data[i])))
  );
};
const valueOf = (affine, map) =>
  affine.terms.reduce((v, [n, k]) => v + map.get(n) * k, affine.constant);



if (import.meta.url === `file://${process.argv[1]}`) {
  let accepted = 0,
    total = 0,
    gated = 0,
    gatedTotal = 0,
    stagedPrograms = 0,
    blockPrograms = 0,
    multiKernel = 0;
  for (let p = 0; p < count; p++) {
    const source = generate();
    let program;
    try {
      program = compileTix(source);
    } catch (error) {
      console.log(JSON.stringify({ p, skipped: error.message, source }));
      continue;
    }
    const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
    for (const [label, revision] of [['original', program], ['inline+split', optimized]]) {
      const f = revision.current.value.functions[0];
      const plan = planFusion(f);
      const verdict = await checkLowering(revision, 'f');
      total++;
      if (verdict.accepted) accepted++;
      if (plan.groups.some(g => g.mapping === 'block')) blockPrograms++;
      if (plan.groups.some(g => g.parallelTerms.length)) stagedPrograms++;
      const kernels = (cudaSource(revision, 'f').match(/__global__ void/g) ?? []).length;
      if (kernels < f.statements.length) multiKernel++;
      // The gated path runTixCuda takes, against the f32 meaning at a concrete shape.
      const dims = { N: 7, C: 5, D: 3 };
      const map = new Map(Object.entries(dims));
      const inputs = Object.fromEntries(
        f.params.map(param => {
          const shape = param.shape.map(d => valueOf(d, map));
          return [
            param.name,
            { shape, data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 2 * random() - 1) },
          ];
        }),
      );
      const result = await runTixCuda(revision, 'f', inputs);
      const meaning = runTix(revision, 'f', inputs);
      gatedTotal++;
      if (identical(result, meaning)) gated++;
      console.log(
        JSON.stringify({
          p,
          revision: label,
          statements: f.statements.length,
          kernels,
          groups: plan.groups.map(g => `${g.mapping}:${g.statements.join(',')}`),
          staged: plan.groups.flatMap(g => g.parallelTerms.map(t => t.description)),
          check: verdict.accepted ? 'exact' : 'REJECTED: ' + verdict.reason,
          gated: identical(result, meaning) ? 'identical' : 'DIFFERS',
          ...(!verdict.accepted || !identical(result, meaning) ? { source } : {}),
        }),
      );
    }
  }
  console.log(
    JSON.stringify({ accepted, total, gated, gatedTotal, stagedPrograms, blockPrograms, multiKernel }),
  );
}
