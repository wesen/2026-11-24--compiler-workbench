// IRWB-030-F script 06: the staging refusals and the thread cap, measured.
//   1. A bare-load reduction refused (softmax's s: sum over a row buffer) against the same reduction staged by
//      multiplying each term by 1 (exact for every f32 word, including NaN as a class): if staging bought
//      anything, the staged variant would be faster; it only adds a shared round trip and a barrier.
//   2. The costly body (layernorm-inside's mean and variance, a division per term): the staged instantiation
//      against the serial one, by flipping the host's `staged_k0` choice in the same source.
//   3. The block-mode thread cap on the staged kernel: 64, 128 and 256 threads (source patch of the cap).
// Each number: three benchmark calls, median first. GB10, under the runner's --timed lock.
//   node ttmp/2026/11/27/IRWB-030-F--*/scripts/06-staging-probes.mjs
import { readFileSync } from 'node:fs';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix, cudaSource, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { value } from '../../../../../../dist/tensor/model.js';

const random = seededRandom(20);
const round = x => Math.round(x * 1e4) / 1e4;
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
async function times(source, fn, inputs, patch, n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [r] = await runCudaBatch(patch ? patch(source) : source, fn, [inputs], { benchmark: true });
    out.push(round(r.gpuMs));
  }
  return [median(out), ...out];
}
function inputs(fn, dims) {
  const map = new Map(Object.entries(dims));
  return Object.fromEntries(
    fn.params.map(p => {
      const shape = p.shape.map(d => value(d, map));
      return [
        p.name,
        { shape, data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () => 0.2 * random() - 0.1) },
      ];
    }),
  );
}

const N = 4096, C = 1024;

// 1. A bare load refused against the same reduction staged by a multiplication by 1.
const bare = compileTix(
  `fn f(x: f32[N,C]): f32[N,C] { e[i,j] = exp(x[i,j] - 1); s[i] = sum(j) e[i,j]; y[i,j] = e[i,j] / s[i]; return y; }`,
);
const stagedOne = compileTix(
  `fn f(x: f32[N,C]): f32[N,C] { e[i,j] = exp(x[i,j] - 1); s[i] = sum(j) e[i,j] * 1; y[i,j] = e[i,j] / s[i]; return y; }`,
);
const fnBare = bare.current.value.functions[0];
const x = inputs(fnBare, { N, C }).x;
const a = await times(cudaSource(bare, 'f'), fnBare, { x });
const b = await times(cudaSource(stagedOne, 'f'), stagedOne.current.value.functions[0], { x });
console.log(JSON.stringify({ probe: 'bare-load refusal', serial: a, stagedByMulOne: b, ratio: Math.round((b[0] / a[0]) * 1e3) / 1e3 }));

// 2. The costly body: staged instantiation against the serial one of the same source.
const inside = compileTix(readFileSync('corpus/tensor/layernorm-inside/main.tix', 'utf8'));
const fnInside = inside.current.value.functions.find(f => f.name === 'layernorm');
{
  const map = new Map([
    ['N', N],
    ['D', C],
  ]);
  const build = Object.fromEntries(
    fnInside.params.map(p => {
      const shape = p.shape.map(d => value(d, map));
      return [
        p.name,
        {
          shape,
          data: Float32Array.from({ length: shape.reduce((n, d) => n * d, 1) }, () =>
            p.name === 'eps' ? 1e-5 : 0.2 * random() - 0.1,
          ),
        },
      ];
    }),
  );
  const source = cudaSource(inside, 'layernorm');
  const staged = await times(source, fnInside, build);
  const serial = await times(source, fnInside, build, s => s.replace(/const bool staged_k0 =.*;/, 'const bool staged_k0 = false;'));
  console.log(JSON.stringify({ probe: 'costly body (mean and variance, a division per term)', staged, serialInstantiation: serial, ratio: Math.round((serial[0] / staged[0]) * 1e3) / 1e3 }));
  // 3. The thread cap on rows-only block-mode kernels, with and without staged reductions (stage 3 measured
  // 128 without staging; staging parallelizes the row-scalar phase across the block, so the cap is re-measured).
  const programs = {};
  {
    const corpusLayernorm = compileTix(readFileSync('corpus/tensor/layernorm/main.tix', 'utf8'));
    const fnL = corpusLayernorm.current.value.functions.find(f => f.name === 'layernorm');
    programs['layernorm'] = [corpusLayernorm, fnL, inputs(fnL, { N, D: C })];
    const corpusSoftmax = compileTix(readFileSync('corpus/tensor/softmax/main.tix', 'utf8'));
    const fnS = corpusSoftmax.current.value.functions.find(f => f.name === 'softmax');
    programs['softmax'] = [corpusSoftmax, fnS, inputs(fnS, { N, C })];
    programs['layernorm-inside'] = [inside, fnInside, build];
  }
  for (const [name, [p, fn, inns]] of Object.entries(programs)) {
    const source = cudaSource(p, fn.name);
    for (const cap of [64, 128, 256, 512]) {
      const t = await times(
        source,
        fn,
        inns,
        s => s.replace(/std::min<U>\(128, \(longest_/g, `std::min<U>(${cap}, (longest_`),
      );
      console.log(JSON.stringify({ probe: 'thread cap', program: name, cap, gpuMs: t }));
    }
  }
}
