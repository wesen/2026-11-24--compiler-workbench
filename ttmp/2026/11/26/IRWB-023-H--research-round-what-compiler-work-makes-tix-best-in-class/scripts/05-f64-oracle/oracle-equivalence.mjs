// Literal words: the emitter writes Math.fround(Number(text)) as an f32 bit pattern. The f64
// oracle must use Number(text) at double precision (that is what the CPU f64 evaluator does),
// so we map each emitted f32 word back to its full-precision double bits via the IR.
function literalMap(fnDef) {
  const map = new Map();
  const visit = e => {
    if (e.kind === 'literal') {
      const f32bits = new Uint32Array(new Float32Array([Math.fround(Number(e.text))]).buffer)[0];
      const f64bits = new BigUint64Array(new Float64Array([Number(e.text)]).buffer)[0];
      const key = '0x' + f32bits.toString(16) + 'u';
      const existing = map.get(key);
      if (existing !== undefined && existing !== f64bits) throw Error('Literal word collision for ' + key);
      map.set(key, f64bits);
    }
    if (e.kind === 'op') e.args.forEach(visit);
    if (e.kind === 'reduce') visit(e.body);
  };
  for (const s of fnDef.statements) visit(s.expr);
  return map;
}

// E5b: validate the GPU f64 oracle against the Node f64 evaluator on small inputs.
// Expectation: bit-identical for +,-,*,/,sqrt (IEEE, same trees); transcendentals (exp/log/tanh)
// may differ in the last ulp between CUDA's double libm and V8's — quantify how often.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..', '..', '..');
const tix = await import(join(repo, 'dist/tensor/index.js'));
const { encodeCudaCases } = await import(join(repo, 'dist/tensor/cuda-runtime.js'));
const tool = join(repo, 'tools/cuda-remote.mjs');

function toF64(src, literals = new Map()) {
  let s = src;
  s = s.replace('std::array<float, 3> ms{}', 'std::array<FLOATKEEP, 3> ms{}'); // cudaEventElapsedTime needs float
  s = s.replace(/__uint_as_float\(0x([0-9a-f]+)u\)/g, (m, hex) => {
    const f64 = literals.get('0x' + hex + 'u');
    return f64 !== undefined
      ? `__longlong_as_double(0x${f64.toString(16).padStart(16, '0')}ULL)`
      : m; // not a known literal (e.g. the NaN constant) — leave to the generic rules
  });
  s = s.replace(/__double2float_rn\(/g, '('); // transcendental path already computes in double
  s = s.replace(/__ll2float_rn/g, '__ll2double_rn');
  s = s.replace(/__uint_as_float\(0x7fc00000\)/g, '__longlong_as_double(0x7ff8000000000000ULL)');
  s = s.replace(/__float_as_uint/g, '__double_as_longlong');
  s = s.replace(/unsigned x = /g, 'unsigned long long x = ');
  s = s.replace(/, y = /g, ', y = '); // y declared alongside x; fix its type below
  s = s.replace(/unsigned long long x = __double_as_longlong\(a\), y = /g,
    'unsigned long long x = __double_as_longlong(a), y = ');
  s = s.replace(/__fadd_rn/g, '__dadd_rn').replace(/__fsub_rn/g, '__dsub_rn')
    .replace(/__fmul_rn/g, '__dmul_rn').replace(/__fdiv_rn/g, '__ddiv_rn')
    .replace(/__fsqrt_rn/g, '__dsqrt_rn');
  s = s.replace(/\bfloat\b/g, 'double');
  s = s.replace(/0\.0f/g, '0.0');
  s = s.replace(/FLOATKEEP/g, 'float');
  // inputs arrive as f32 words; stage as float, then widen exactly to double
  s = s.replace(/std::vector<double> host_(\w+)\(elements\((\w+)\)\);\s*\n\s*read\(input, host_\1\.data\(\), host_\1\.size\(\)\);/g,
    (m, name, shape) =>
      `std::vector<float> staged_${name}(elements(${shape}));\n  read(input, staged_${name}.data(), staged_${name}.size());\n  std::vector<double> host_${name}(staged_${name}.begin(), staged_${name}.end());`);
  return s;
}
function readResults64(file, rank) {
  const b = readFileSync(file);
  let off = 16;
  const shape = [];
  for (let k = 0; k < rank; k++) { shape.push(Number(b.readBigInt64LE(off))); off += 8; }
  const n = shape.reduce((a, x) => a * x, 1);
  return { shape, data: new Float64Array(b.buffer, b.byteOffset + off, n) };
}
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 2 ** 24; }; }

const small = {
  matmul: { M: 9, K: 7, N: 5 },
  softmax: { N: 6, C: 11 },
  layernorm: { N: 5, D: 13 },
  attention: { Q: 5, K: 7, D: 8, V: 4 },
  mlp: { N: 4, D: 6, H: 9, O: 3 },
  conv2d: { N: 2, C: 3, H: 7, W: 6, O: 4 },
};
for (const fn of Object.keys(small)) {
  const src = readFileSync(join(repo, `corpus/tensor/${fn}/main.tix`), 'utf8');
  const p = tix.compileTix(src);
  const fnDef = p.origin.value.functions.find(f => f.name === fn);
  const f64src = toF64(readFileSync('/tmp/emitted-' + fn + '.cu', 'utf8'), literalMap(fnDef));
  const dir = join(here, 'val-' + fn);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(dir, 'main.cu'), f64src);
  const dims = small[fn];
  const rng = makeRng(31);
  const inputs = {};
  for (const pr of fnDef.params) {
    const shape = pr.shape.map(a => { let v = a.constant; for (const [n, k] of a.terms) v += k * dims[n]; return v; });
    const arr = new Float32Array(shape.reduce((a, b) => a * b, 1));
    for (let i = 0; i < arr.length; i++) arr[i] = Math.fround(rng() * 2 - 1);
    inputs[pr.name] = { shape, data: arr };
  }
  if (fn === 'layernorm') inputs.eps.data[0] = 0.1;
  writeFileSync(join(dir, 'inputs.bin'), encodeCudaCases(fnDef, [inputs]));
  let json;
  try { json = JSON.parse(execFileSync('node', [tool, dir, '--runtime-input', 'inputs.bin'], { encoding: 'utf8' })); }
  catch (e) { json = JSON.parse(e.stdout); }
  if (json.exit) { console.log(`${fn}: GPU f64 run failed: ${json.stderr}`); continue; }
  const gpu = readResults64(join(dir, 'out/results.bin'), fnDef.shape.length);
  const cpu = tix.runTix(p, fn, inputs, { precision: 'f64' });
  const n = cpu.data.length;
  let bitMis = 0, maxUlp = 0, worst = -1;
  const gu = new BigUint64Array(gpu.data.buffer, gpu.data.byteOffset, n);
  const cu = new BigUint64Array(cpu.data.buffer, cpu.data.byteOffset, n);
  for (let i = 0; i < n; i++) {
    if (gu[i] !== cu[i]) {
      bitMis++;
      const d = Math.abs(gpu.data[i] - cpu.data[i]);
      const scale = Math.max(Math.abs(cpu.data[i]), 1e-300);
      const ulp = d / (scale * 2 ** -52);
      if (ulp > maxUlp) { maxUlp = ulp; worst = i; }
    }
  }
  console.log(`${fn}: CPU-f64 vs GPU-f64 oracle: ${n - bitMis}/${n} bit-identical; mismatches ${bitMis} (max ${maxUlp.toFixed(2)} ulp${worst >= 0 ? ' at ' + worst : ''})`);
  rmSync(dir, { recursive: true, force: true });
}
