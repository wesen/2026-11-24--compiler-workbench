// IRWB-030-G script 14: random Tix functions checked on the GB10, and their staging and gate decisions.
//
// The generator is IRWB-029-D's (`scripts/09-random-programs.mjs` in that ticket): row reductions, contracts,
// broadcasts and elementwise chains over `x, z: f32[N,C]`, `v: f32[C]`, `w: f32[C,D]`, biased to read the latest
// definition so that fusion has something to do. A reduction's body there is often a division or a transcendental,
// so this stage's term staging is exercised. Each program is checked fused and unfused, before and after `inline` and
// `split-sum`, and its plan is recorded at two sets of shape values (a short row and a wide one) to show what the
// gate and the cost rule do.
//
//   node <ticket>/scripts/14-random-programs.mjs [count=12] [seed=29] > <ticket>/scripts/14-random-programs.jsonl
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { checkLowering, compileTix, cudaSource, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';

const [count = 12, seed = 29] = process.argv.slice(2).map(Number);
const random = seededRandom(seed);
const pick = list => list[Math.floor(random() * list.length)];
const at = { NC: '[i,j]', N: '[i]', C: '[j]' };

function generate() {
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
      statements.push(
        `${name}[i]: f32[N] = ${pick(['sum', 'max'])}(j) ${witness} ${pick(['*', '-', '+'])} ${expr(['NC', 'N', 'C'])};`,
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

const SHORT = { N: 64, C: 8, D: 4 },
  WIDE = { N: 64, C: 128, D: 64 };
let accepted = 0,
  checks = 0,
  staged = 0,
  gated = 0,
  programs = 0;
for (let p = 0; p < count; p++) {
  const source = generate();
  let program;
  try {
    program = compileTix(source);
  } catch (error) {
    console.log(JSON.stringify({ p, skipped: error.message }));
    continue;
  }
  programs++;
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  for (const [label, revision] of [
    ['original', program],
    ['inline+split', optimized],
  ]) {
    const f = revision.current.value.functions[0];
    const plans = Object.fromEntries(
      [
        ['short', SHORT],
        ['wide', WIDE],
      ].map(([size, values]) => {
        const plan = planFusion(f, values);
        staged += plan.groups.reduce((n, g) => n + g.terms.length, 0);
        gated += plan.gate.length;
        return [
          size,
          {
            kernels: (cudaSource(revision, 'f', { sizes: values }).match(/__global__ void/g) ?? []).length,
            terms: plan.groups.flatMap(g => g.terms.map(t => `${g.kernel} ${t.member}:${t.reduction}`)),
            serial: plan.groups.flatMap(g => g.serial.map(s => `${g.kernel} ${s.member}:${s.reduction}`)),
            gate: plan.gate.map(g => g.width),
          },
        ];
      }),
    );
    const verdicts = {};
    for (const fuse of [true, false]) {
      const verdict = await checkLowering(revision, 'f', { fuse });
      checks++;
      if (verdict.accepted) accepted++;
      verdicts[fuse ? 'fused' : 'unfused'] = verdict;
    }
    console.log(
      JSON.stringify({
        p,
        revision: label,
        statements: f.statements.length,
        kernelCounts: { fused: plans.wide.kernels, unfused: (cudaSource(revision, 'f', { fuse: false }).match(/__global__ void/g) ?? []).length },
        terms: plans.wide.terms,
        serial: plans.wide.serial,
        gateShort: plans.short.gate,
        gateWide: plans.wide.gate,
        ...verdicts,
        ...(verdicts.fused.accepted && verdicts.unfused.accepted ? {} : { source }),
      }),
    );
  }
}
console.log(JSON.stringify({ programs, accepted, checks, stagedTerms: staged, gatedGroups: gated }));
