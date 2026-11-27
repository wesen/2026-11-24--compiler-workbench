// Random Tix programs for the fusion tests (IRWB-029-E): statements drawn from the shapes fusion decides about
// (elementwise chains, broadcasts of row and column reductions, epilogues, contractions that read a row).
export function randomProgram(seed) {
  let state = Math.imul(seed + 1, 2654435761) >>> 0;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  // tensors: the newest half of the time, so that statements tend to feed each other
  const pick = list => (random() < 0.5 ? list.at(-1) : list[Math.floor(random() * list.length)]);
  // every tensor has one of these shapes
  const pool = { NM: ['x', 'u'], N: [], M: ['w'], NK: [] };
  const lines = [];
  let last = 'x',
    lastShape = 'NM',
    count = 0;
  const unary = a =>
    pick([`exp(${a})`, `tanh(${a})`, `sqrt(${a} * ${a})`, `-${a}`, `${a}`, `log(${a} * ${a} + 1)`]);
  const op = () => pick(['+', '-', '*', '/']);
  const templates = [
    () => ['NM', `[i,j] = ${unary(`${pick(pool.NM)}[i,j]`)} ${op()} ${pick(pool.NM)}[i,j]`],
    () => ['NM', `[i,j] = max(${pick(pool.NM)}[i,j], ${pick(pool.M)}[j]) ${op()} 0.5`],
    () => pool.N.length && ['NM', `[i,j] = ${pick(pool.NM)}[i,j] ${op()} ${pick(pool.N)}[i]`],
    () => pool.N.length && ['NM', `[i,j] = ${unary(`${pick(pool.NM)}[i,j] - ${pick(pool.N)}[i]`)}`],
    () => ['N', `[i] = ${pick(['sum', 'max'])}(j) ${pick(pool.NM)}[i,j]`],
    () => [
      'N',
      `[i] = (sum(j) ${pick(pool.NM)}[i,j] * ${pick(pool.NM)}[i,j]) / M + ${pick(['1', 'N', '0.25'])}`,
    ],
    () => ['N', `[i] = sum(j) ${pick(pool.NM)}[i,j] * ${pick(pool.M)}[j]`],
    () => pool.N.length && ['N', `[i] = ${unary(`${pick(pool.N)}[i]`)} ${op()} ${pick(pool.N)}[i]`],
    () => ['M', `[j] = ${pick(['sum', 'max'])}(i) ${pick(pool.NM)}[i,j]`],
    () => pool.N.length && ['NM', `[i,j] = ${pick(pool.N)}[i] * ${pick(pool.M)}[j]`],
    () => ['NK', `[i,k] = (sum(j) ${pick(pool.NM)}[i,j] * v[j,k]) + ${pick(['0', '1'])}`],
    () => pool.NK.length && ['NK', `[i,k] = ${unary(`${pick(pool.NK)}[i,k]`)}`],
    () => pool.NK.length && ['N', `[i] = max(k) ${pick(pool.NK)}[i,k]`],
  ];
  const length = 2 + Math.floor(random() * 5);
  while (count < length) {
    const made = pick(templates)();
    if (!made) continue;
    const [shape, text] = made;
    last = `t${count++}`;
    lines.push(`  ${last}${text};`);
    pool[shape].push(last);
    lastShape = shape;
  }
  const type = { NM: 'f32[N,M]', N: 'f32[N]', M: 'f32[M]', NK: 'f32[N,K]' }[lastShape];
  return `fn f(x: f32[N,M], u: f32[N,M], w: f32[M], v: f32[M,K]): ${type} {\n${lines.join('\n')}\n  return ${last};\n}`;
}
