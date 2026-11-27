// E6 (GPU): the checked optimizer's own output, judged at deployment scale.
// - Time the emitted matmul kernels for the ORIGINAL and the split-sum-optimized revision.
// - Run the f64 oracle (transformed from the optimized tree) at 512^3 and report the budget
//   fraction the split-sum rewrite actually uses at deployment size, versus what its sampled
//   gate (shapes with sums of length <= 7) observed.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..', '..', '..');
const tix = await import(join(repo, 'dist/tensor/index.js'));
const { encodeCudaCases } = await import(join(repo, 'dist/tensor/cuda-runtime.js'));
const tool = join(repo, 'tools/cuda-remote.mjs');

function literalMap(fnDef) {
  const map = new Map();
  const visit = e => {
    if (e.kind === 'literal') {
      const f32bits = new Uint32Array(new Float32Array([Math.fround(Number(e.text))]).buffer)[0];
      const f64bits = new BigUint64Array(new Float64Array([Number(e.text)]).buffer)[0];
      const key = '0x' + f32bits.toString(16) + 'u';
      if (map.has(key) && map.get(key) !== f64bits) throw Error('collision');
      map.set(key, f64bits);
    }
    if (e.kind === 'op') e.args.forEach(visit);
    if (e.kind === 'reduce') visit(e.body);
  };
  for (const s of fnDef.statements) visit(s.expr);
  return map;
}
function toF64(src, literals) {
  let s = src;
  s = s.replace('std::array<float, 3> ms{}', 'std::array<FLOATKEEP, 3> ms{}');
  s = s.replace(/__uint_as_float\(0x([0-9a-f]+)u\)/g, (m, hex) => {
    const f64 = literals.get('0x' + hex + 'u');
    return f64 !== undefined ? `__longlong_as_double(0x${f64.toString(16).padStart(16, '0')}ULL)` : m;
  });
  s = s.replace(/__double2float_rn\(/g, '(');
  s = s.replace(/__ll2float_rn/g, '__ll2double_rn');
  s = s.replace(/__uint_as_float\(0x7fc00000\)/g, '__longlong_as_double(0x7ff8000000000000ULL)');
  s = s.replace(/__float_as_uint/g, '__double_as_longlong');
  s = s.replace(/unsigned x = /g, 'unsigned long long x = ');
  s = s.replace(/__fadd_rn/g, '__dadd_rn').replace(/__fsub_rn/g, '__dsub_rn')
    .replace(/__fmul_rn/g, '__dmul_rn').replace(/__fdiv_rn/g, '__ddiv_rn')
    .replace(/__fsqrt_rn/g, '__dsqrt_rn');
  s = s.replace(/\bfloat\b/g, 'double');
  s = s.replace(/0\.0f/g, '0.0').replace(/FLOATKEEP/g, 'float');
  s = s.replace(/std::vector<double> host_(\w+)\(elements\((\w+)\)\);\s*\n\s*read\(input, host_\1\.data\(\), host_\1\.size\(\)\);/g,
    (m, name, shape) =>
      `std::vector<float> staged_${name}(elements(${shape}));\n  read(input, staged_${name}.data(), staged_${name}.size());\n  std::vector<double> host_${name}(staged_${name}.begin(), staged_${name}.end());`);
  return s;
}
function readResults(file, rank, wordSize) {
  const b = readFileSync(file);
  let off = 16;
  const shape = [];
  for (let k = 0; k < rank; k++) { shape.push(Number(b.readBigInt64LE(off))); off += 8; }
  const n = shape.reduce((a, x) => a * x, 1);
  const words = new Uint32Array(b.buffer, b.byteOffset + off, n * (wordSize / 4));
  return { shape, words };
}
function runTool(dir, extra = []) {
  try { return JSON.parse(execFileSync('node', [tool, dir, ...extra], { encoding: 'utf8', maxBuffer: 1 << 28 })); }
  catch (e) { if (e.stdout) return JSON.parse(e.stdout); throw e; }
}
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 2 ** 24; }; }

const src = readFileSync(join(repo, 'corpus/tensor/matmul/main.tix'), 'utf8');
const origin = tix.compileTix(src);
const opt = tix.optimizeTix(origin, ['split-sum']);
console.log('optimize steps:', JSON.stringify(opt.steps));

const fnDef = origin.origin.value.functions.find(f => f.name === 'matmul');
const dims = { M: 512, K: 512, N: 512 };
const rng = makeRng(20);
const inputs = {};
for (const pr of fnDef.params) {
  const shape = pr.shape.map(a => { let v = a.constant; for (const [n, k] of a.terms) v += k * dims[n]; return v; });
  const arr = new Float32Array(shape.reduce((a, b) => a * b, 1));
  for (let i = 0; i < arr.length; i++) arr[i] = Math.fround(rng() * 2 - 1);
  inputs[pr.name] = { shape, data: arr };
}

for (const [label, program] of [['original', origin], ['split-sum', opt.program]]) {
  const emitted = tix.cudaSource(program, 'matmul');
  const dir32 = join(here, 'e6-' + label + '-f32'), dir64 = join(here, 'e6-' + label + '-f64');
  for (const d of [dir32, dir64]) { rmSync(d, { recursive: true, force: true }); mkdirSync(join(d, 'out'), { recursive: true }); }
  writeFileSync(join(dir32, 'main.cu'), emitted);
  writeFileSync(join(dir64, 'main.cu'), toF64(emitted, literalMap(program.current.value.functions.find(f => f.name === 'matmul'))));
  writeFileSync(join(dir32, 'inputs.bin'), encodeCudaCases(fnDef, [inputs]));
  writeFileSync(join(dir64, 'inputs.bin'), encodeCudaCases(fnDef, [inputs]));
  const r32 = runTool(dir32, ['--timed', '--runtime-input', 'inputs.bin', '--', '--benchmark']);
  const r64 = runTool(dir64, ['--runtime-input', 'inputs.bin']);
  if (r32.exit || r64.exit) { console.log(`${label}: FAILED`, (r32.stderr || r64.stderr || '').slice(0, 200)); continue; }
  const f32r = readResults(join(dir32, 'out/results.bin'), 2, 4);
  const f64r = readResults(join(dir64, 'out/results.bin'), 2, 8);
  
  const af = new Float32Array(f32r.words.buffer, f32r.words.byteOffset, f32r.words.length);
  const bf = new Float64Array(f64r.words.buffer, f64r.words.byteOffset, f64r.words.length / 2);
  let bad = 0, maxScaled = 0;
  for (let i = 0; i < af.length; i++) {
    const g = af[i], r = bf[i];
    if (!Number.isFinite(r)) continue;
    const d = Math.abs(g - r), budget = 2e-6 + 2e-5 * Math.abs(r);
    if (d > budget) bad++;
    maxScaled = Math.max(maxScaled, d / budget);
  }
  console.log(`${label}: gpuMs(median of 3) parsed below; checked ${af.length} elements; violations=${bad}; max budget fraction=${maxScaled.toExponential(2)}`);
  // extract the benchmark median the emitted host printed? It writes gpuMs into the response: re-read tail
  const b32 = readFileSync(join(dir32, 'out/results.bin'));
  const gpuMs = b32.readDoubleLE(b32.length - 8);
  console.log(`${label}: gpuMs=${gpuMs}`);
  rmSync(dir32, { recursive: true, force: true }); rmSync(dir64, { recursive: true, force: true });
}
