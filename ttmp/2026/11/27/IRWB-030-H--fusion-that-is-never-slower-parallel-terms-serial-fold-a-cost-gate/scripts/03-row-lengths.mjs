// IRWB-030-H script 03: where does block mode lose? A row-length sweep at a fixed element count.
//
// Fused block mode runs one block per row, with the block's threads covering the row: a row shorter than a warp
// leaves lanes idle (a factor ceil(L/32)/L on every parallel phase), while stage 2's flattened kernels keep every
// lane busy but move several more tensors. This script measures the two lowerings for the same programs at row
// lengths 8…1024 (N chosen so every program has 4,194,304 elements), for a row program with a double exp in it
// (`softmax`) and a row program without one (`normalize`), so the lane waste can be separated from the exp cost.
//
//   node <ticket>/scripts/03-row-lengths.mjs [--runs=1]
import { compileTix, loweredTix, runTixCuda } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const programs = {
  softmax: `fn softmax(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  e[i,j] = exp(x[i,j] - m[i]);
  s[i] = sum(j) e[i,j];
  y[i,j] = e[i,j] / s[i];
  return y;
}`,
  normalize: `fn normalize(x: f32[N,C]): f32[N,C] {
  m[i] = max(j) x[i,j];
  e[i,j] = x[i,j] - m[i];
  s[i] = sum(j) e[i,j];
  y[i,j] = e[i,j] / s[i];
  return y;
}`,
};
const total = 4194304;
const args = process.argv.slice(2);
const runs = Number(args.find(a => a.startsWith('--runs='))?.slice(7) ?? 1);
const names = args.filter(a => !a.startsWith('--'));
const cArgs = args.find(a => a.startsWith('--c='))?.slice(4);
const lengths = cArgs ? cArgs.split(',').map(Number) : [8, 16, 32, 64, 128, 256, 1024];
const kernelCount = source => (source.match(/__global__ void/g) ?? []).length;

for (const name of names.length ? names : Object.keys(programs)) {
  const program = compileTix(programs[name]);
  const fn = program.current.value.functions[0];
  for (const C of lengths) {
    const N = total / C;
    const shape = [N, C];
    const random = seededRandom(20);
    const data = {
      x: { shape, data: Float32Array.from({ length: total }, () => 0.2 * random() - 0.1) },
    };
    const row = { name, N, C, lanes: Math.ceil(C / 32) / (C / 32) };
    for (const fuse of [true, false]) {
      const label = fuse ? 'fused' : 'unfused';
      // with the launch's shapes, so "fused" is the lowering the gate lets this launch run
      const lowered = loweredTix(program, fn.name, { fuse, shapes: { N, C } });
      const source = lowered.source;
      if (fuse) row.gate = lowered.gate ? (lowered.gate.fuse ? 'fuse' : 'unfused') : 'plan-time';
      const times = [];
      for (let i = 0; i < runs; i++)
        times.push((await runTixCuda(program, fn.name, data, { fuse, benchmark: true })).gpuMs);
      times.sort((a, b) => a - b);
      row[label] = { kernels: kernelCount(source), gpuMs: +times[times.length >> 1].toFixed(4) };
    }
    row.unfusedOverFused = +(row.unfused.gpuMs / row.fused.gpuMs).toFixed(3);
    console.log(JSON.stringify(row));
  }
}
