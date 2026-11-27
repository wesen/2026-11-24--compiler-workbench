import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { encodeCudaCases } from '../../../../../../dist/tensor/cuda-runtime.js';
import { value } from '../../../../../../dist/tensor/model.js';

const exec = promisify(execFile);
const requested = process.argv.slice(2);
const programs = {
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  large: { M: 4096, K: 4096, N: 4096 },
};

// Each sequence records per-phase event pairs adjacent to the unchanged launches. Collect
// its three individual intervals after the function's final stream event has synchronized.
function instrumentPhases(source, fused, count) {
  const start = 'gpu_ms = time_kernels([&] {';
  const [preamble, tail] = source.split(start);
  const ending = '  }, benchmark);';
  const [body, rest] = tail.split(ending);
  let cursor = 0;
  const wrap = code => {
    const i = cursor++;
    return `\n    check(cudaEventRecord(phase_start[${i}].handle));\n${code}\n    check(cudaEventRecord(phase_stop[${i}].handle));\n`;
  };
  const measured = fused
    ? body.replaceAll(/    \/\/ begin schedule phase \d+\n([\s\S]*?)    \/\/ end schedule phase \d+/g, (_, phase) => wrap(phase))
    : body.replaceAll(/    if \(t\d+\.size\) \{[\s\S]*?\n    \}/g, wrap);
  if (cursor !== count) throw Error('Expected ' + count + ' phase launches, got ' + cursor);
  // The observer variant is invoked once after synchronization per measured iteration.
  const observed = preamble.replace(
    'template <class Launch> static double time_kernels(const Launch& launch, bool benchmark)',
    'template <class Launch, class Observe> static double time_kernels(const Launch& launch, bool benchmark, const Observe& observe)',
  ).replace('    check(cudaEventElapsedTime(&ms[i], start.handle, stop.handle));',
    '    check(cudaEventElapsedTime(&ms[i], start.handle, stop.handle));\n    observe();');
  const work = observed.lastIndexOf('  if (');
  return observed.slice(0,work) +
    `  std::array<Event, ${count}> phase_start, phase_stop;\n` + observed.slice(work) +
    start + measured + `  }, benchmark, [&] {
    for (int p = 0; p < ${count}; ++p) {
      float elapsed;
      check(cudaEventElapsedTime(&elapsed, phase_start[p].handle, phase_stop[p].handle));
      printf("phase %d %.9f\\n", p, elapsed);
    }
  });` + rest;
}

function instrumentClock(source) {
  return '#include <atomic>\n#include <cstdlib>\n#include <thread>\n' + source.replace(
    '  if (benchmark) {\n    launch();',
    `  std::atomic<bool> done{false};
  std::thread clock_sampler([&] {
    do {
      std::system("nvidia-smi --query-gpu=clocks.current.sm,clocks.current.memory,temperature.gpu --format=csv,noheader,nounits");
    } while (!done.load());
  });
  if (benchmark) {
    launch();`,
  ).replace(
    '  return ms[repeats / 2];',
    '  done = true;\n  clock_sampler.join();\n  return ms[repeats / 2];',
  );
}

for (const key of requested.length ? requested : Object.keys(programs)) {
  const name = key === 'large' ? 'matmul' : key;
  const program = compileTix(await readFile('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  const dimensions = new Map(Object.entries(programs[key]));
  const inputs = Object.fromEntries(fn.params.map((p, j) => {
    const shape = p.shape.map(d => value(d, dimensions));
    return [p.name, {
      shape,
      data: Float32Array.from({ length: shape.reduce((a,b) => a*b, 1) }, (_, i) =>
        (((i + 1) * (257 + 2 * j)) % 8191 - 4095) / 2 ** 18),
    }];
  }));
  const fusedPhases = name === 'mlp' ? 2 : 3;
  const paths = new Map();
  try {
    for (const fuse of [true, false]) {
      const path = await mkdtemp(join(tmpdir(), 'irwb-033-phase-'));
      paths.set(fuse, path);
      const source = cudaSource(program, name, { fuse });
      const instrumented = key === 'large' ? instrumentClock(source) :
        instrumentPhases(source, fuse, fuse ? fusedPhases : fn.statements.length);
      await writeFile(join(path, 'main.cu'), instrumented);
      await writeFile(join(path, 'inputs.bin'), encodeCudaCases(fn, [inputs]));
    }
    for (let i = 0; i < (key === 'large' ? 1 : 5); i++) {
      for (const [fuse, path] of paths) {
        const {stdout} = await exec(process.execPath, ['tools/cuda-remote.mjs', path, '--timed',
          '--runtime-input', 'inputs.bin', '--', '--benchmark']);
        const {stdout: evidence} = JSON.parse(stdout);
        const samples = {};
        for (const match of evidence.matchAll(/^phase (\d+) ([.\d]+)$/gm))
          (samples[match[1]] ??= []).push(Number(match[2]));
        if (key !== 'large' && Object.keys(samples).length !== (fuse ? fusedPhases : fn.statements.length))
          throw Error('Missing timing samples: ' + evidence);
        const medians = Object.fromEntries(Object.entries(samples).map(([phase, all]) =>
          [phase, all.sort((a,b) => a-b)[1]]));
        console.log(JSON.stringify({ key, fuse, run: i, medians,
          ...(key === 'large' && { clock: evidence.trim().split('\n') }) }));
      }
    }
  } finally {
    await Promise.all([...paths.values()].map(path => rm(path, { recursive: true, force: true })));
  }
}
