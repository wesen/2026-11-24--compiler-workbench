// IRWB-029-F script 06: a mini random-program sweep. Varied programs - rank 1..3, chains, row groups, refused
// fusions, optimized revisions - run fused on the GB10 and compared bit for bit (NaN as a class) with the f32
// meaning, at several shape assignments including empty extents.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const { compileTix, runTix, runTixCuda, cudaSource, optimizeTix } = await import(
  join(root, 'dist/tensor/index.js')
);
const { value } = await import(join(root, 'dist/tensor/model.js'));
const { fusionPlan } = await import(join(root, 'dist/tensor/fusion.js'));

const programs = {
  rank3row: 'fn f(x:f32[N,C,H],b:f32[H]):f32[N,C,H]{m[i]=max(j,k)x[i,j,k];e[i,j,k]=x[i,j,k]-m[i]+b[k];y[i,j,k]=e[i,j,k]*2;return y;}',
  chain1d: 'fn f(x:f32[N,K]):f32[N]{t[i]=sum(k)x[i,k];y[i]=exp(t[i])+t[i];return y;}',
  refused: 'fn f(x:f32[N,K],u:f32[K]):f32[N,K]{p[i,j]=x[i,j]*2;w[j]=u[j]*3;y[i,j]=p[i,j]+w[j];return y;}',
  shifted: 'fn f(x:f32[N,K],z:f32[M,1]):f32[M,K]{p[i,j]:f32[M,K]=x[i+1,j];y[i,j]=p[i,j]*2;return y;}',
  epilogue: 'fn f(x:f32[N,K],w:f32[K,O],b:f32[O]):f32[N,O]{h[i,j]=sum(k)x[i,k]*w[k,j]+b[j];g[i,j]=exp(h[i,j])*h[i,j];return g;}',
  crossrow: 'fn f(x:f32[N,K]):f32[N]{t[i]=x[i,0]*2;s[i]=(sum(c)x[c,0])+x[i,1];return s;}',
  emptyrow: 'fn f(x:f32[N,K]):f32[N,K]{m[i]=max(j)x[i,j];e[i,j]=exp(x[i,j]-m[i]);y[i,j]=e[i,j]*e[i,j];return y;}',
};

// Assignments must keep every read in bounds (the stage 1 calling domain): the shifted program needs
// M + 1 <= N, and the cross-row program reads x[i,1], so it needs K >= 2.
const all = [
  { N: 7, C: 3, H: 5, K: 4, O: 6, M: 2 },
  { N: 1, C: 1, H: 1, K: 1, O: 1, M: 1 },
  { N: 3, C: 0, H: 2, K: 5, O: 0, M: 3 },
  { N: 0, C: 3, H: 2, K: 5, O: 3, M: 3 },
];
const assignmentsFor = name =>
  name === 'shifted'
    ? [{ N: 8, K: 4, M: 2 }, { N: 2, K: 1, M: 1 }, { N: 5, K: 5, M: 3 }, { N: 4, K: 2, M: 2 }]
    : name === 'crossrow'
      ? [{ N: 7, K: 4 }, { N: 3, K: 5 }, { N: 2, K: 2 }, { N: 0, K: 3 }]
      : all;
let failures = 0;
for (const [name, source] of Object.entries(programs)) {
  const base = compileTix(source);
  const revisions = [['origin', base]];
  if (name !== 'shifted') {
    const optimized = optimizeTix(base, ['inline', 'split-sum']);
    if (optimized.program.current.revision !== base.current.revision)
      revisions.push(['optimized', optimized.program]);
  }
  const fn = base.current.value.functions[0];
  for (const [revName, program] of revisions) {
    const kernels = (cudaSource(program, 'f').match(/__global__ void/g) ?? []).length;
    const plan = JSON.stringify(fusionPlan(program.current.value.functions[0]).segments.map(s => s.kind));
    for (const [ai, dims] of assignmentsFor(name).entries()) {
      const random = (() => {
        let seed = 1234 + ai;
        return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      })();
      const inputs = Object.fromEntries(
        fn.params.map(p => {
          const shape = p.shape.map(d => value(d, new Map(Object.entries(dims))));
          return [
            p.name,
            { shape, data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => 2 * random() - 1) },
          ];
        }),
      );
      const reference = runTix(program, 'f', inputs);
      const result = await runTixCuda(program, 'f', inputs);
      const a = new Uint32Array(reference.data.buffer, reference.data.byteOffset, reference.data.length);
      const b = new Uint32Array(result.data.buffer, result.data.byteOffset, result.data.length);
      const equal =
        JSON.stringify(reference.shape) === JSON.stringify(result.shape) &&
        a.length === b.length &&
        a.every((w, i) => w === b[i] || (Number.isNaN(reference.data[i]) && Number.isNaN(result.data[i])));
      if (!equal) {
        failures++;
        const bad = a.findIndex((w, i) => w !== b[i] && !(Number.isNaN(reference.data[i]) && Number.isNaN(result.data[i])));
        console.log('FAIL', name, revName, JSON.stringify(dims), 'at', bad, reference.data[bad], result.data[bad]);
      }
    }
    console.log(
      name.padEnd(8),
      revName.padEnd(9),
      'kernels:', kernels,
      'plan:', plan,
      failures === 0 ? 'ok' : failures + ' failures so far',
    );
  }
}
console.log(failures === 0 ? 'all bit-identical' : failures + ' FAILURES');
