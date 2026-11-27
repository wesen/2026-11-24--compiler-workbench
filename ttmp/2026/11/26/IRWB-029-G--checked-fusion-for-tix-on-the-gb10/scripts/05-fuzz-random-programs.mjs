// Random programs, three ways: the f32 meaning, the fused lowering and stage 2's lowering, word for word.
//
// The generator builds programs from the supported core - elementwise chains with permuted reads, row reductions with
// their producers and consumers, transposed reads and a contraction - and checks every case against the interpreter.
// Cases are batched into one GPU run per program and lowering.
//
//   node <ticket>/scripts/05-fuzz-random-programs.mjs [count] [seed]
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, runTix } = await import(new URL('dist/tensor/index.js', root));
const { emitCuda } = await import(new URL('dist/tensor/cuda-source.js', root));
const { runCudaBatch } = await import(new URL('dist/tensor/cuda-runtime.js', root));

const count = Number(process.argv[2] ?? 10);
let seed = Number(process.argv[3] ?? 1);
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = list => list[Math.floor(random() * list.length)];
const kernels = text => (text.match(/__global__ void/g) ?? []).length;

/** A program over a:N,N b:N,N r:N. Rank-2 statements are [N,N], so permutations stay well formed. */
function program() {
  const statements = [];
  const defined = [['a', 2], ['b', 2], ['r', 1]];
  let next = 0;
  const fresh = () => 's' + next++;
  const reference = rank => {
    // bias towards the statement just defined, so chains and epilogues actually appear
    const usable = defined.filter(([, r]) => (rank === 1 ? true : r === 2));
    const last = usable.at(-1);
    const [name, other] = last[0].startsWith('s') && random() < 0.65 ? last : pick(usable);
    if (other === 1) return `${name}[${rank === 1 ? 'i' : 'i'}]`;
    return random() < 0.5 ? `${name}[i,j]` : `${name}[j,i]`;
  };
  const scalar = rank => {
    const choice = random();
    if (choice < 0.4) return reference(rank);
    if (choice < 0.55) return (0.5 + random()).toFixed(3);
    if (choice < 0.65) return 'N';
    if (choice < 0.75) return `${pick(['exp', 'sqrt', 'tanh', 'log'])}(${scalar(rank)})`;
    return `(${scalar(rank)} ${pick(['+', '-', '*', '/'])} ${scalar(rank)})`;
  };
  const add = (name, rank, text) => {
    statements.push(`${name}[${rank === 1 ? 'i' : 'i,j'}] = ${text};`);
    defined.push([name, rank]);
    return name;
  };
  const shape = pick(['chain', 'chain', 'chain', 'rowreduce', 'contract', 'two-row']);
  if (shape === 'chain') for (let k = 0; k < 3; k++) add(fresh(), 2, scalar(2));
  if (shape === 'rowreduce') {
    const m = add(fresh(), 1, `${pick(['sum(j)', 'max(j)'])} a[i,j]`);
    const e = add(fresh(), 2, `exp(a[i,j] - ${m}[i])`);
    const s = add(fresh(), 1, `sum(j) ${e}[i,j]`);
    add(fresh(), 2, `${e}[i,j] / ${s}[i] + b[i,j]`);
  }
  if (shape === 'two-row') {
    const m = add(fresh(), 1, `max(j) b[i,j]`);
    const s = add(fresh(), 1, `sum(j) b[j,i]`);
    add(fresh(), 2, `${m}[i] * ${s}[j] + r[j]`);
  }
  if (shape === 'contract') {
    const c = add(fresh(), 2, `${pick(['sum(k)', 'max(k)'])} a[i,k] * b[k,j]`);
    add(fresh(), 2, `${c}[i,j] + ${c}[j,i]`);
  }
  const [result, rank] = defined.at(-1);
  return `fn f(a:f32[N,N], b:f32[N,N], r:f32[N]):f32[${rank === 1 ? 'N' : 'N,N'}] {\n  ${statements.join('\n  ')}\n  return ${result};\n}`;
}

const shapes = [1, 2, 3, 4, 5, 7];
const streams = ['signed', 'positive', 'half'];
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
const words = data => new Uint32Array(data.buffer, data.byteOffset, data.length);
const equal = (x, y) => {
  const a = words(x),
    b = words(y);
  return a.length === b.length && a.every((w, i) => w === b[i]);
};

let failures = 0,
  cases = 0,
  checked = 0;
for (let p = 0; p < count; p++) {
  const source = program();
  let compiled;
  try {
    compiled = compileTix(source);
  } catch (error) {
    console.log('program', p, 'rejected by the front end:', String(error.message));
    continue;
  }
  checked++;
  const fn = compiled.current.value.functions[0];
  const inputs = [];
  for (const n of shapes)
    for (const stream of streams) {
      const make = size =>
        Float32Array.from({ length: size }, (_, i) => {
          switch (stream) {
            case 'signed':
              return 2 * random() - 1;
            case 'positive':
              return 1 + random();
            default:
              return half[i % half.length];
          }
        });
      inputs.push({
        a: { shape: [n, n], data: make(n * n) },
        b: { shape: [n, n], data: make(n * n) },
        r: { shape: [n], data: make(n) },
      });
    }
  const plain = await runCudaBatch(emitCuda(fn, false), fn, inputs);
  const fused = await runCudaBatch(emitCuda(fn, true), fn, inputs);
  let bad = 0;
  inputs.forEach((input, i) => {
    const expected = runTix(compiled, 'f', input);
    cases++;
    if (!equal(expected.data, fused[i].data) || !equal(expected.data, plain[i].data)) bad++;
  });
  failures += bad;
  console.log(
    'program',
    String(p).padStart(2),
    'kernels',
    kernels(emitCuda(fn, false)),
    '->',
    kernels(emitCuda(fn, true)),
    bad ? `MISMATCH on ${bad} cases` : `all ${inputs.length} cases identical`,
  );
  if (bad) console.log(source);
}
console.log(
  failures
    ? `FAILURES on ${failures} of ${cases} cases`
    : `${checked} programs, all ${cases} cases identical in f32 words`,
);
