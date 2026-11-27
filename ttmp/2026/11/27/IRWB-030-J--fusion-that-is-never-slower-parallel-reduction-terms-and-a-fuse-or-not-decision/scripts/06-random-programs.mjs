// IRWB-030-J script 06: random Tix functions, each lowered fused (staged terms included) and checked on the GB10
// under the exact relation, before and after inline + split-sum. The generator extends IRWB-029-D script 09 with
// the forms this stage adds: divisions and calls inside row-reduction bodies (the staged class) and nested
// reductions inside staged bodies.
//   node <ticket>/scripts/06-random-programs.mjs [count=20] [seed=29]
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
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
    const form = pick(['nc', 'nc', 'row', 'row', 'contract', 'rowd', 'rowdiv', 'rownest', 'n']);
    if (form === 'nc' || (form === 'rowd' && !tensors.ND.length) || (form === 'n' && !tensors.N.length)) {
      statements.push(`${name}[i,j]: f32[N,C] = ${expr(['NC', 'N', 'C'])};`);
      tensors.NC.push(name);
    } else if (form === 'row' || form === 'rowdiv') {
      const witness = pick([...tensors.NC.slice(-2).map(t => t + '[i,j]'), 'v[j]']);
      const body =
        form === 'rowdiv'
          ? `((${witness} ${pick(['*', '+', '-'])} ${expr(['NC', 'N', 'C'])}) / C)` // the division rounds per term
          : `${witness} ${pick(['*', '-', '+'])} ${expr(['NC', 'N', 'C'])}`;
      statements.push(`${name}[i]: f32[N] = ${pick(['sum', 'max'])}(j) ${body};`);
      tensors.N.push(name);
    } else if (form === 'rownest') {
      // a nested reduction inside the outer body: the inner fold runs per term, on the term's thread
      const witness = pick([...tensors.NC.slice(-2).map(t => t + '[i,j]'), 'v[j]']);
      statements.push(
        `${name}[i]: f32[N] = ${pick(['sum', 'max'])}(j) ((${witness} * 2) + ${pick(['sum', 'max'])}(k) v[k] * 3);`,
      );
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

if (import.meta.url === `file://${process.argv[1]}`) {
  let accepted = 0,
    total = 0,
    staged = 0;
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
      staged += plan.groups.reduce((n, g) => n + g.terms.length, 0);
      console.log(
        JSON.stringify({
          p,
          revision: label,
          statements: f.statements.length,
          kernels: (cudaSource(revision, 'f').match(/__global__ void/g) ?? []).length,
          groups: plan.groups.map(g => `${g.mapping}:${g.statements.join(',')}`),
          terms: plan.groups.flatMap(g => g.terms.map(t => `${t.member}:${t.op}`)),
          ...verdict,
          ...(verdict.accepted ? {} : { source }),
        }),
      );
    }
  }
  console.log(JSON.stringify({ accepted, total, staged }));
}
