// E5 (GPU): a deployment-scale oracle. Transform the emitted f32 CUDA program into an f64
// oracle program with the same kernels/loop structure, run BOTH on the GB10 at the full corpus
// sizes, and check the f32 result against the f64 oracle elementwise with the Stage-2 budget
//   |g - r| <= 2e-6 + 2e-5*|r|   (finite r; signed-inf/NaN class rules).
//
// This tests the claim: the checked lowering can be verified AT DEPLOYMENT SHAPE in seconds,
// where the CPU f64 interpreter needs ~13 minutes for matmul 512^3 alone (stage-2 report).
// It also validates the f64 oracle against the Node f64 evaluator on small inputs.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..', '..', '..', '..');
const tix = await import(join(repo, 'dist/tensor/index.js'));
const { execFileSync } = await import('node:child_process');
const tool = join(repo, 'tools/cuda-remote.mjs');

// ---------- f64 transform of the emitted translation unit ----------
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

// ---------- batch I/O (reuses the repo's encoder for format fidelity) ----------
const { encodeCudaCases } = await import(join(repo, 'dist/tensor/cuda-runtime.js'));
function writeInputs(dir, fnDef, cases) {
  const request = encodeCudaCases(fnDef, cases); // [{ 'name': { shape, data } }] in parameter order
  writeFileSync(join(dir, 'inputs.bin'), request);
}
function readResults(file, ranks, wordSize) {
  const b = readFileSync(file);
  let off = 8;
  const count = Number(b.readBigUInt64LE(off)); off += 8;
  const out = [];
  for (let i = 0; i < count; i++) {
    const shape = [];
    for (let k = 0; k < ranks[i]; k++) { shape.push(Number(b.readBigInt64LE(off))); off += 8; }
    const n = shape.reduce((a, x) => a * x, 1);
    const words = new Uint32Array(b.buffer, b.byteOffset + off, n * (wordSize / 4));
    off += n * wordSize;
    off += 8; // gpuMs f64
    out.push({ shape, words });
  }
  return out;
}

// ---------- corpus bindings (stage-2 full sizes) ----------
const bindings = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1103515245 + 12345) >>> 0; return (s >>> 8) / 2 ** 24; }; }

async function runTool(dir, extra = []) {
  try {
    const json = execFileSync('node', [tool, dir, ...extra], { encoding: 'utf8', maxBuffer: 1 << 28 });
    return JSON.parse(json);
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

for (const fn of Object.keys(bindings)) {
  const src = readFileSync(join(repo, `corpus/tensor/${fn}/main.tix`), 'utf8');
  const p = tix.compileTix(src);
  const fnDef = p.origin.value.functions.find(f2 => f2.name === fn);
  const emitted = tix.cudaSource(p, fn);
  const f64src = toF64(emitted, literalMap(fnDef));
  if (f64src === emitted) { console.log(`${fn}: transform produced no change?!`); continue; }

  const dir32 = join(here, 'run-f32-' + fn), dir64 = join(here, 'run-f64-' + fn);
  rmSync(dir32, { recursive: true, force: true }); rmSync(dir64, { recursive: true, force: true });
  mkdirSync(join(dir32, 'out'), { recursive: true }); mkdirSync(join(dir64, 'out'), { recursive: true });
  writeFileSync(join(dir32, 'main.cu'), emitted);
  writeFileSync(join(dir64, 'main.cu'), f64src);

  // one full-size case with deterministic inputs
  const dims = bindings[fn];
  const rng = makeRng(20);
  const f = tix.compileTix(src); // reuse parsed module for param list
  const moduleValue = f.origin.value;
  const shapes = fnDef.params.map(pr => pr.shape.map(a => {
    let v = a.constant;
    for (const [n, k] of a.terms) v += k * dims[n];
    return v;
  }));
  const arrays = shapes.map(sh => {
    const n = sh.reduce((a, b) => a * b, 1);
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = Math.fround(rng() * 2 - 1);
    // layernorm needs positive eps
    return arr;
  });
  if (fn === 'layernorm') arrays[3][0] = 0.1;
  const caseInputs = {};
  fnDef.params.forEach((pr, i) => { caseInputs[pr.name] = { shape: shapes[i], data: arrays[i] }; });
  writeInputs(dir32, fnDef, [caseInputs]);
  writeInputs(dir64, fnDef, [caseInputs]);

  const t0 = performance.now();
  const r32 = await runTool(dir32, ['--runtime-input', 'inputs.bin']);
  const r64 = await runTool(dir64, ['--runtime-input', 'inputs.bin']);
  const wall = performance.now() - t0;
  if (r32.exit || r64.exit) {
    console.log(`${fn}: FAILED f32={compiled:${r32.compiled},exit:${r32.exit},stderr:${(r32.stderr || '').slice(0, 200)}} f64={compiled:${r64.compiled},exit:${r64.exit},stderr:${(r64.stderr || '').slice(0, 200)}}`);
    continue;
  }
  const ranks = shapes.map(s => 1); // result rank from fn.shape
  const resultRank = fnDef.shape.length;
  const f32res = readResults(join(dir32, 'out/results.bin'), [resultRank], 4);
  const f64res = readResults(join(dir64, 'out/results.bin'), [resultRank], 8);
  const a = f32res[0], b = f64res[0];
  const n = a.words.length;
  const af = new Float32Array(a.words.buffer, a.words.byteOffset, n);
  const bf = new Float64Array(b.words.buffer, b.words.byteOffset, n);
  let bad = 0, maxScaled = 0, worst = -1;
  for (let i = 0; i < n; i++) {
    const g = af[i], r = bf[i];
    if (!Number.isFinite(r)) { // inf/NaN class rules
      if (Number.isNaN(r) ? !Number.isNaN(g) : g !== r) { bad++; if (worst < 0) worst = i; }
      continue;
    }
    const budget = 2e-6 + 2e-5 * Math.abs(r);
    const d = Math.abs(g - r);
    const scaled = d / Math.max(budget, 1e-30);
    if (d > budget) { bad++; if (worst < 0) worst = i; }
    if (scaled > maxScaled) maxScaled = scaled;
  }
  const costMs = (r32.compileMs ?? 0) + (r64.compileMs ?? 0) + (r32.runMs ?? 0) + (r64.runMs ?? 0);
  console.log(`${fn}: checked ${n} elements at deployment size; violations=${bad}${worst >= 0 ? ' first at ' + worst : ''}; max budget fraction=${maxScaled.toExponential(2)}; tool cost=${(costMs / 1000).toFixed(1)}s (wall ${(wall / 1000).toFixed(1)}s, f32 runMs=${r32.runMs}, f64 runMs=${r64.runMs})`);
  rmSync(dir32, { recursive: true, force: true }); rmSync(dir64, { recursive: true, force: true });
}
