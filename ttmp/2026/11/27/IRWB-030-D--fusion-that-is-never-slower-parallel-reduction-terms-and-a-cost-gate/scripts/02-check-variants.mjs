// IRWB-030-D: checkLowering (exact, GB10) of the corpus programs and the two "inside" variants, fused, and of the
// staged-term feature programs. Prints one line per check.
import { checkLowering, compileTix, optimizeTix } from '../../../../../../dist/tensor/index.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';
import { fnName, names, program } from './01-programs.mjs';

const features = compileTix(`
  fn twoterms(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = (sum(j) x[i,j] / 3) + max(j) exp(z[i,j]) - sum(j) z[i,j];
    y[i,j] = x[i,j] - s[i];
    return y;
  }
  fn multiaxis(x:f32[N,A,B]):f32[N,A,B] {
    s[i] = sum(a, b) x[i,a,b] / 7;
    y[i,a,b] = x[i,a,b] * s[i];
    return y;
  }
  fn nested(x:f32[N,C], z:f32[N,C]):f32[N,C] {
    s[i] = sum(j) (x[i,j] * sum(j) z[i,j]);
    y[i,j] = x[i,j] / s[i];
    return y;
  }
  fn maxterms(x:f32[N,C]):f32[N,C] {
    e[i,j] = x[i,j] * 2;
    m[i] = max(j) e[i,j] / 3;
    y[i,j] = e[i,j] - m[i];
    return y;
  }
  fn lastscalar(x:f32[N,C]):f32[N] {
    e[i,j] = x[i,j] * 2;
    m[i] = sum(j) sqrt(e[i,j]);
    return m;
  }
`);
const checks = [
  ...names.map(n => [n, program(n), fnName(n)]),
  ...['twoterms', 'multiaxis', 'nested', 'maxterms', 'lastscalar'].map(n => [n, features, n]),
  ['layernorm-inside+split', optimizeTix(program('layernorm-inside'), ['split-sum']).program, 'layernorm'],
  ['twoterms+inline+split', optimizeTix(features, ['inline', 'split-sum']).program, 'twoterms'],
];
// Three at a time: the GPU machine's sshd drops connections beyond about ten concurrent starts.
const queue = [...checks];
const worker = async () => {
  for (let c; (c = queue.shift()); ) {
    const [label, p, fn] = c;
    const plan = planFusion(p.current.value.functions.find(f => f.name === fn));
    const staged = plan.groups.flatMap(g => g.terms.filter(t => t.staged).map(t => `${t.statement}#${t.reduction}`));
    const verdict = await checkLowering(p, fn);
    console.log(JSON.stringify({ label, kernels: plan.groups.length, staged, ...verdict }));
  }
};
await Promise.all([worker(), worker(), worker()]);
