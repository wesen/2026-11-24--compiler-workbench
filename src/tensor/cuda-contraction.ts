// IRWB-033-D: printing a contraction kernel of the schedule IR. Every number in the source (tile extents, thread
// counts, which dim each copy walks along, the launch rule) is read from the schedule; nothing is decided here.
//
// The kernel is one `template <int V>` definition. V = 0 is variant 0: one thread per output element, the members
// in registers, stage 2's scalar code (stage 3's thread mode). V > 0 is a tiled variant in the one printable form:
//   b.0 block.z, m.0 block.x, n.0 block.y, m.1 thread.y, n.1 thread.x, r.0 serial, r.1 unroll, m.2 unroll, n.2 unroll,
//   both operands staged in shared memory at r.0.
// Each thread keeps one accumulator per output of its m.2 x n.2 patch and adds the terms r = 0, 1, ... in order with
// __fmul_rn and __fadd_rn, as the scalar code does; tiles are zero beyond the extents, and a zero product added to an
// accumulator leaves it unchanged (the design's padding argument).
import type { Affine, Fn, Statement, Tensor } from './model.js';
import { visit } from './model.js';
import type { ContractionKernel, Dim, Loop, Variant } from './schedule.js';
import type { Reduce } from './fusion.js';

type Writer = {
  lines: string[];
  line: (code: string) => void;
  dim: (a: Affine) => string;
  alias: (id: string, name: string) => void;
  offset: (indices: readonly Affine[], shape: readonly Affine[]) => string;
  scalar: (e: Statement['expr']) => string;
  enter: () => void;
  leave: () => void;
};
type WriterFactory = (
  load: (e: Extract<Statement['expr'], { kind: 'load' }>, offset: Writer['offset']) => string,
  reduced?: (e: Reduce) => string | undefined,
) => Writer;

export interface TiledForm {
  bm: number;
  bn: number;
  bk: number;
  tm: number;
  tn: number;
  fast: { m: Dim; n: Dim };
  /** The dim whose tiles blockIdx.x numbers (the other is blockIdx.y). */
  gridX: 'm' | 'n';
}
const printable: [string, Loop['bind'] | 'block.x|y'][] = [
  ['b.0', 'block.z'],
  ['m.0', 'block.x|y'],
  ['n.0', 'block.x|y'],
  ['m.1', 'thread.y'],
  ['n.1', 'thread.x'],
  ['r.0', 'serial'],
  ['r.1', 'unroll'],
  ['m.2', 'unroll'],
  ['n.2', 'unroll'],
];
/** Variant 0's form (every output loop bound to `thread`), a tiled form, or why the variant is not printable. */
export function variantForm(v: Variant): 'plain' | TiledForm | string {
  const at = (id: string) => v.loops.find(l => l.id === id);
  if (
    v.loops.length === 4 &&
    v.loops.every(l => l.level === 0 && l.factor === null && l.bind === (l.dim === 'r' ? 'serial' : 'thread'))
  )
    return 'plain';
  for (const [i, [id, bind]] of printable.entries())
    if (
      v.loops[i]?.id !== id ||
      (bind === 'block.x|y' ? !['block.x', 'block.y'].includes(v.loops[i].bind) : v.loops[i].bind !== bind)
    )
      return `schedule not printable: expected loop ${i} to be ${id} bound to ${bind}, found ${v.loops[i]?.id ?? 'none'}`;
  if (v.loops.length !== printable.length) return 'schedule not printable: extra loops';
  const stage = (o: 'm' | 'n') => v.stages.find(s => s.operand === o && s.at === 'r.0');
  const sm = stage('m'),
    sn = stage('n');
  if (!sm || !sn || v.stages.length !== 2)
    return 'schedule not printable: both operands must be staged at r.0';
  const f = (id: string) => at(id)!.factor!;
  if (at('m.0')!.bind === at('n.0')!.bind) return 'schedule not printable: m.0 and n.0 share a block index';
  return {
    bm: f('m.1') * f('m.2'),
    bn: f('n.1') * f('n.2'),
    bk: f('r.1'),
    tm: f('m.2'),
    tn: f('n.2'),
    fast: { m: sm.fast, n: sn.fast },
    gridX: at('m.0')!.bind === 'block.x' ? 'm' : 'n',
  };
}

const product = (dims: string[]) =>
  dims.length ? `(${dims.map(d => `static_cast<U>(${d})`).join(' * ')})` : 'static_cast<U>(1)';

export function emitContraction(
  k: ContractionKernel,
  fn: Fn,
  dimensions: ReadonlyMap<string, string>,
  tensors: ReadonlyMap<string, Tensor>,
  tensorName: (name: string) => string,
  writer: WriterFactory,
) {
  const members = k.group.statements.map(n => tensors.get(n) as Statement);
  const inGroup = new Set(k.group.statements),
    stored = new Set(k.group.stored);
  const c = members.find(m => m.name === k.contraction)!;
  let reduce: Reduce | undefined;
  visit(c.expr, e => {
    if (e.kind === 'reduce') reduce = e;
  });
  const red = reduce!;
  const body = red.body as Extract<Statement['expr'], { kind: 'op' }>;
  const [xLoad, yLoad] = body.args as Extract<Statement['expr'], { kind: 'load' }>[];
  const reads = new Set<string>();
  for (const m of members)
    visit(m.expr, e => {
      if (e.kind === 'load' && !inGroup.has(e.name)) reads.add(e.name);
    });
  const outputs = members.filter(m => stored.has(m.name)).map(m => tensorName(m.name));
  const params = [
    ...Array.from(dimensions.values(), d => `I ${d}`),
    ...Array.from(reads, t => `const float* ${tensorName(t)}`),
    ...outputs.map(t => `float* ${t}`),
  ];
  const global = (e: Extract<Statement['expr'], { kind: 'load' }>, offset: Writer['offset']) =>
    `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name)!.shape)}]`;
  // The extent of each axis id of the contraction (output axes and reduction axes).
  const extent = new Map<string, Affine>([
    ...c.axes.map((a, p) => [a.id, c.shape[p]] as [string, Affine]),
    ...red.axes.map(a => [a.id, a.extent.dim] as [string, Affine]),
  ]);
  const position = new Map(c.axes.map((a, p) => [a.id, p]));
  const forms = k.variants.map(variantForm);
  forms.forEach(f => {
    if (typeof f === 'string' && f !== 'plain') throw Error(`${k.name}: ${f}`);
  });
  const name = k.name;
  const lines: string[] = [
    `// ${name}: ${k.group.statements.join(', ')}; contraction ${c.name}, m = (${k.dims.m}), n = (${k.dims.n}), b = (${k.dims.b}), r = (${k.dims.r}); variants ${forms
      .map(f => (typeof f === 'string' ? f : `${f.bm}x${f.bn}x${f.bk}/${f.tm}x${f.tn}`))
      .join(', ')}`,
    'template <int V>',
    // Registers are allocated for the variant's block size (probe 04: without the bound, variants 1 and 2 ran 1.7
    // and 2.2 times slower at 512^3).
    `__global__ void __launch_bounds__(${forms
      .map((f, v) => (typeof f === 'string' ? '' : `V == ${v} ? ${(f.bm / f.tm) * (f.bn / f.tn)} : `))
      .join('')}256) ${name}(${params.join(', ')}) {`,
  ];
  // Members after the accumulator: in order, a member read later is a register, the stored ones are written.
  const epilogue = (
    w: Writer,
    registers: Map<string, string>,
    store: (m: Statement, value: string) => void,
  ) => {
    for (const m of members) {
      m.axes.forEach((a, p) => w.alias(a.id, `o${p}`));
      const value = w.scalar(m.expr);
      registers.set(m.name, value);
      if (stored.has(m.name)) store(m, value);
    }
  };
  const memberLoad =
    (registers: Map<string, string>) =>
    (e: Extract<Statement['expr'], { kind: 'load' }>, offset: Writer['offset']) =>
      inGroup.has(e.name) ? registers.get(e.name)! : global(e, offset);
  forms.forEach((form, v) => {
    lines.push(`  ${v ? 'else ' : ''}if constexpr (V == ${v}) {`);
    const registers = new Map<string, string>();
    if (form === 'plain') {
      const w = writer(memberLoad(registers));
      w.enter();
      w.enter();
      w.line(`const U count = ${product(c.shape.map(w.dim))};`);
      w.line('const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;');
      w.line('if (thread >= count) return;');
      w.line('U coordinate = thread;');
      for (let p = c.axes.length - 1; p >= 0; --p) {
        w.line(`const I o${p} = coordinate % ${w.dim(c.shape[p])};`);
        if (p > 0) w.line(`coordinate /= ${w.dim(c.shape[p])};`);
      }
      epilogue(w, registers, (m, value) => w.line(`${tensorName(m.name)}[thread] = ${value};`));
      lines.push(...w.lines);
    } else {
      const f = form as TiledForm;
      let acc = 'acc[i][j]';
      const w = writer(memberLoad(registers), e => (e === red ? acc : undefined));
      w.enter();
      w.enter();
      const sizes = (d: Dim) => k.dims[d].map(a => w.dim(extent.get(a)!));
      w.line(`constexpr int BM = ${f.bm}, BN = ${f.bn}, BK = ${f.bk}, TM = ${f.tm}, TN = ${f.tn};`);
      w.line('constexpr int TX = BN / TN, T = (BM / TM) * TX;');
      w.line('__shared__ __align__(16) float As[BK][BM + 4];');
      w.line('__shared__ __align__(16) float Bs[BK][BN + 4];');
      w.line(
        `const U extent_m = ${product(sizes('m'))}, extent_n = ${product(sizes('n'))}, extent_r = ${product(sizes('r'))};`,
      );
      w.line('const int tx = threadIdx.x % TX, ty = threadIdx.x / TX;');
      const [mx, nx] = f.gridX === 'm' ? ['x', 'y'] : ['y', 'x'];
      w.line(`const U m0 = static_cast<U>(blockIdx.${mx}) * BM, n0 = static_cast<U>(blockIdx.${nx}) * BN;`);
      // Decode a flattened dim value into its axes, row-major (the dim's list order, the last fastest).
      const decode = (value: string, d: Dim, prefix: string) => {
        const axes = k.dims[d];
        if (axes.length === 1) {
          w.line(`const I ${prefix}0 = static_cast<I>(${value});`);
          w.alias(axes[0], `${prefix}0`);
          return;
        }
        w.line(`U ${prefix}rest = ${value};`);
        for (let i = axes.length - 1; i >= 0; --i) {
          w.line(
            `const I ${prefix}${i} = static_cast<I>(${i ? `${prefix}rest % static_cast<U>(${w.dim(extent.get(axes[i])!)})` : `${prefix}rest`});`,
          );
          if (i) w.line(`${prefix}rest /= static_cast<U>(${w.dim(extent.get(axes[i])!)});`);
          w.alias(axes[i], `${prefix}${i}`);
        }
      };
      if (k.dims.b.length) decode('static_cast<U>(blockIdx.z)', 'b', 'bz');
      w.line('float acc[TM][TN];');
      w.line('#pragma unroll');
      w.line('for (int i = 0; i < TM; ++i)');
      w.line('#pragma unroll');
      w.line('  for (int j = 0; j < TN; ++j) acc[i][j] = 0.0f;');
      w.line('for (U r0 = 0; r0 < extent_r; r0 += BK) {');
      w.enter();
      const copy = (operand: 'm' | 'n', load: typeof xLoad, buffer: string, tile: string) => {
        const fast = f.fast[operand];
        w.line('#pragma unroll');
        w.line(`for (int e = threadIdx.x; e < ${tile} * BK; e += T) {`);
        w.enter();
        w.line(
          fast === 'r'
            ? `const int kk = e % BK, ss = e / BK;`
            : `const int kk = e / ${tile}, ss = e % ${tile};`,
        );
        w.line(`const U s = ${operand}0 + ss, r = r0 + kk;`);
        w.line('float x = 0.0f;');
        w.line(`if (s < extent_${operand} && r < extent_r) {`);
        w.enter();
        decode('s', operand, 'a' + operand);
        decode('r', 'r', 'ar');
        w.line(`x = ${global(load, w.offset)};`);
        w.leave();
        w.line('}');
        w.line(`${buffer}[kk][ss] = x;`);
        w.leave();
        w.line('}');
      };
      copy('m', xLoad, 'As', 'BM');
      copy('n', yLoad, 'Bs', 'BN');
      w.line('__syncthreads();');
      w.line('#pragma unroll');
      w.line('for (int kk = 0; kk < BK; ++kk) {');
      w.enter();
      w.line('float a[TM], b[TN];');
      for (const [arr, buf, n, t] of [
        ['a', 'As', f.tm, 'ty * TM'],
        ['b', 'Bs', f.tn, 'tx * TN'],
      ] as const)
        if (n % 4 === 0) {
          w.line('#pragma unroll');
          w.line(
            `for (int q = 0; q < ${n}; q += 4) *reinterpret_cast<float4*>(&${arr}[q]) = *reinterpret_cast<const float4*>(&${buf}[kk][${t} + q]);`,
          );
        } else {
          w.line('#pragma unroll');
          w.line(`for (int q = 0; q < ${n}; ++q) ${arr}[q] = ${buf}[kk][${t} + q];`);
        }
      w.line('#pragma unroll');
      w.line('for (int i = 0; i < TM; ++i)');
      w.line('#pragma unroll');
      w.line('  for (int j = 0; j < TN; ++j) acc[i][j] = __fadd_rn(acc[i][j], __fmul_rn(a[i], b[j]));');
      w.leave();
      w.line('}');
      w.line('__syncthreads();');
      w.leave();
      w.line('}');
      w.line('#pragma unroll');
      w.line('for (int i = 0; i < TM; ++i)');
      w.line('#pragma unroll');
      w.line('  for (int j = 0; j < TN; ++j) {');
      w.enter();
      w.enter();
      w.line('const U m = m0 + ty * TM + i, n = n0 + tx * TN + j;');
      w.line('if (m >= extent_m || n >= extent_n) continue;');
      decode('m', 'm', 'om');
      decode('n', 'n', 'on');
      // The members' axes are the contraction's output axes, by position.
      for (const id of [...k.dims.b, ...k.dims.m, ...k.dims.n]) {
        const p = position.get(id)!;
        w.line(
          `const I o${p} = ${k.dims.b.includes(id) ? `bz${k.dims.b.indexOf(id)}` : k.dims.m.includes(id) ? `om${k.dims.m.indexOf(id)}` : `on${k.dims.n.indexOf(id)}`};`,
        );
      }
      acc = 'acc[i][j]';
      epilogue(w, registers, (m, value) => {
        const at = w.offset(
          m.axes.map(a => ({ constant: 0, terms: [[a.id, 1]] })),
          m.shape,
        );
        w.line(`${tensorName(m.name)}[${at}] = ${value};`);
      });
      w.leave();
      w.leave();
      w.line('}');
      lines.push(...w.lines);
    }
    lines.push('  }');
  });
  lines.push('}');

  // Host: extents, the grid of each variant, the launch rule (or --variant=N), the launch.
  const hostDim = (a: Affine) => writer(global).dim(a);
  const hostSizes = (d: Dim) => product(k.dims[d].map(a => hostDim(extent.get(a)!)));
  const host = [
    `  const U count_${name} = ${product(c.shape.map(hostDim))};`,
    `  const U extent_m_${name} = ${hostSizes('m')}, extent_n_${name} = ${hostSizes('n')}, extent_b_${name} = ${hostSizes('b')};`,
  ];
  forms.forEach((f, v) => {
    if (f === 'plain' || typeof f === 'string') return;
    host.push(
      `  const U grid_x_${name}_${v} = (extent_m_${name} + ${f.bm - 1}) / ${f.bm}, grid_y_${name}_${v} = (extent_n_${name} + ${f.bn - 1}) / ${f.bn};`,
      `  const bool fits_${name}_${v} = grid_${f.gridX === 'm' ? 'x' : 'y'}_${name}_${v} < (1ULL << 31) && grid_${f.gridX === 'm' ? 'y' : 'x'}_${name}_${v} <= 65535 && extent_b_${name} <= 65535;`,
      `  const U blocks_${name}_${v} = grid_x_${name}_${v} * grid_y_${name}_${v} * extent_b_${name};`,
    );
  });
  const rule = k.select
    .map(e =>
      e.variant === 0
        ? '0'
        : `fits_${name}_${e.variant} && blocks_${name}_${e.variant} >= ${e.minBlocks}ULL * sm_count ? ${e.variant} : `,
    )
    .join('');
  host.push(
    `  const int variant_${name} = variant_mode >= 0 && variant_mode < ${k.variants.length} && (variant_mode == 0 || ${
      forms
        .map((f, v) => (v && f !== 'plain' ? `(variant_mode == ${v} && fits_${name}_${v})` : ''))
        .filter(Boolean)
        .join(' || ') || 'false'
    }) ? variant_mode : ${rule.endsWith(': ') ? rule + '0' : rule};`,
  );
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, t => tensorName(t) + '.ptr'),
    ...outputs.map(t => t + '.ptr'),
  ].join(', ');
  const launches = forms.map((f, v) => {
    if (f === 'plain')
      return `      if (variant_${name} == ${v}) ${name}<${v}><<<(count_${name} - 1) / 256 + 1, 256>>>(${args});`;
    const t = f as TiledForm;
    const [gx, gy] = t.gridX === 'm' ? ['x', 'y'] : ['y', 'x'];
    return `      if (variant_${name} == ${v}) ${name}<${v}><<<dim3(static_cast<unsigned>(grid_${gx}_${name}_${v}), static_cast<unsigned>(grid_${gy}_${name}_${v}), static_cast<unsigned>(extent_b_${name})), ${(t.bm / t.tm) * (t.bn / t.tn)}>>>(${args});`;
  });
  return {
    code: lines.join('\n'),
    host,
    preload: `  if (count_${name}) {\n${forms.map((_, v) => `    check(cudaFuncGetAttributes(&attributes, ${name}<${v}>));`).join('\n')}\n  }`,
    hasWork: `count_${name}`,
    launch: `    if (count_${name}) {\n${launches.join('\n')}\n      check(cudaGetLastError());\n    }`,
  };
}
