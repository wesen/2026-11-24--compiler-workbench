// Shared code generators for IRWB-023-C experiments 10 and 12 (moved verbatim from 10-rowfuse.mjs).
// emitRowKernel: one fused block-per-row kernel for a row-local Tix function (see 10-rowfuse.mjs).
// emitContraction and planFunction were added for experiment 12.
export function makeGen({ plain, visit }) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function literal(text) {
    const v = new DataView(new ArrayBuffer(4));
    v.setFloat32(0, Number(text));
    return `__uint_as_float(0x${v.getUint32(0).toString(16)}u)`;
  }

  function emitRowKernel(fn, kname) {
    const dims = new Map(), dimSource = [];
    fn.params.forEach((p, pi) =>
      p.shape.forEach((a, ax) => {
        const k = plain(a);
        if (k && !dims.has(k)) {
          dims.set(k, `d${dims.size}`);
          dimSource.push([pi, ax]);
        }
      }),
    );
    const affine = (a, nameOf) => {
      const terms = a.terms.map(([k, c]) => (c === 1 ? nameOf(k) : `${c}LL * ${nameOf(k)}`));
      if (a.constant || !terms.length) terms.unshift(`${a.constant}LL`);
      return `(${terms.join(' + ')})`;
    };
    const dim = a => affine(a, k => dims.get(k));
    const params = new Map(fn.params.map((p, i) => [p.name, i]));
    const stmts = new Map(fn.statements.map(s => [s.name, s]));
    const rowDim = fn.statements[0].axes[0].extent.dim;
    for (const s of fn.statements) {
      if (s.axes.length < 1 || s.axes.length > 2 || !same(s.axes[0].extent.dim, rowDim))
        throw Error(`${fn.name}: not row-local (${s.name})`);
      visit(s.expr, e => {
        if (e.kind === 'reduce' && e.axes.some(a => a.extent.kind !== 'dim')) throw Error('only origin extents');
        if (e.kind === 'load' && !params.has(e.name)) {
          const row = s.axes[0].id;
          if (!same(e.indices[0], { constant: 0, terms: [[row, 1]] })) throw Error(`${fn.name}: ${e.name} read off-row`);
        }
      });
    }
    const result = stmts.get(fn.result);
    if (!result) throw Error('result must be a statement');
    const rank2 = fn.statements.filter(s => s.axes.length === 2 && s.name !== fn.result);
    const rank1 = fn.statements.filter(s => s.axes.length === 1);

    const L = [];
    let indent = '  ', tmp = 0, loopVar = 0, redSlot = 0;
    const line = c => L.push(indent + c);
    const temp = c => {
      const n = `v${tmp++}`;
      line(`float ${n} = ${c};`);
      return n;
    };
    function scalar(e, env) {
      switch (e.kind) {
        case 'cvar':
          return e.code;
        case 'literal':
          return literal(e.text);
        case 'shape':
          return `__ll2float_rn(${dims.get(e.name)})`;
        case 'load': {
          const idx = e.indices.map(a => affine(a, k => env.get(k)));
          if (params.has(e.name)) {
            const shape = fn.params[params.get(e.name)].shape;
            const off = idx.reduce((acc, x, i) => (i ? `(${acc} * ${dim(shape[i])} + ${x})` : x), '');
            return `p${params.get(e.name)}[${off}]`;
          }
          const t = stmts.get(e.name);
          return t.axes.length === 2 ? `s_${e.name}[${idx[1]}]` : `sc_${e.name}`;
        }
        case 'op': {
          const [a, b] = e.args.map(x => scalar(x, env));
          const bin = { '+': '__fadd_rn', '-': '__fsub_rn', '*': '__fmul_rn', '/': '__fdiv_rn' }[e.op];
          if (bin) return temp(`${bin}(${a}, ${b})`);
          if (e.op === 'neg') return temp(`-(${a})`);
          if (e.op === 'sqrt') return temp(`__fsqrt_rn(${a})`);
          if (e.op === 'exp') return temp(`FAST ? fast_exp(${a}) : __double2float_rn(exp(static_cast<double>(${a})))`);
          if (e.op === 'tanh') return temp(`FAST ? fast_tanh(${a}) : __double2float_rn(tanh(static_cast<double>(${a})))`);
          if (e.op === 'log') return temp(`__double2float_rn(log(static_cast<double>(${a})))`);
          return temp(`rf_minmax(${a}, ${b}, ${e.op === 'max'})`);
        }
        case 'reduce': {
          // Sequential, in one thread, exactly as Stage 2 emits it.
          const acc = temp(e.op === 'sum' ? '0.0f' : '-INFINITY');
          const inner = new Map(env);
          for (const ax of e.axes) {
            const v = `k${loopVar++}`;
            inner.set(ax.id, v);
            line(`for (I ${v} = 0; ${v} < ${dim(ax.extent.dim)}; ++${v}) {`);
            indent += '  ';
          }
          const x = scalar(e.body, inner);
          line(`${acc} = ${e.op === 'sum' ? `__fadd_rn(${acc}, ${x})` : `rf_minmax(${acc}, ${x}, true)`};`);
          for (const _ of e.axes) {
            indent = indent.slice(2);
            line('}');
          }
          return acc;
        }
      }
    }
    const sig = [
      ...[...dims.values()].map(d => `I ${d}`),
      ...fn.params.map((_, i) => `const float* __restrict__ p${i}`),
      'float* __restrict__ out',
    ];
    L.push(`template <int FAST> __global__ void ${kname}(${sig.join(', ')}) {`);
    line('extern __shared__ float smem[];');
    line('__shared__ float red[32];');
    if (rank1.length) line(`__shared__ float ${rank1.map(s => 'sc_' + s.name).join(', ')};`);
    line('const I r = blockIdx.x;');
    line('float* cursor = smem;');
    const smemTerms = [];
    for (const s of rank2) {
      line(`float* s_${s.name} = cursor; cursor += ${dim(s.shape[1])};`);
      smemTerms.push(dim(s.shape[1]));
    }
    line('float* scratch = cursor;');
    const scratchTerms = ['1LL'];
    for (const s of fn.statements) {
      line(`// ${s.name}`);
      const rowEnv = new Map([[s.axes[0].id, 'r']]);
      if (s.axes.length === 2) {
        const n = dim(s.shape[1]);
        line(`for (I j = threadIdx.x; j < ${n}; j += blockDim.x) {`);
        indent += '  ';
        const v = scalar(s.expr, new Map([...rowEnv, [s.axes[1].id, 'j']]));
        line(s.name === fn.result ? `out[r * ${n} + j] = ${v};` : `s_${s.name}[j] = ${v};`);
        indent = indent.slice(2);
        line('}');
        line('__syncthreads();');
        continue;
      }
      // Per-row statement: parallel bodies of top-level reductions, then ordered folds or join trees.
      const replaced = [];
      const lift = e => {
        if (e.kind === 'reduce') {
          replaced.push(e);
          return { kind: 'cvar', code: `red[${redSlot++}]` };
        }
        if (e.kind === 'op') return { ...e, args: e.args.map(lift) };
        return e;
      };
      const expr = lift(s.expr);
      replaced.forEach((R, idx) => {
        const slot = `red[${redSlot - replaced.length + idx}]`;
        if (R.axes.length !== 1) {
          line('if (threadIdx.x == 0) {');
          indent += '  ';
          line(`${slot} = ${scalar(R, rowEnv)};`);
          indent = indent.slice(2);
          line('}');
          line('__syncthreads();');
          return;
        }
        const n = dim(R.axes[0].extent.dim);
        scratchTerms.push(n);
        line(`for (I j = threadIdx.x; j < ${n}; j += blockDim.x) {`);
        indent += '  ';
        line(`scratch[j] = ${scalar(R.body, new Map([...rowEnv, [R.axes[0].id, 'j']]))};`);
        indent = indent.slice(2);
        line('}');
        line('__syncthreads();');
        if (R.op === 'max') {
          line(`{ float m = -INFINITY; for (I j = threadIdx.x; j < ${n}; j += blockDim.x) m = rf_minmax(m, scratch[j], true);`);
          line(`  m = rf_block_max(m); if (threadIdx.x == 0) ${slot} = m; }`);
        } else {
          line(`if (threadIdx.x == 0) { float acc = 0.0f; for (I j = 0; j < ${n}; ++j) acc = __fadd_rn(acc, scratch[j]); ${slot} = acc; }`);
        }
        line('__syncthreads();');
      });
      line('if (threadIdx.x == 0) {');
      indent += '  ';
      const v = scalar(expr, rowEnv);
      line(s.name === fn.result ? `out[r] = ${v};` : `sc_${s.name} = ${v};`);
      indent = indent.slice(2);
      line('}');
      line('__syncthreads();');
    }
    L.push('}');
    if (redSlot > 32) throw Error('too many reductions');
    const dimArgs = [...dims.values()].map(d => `I ${d}`).join(', ');
    const host = [
      `static I ${kname}_rows(${dimArgs}) { return ${dim(rowDim)}; }`,
      `static I ${kname}_inner(${dimArgs}) { return ${result.axes.length === 2 ? dim(result.shape[1]) : '1LL'}; }`,
      `static I ${kname}_smem(${dimArgs}) { return ${[...smemTerms, `std::max<I>({${scratchTerms.join(', ')}})`].join(' + ')}; }`,
    ];
    return { code: L.join('\n') + '\n' + host.join('\n'), dims: [...dims.values()], dimSource, nParams: fn.params.length };
  }

  // emitContraction (experiment 12): a tiled 64x64x8 kernel (4x4 per thread) for a statement
  //   t[i, j] = E(sum(k) X * Y)  where X, Y are loads indexed by plain binders, one using (i, k) and the
  // other (k, j) in either order, and E is any expression of the sum and of loads indexed by i and/or j.
  // Each output folds k in increasing order in one thread, as in experiment 01; E is emitted with the
  // Stage 2 intrinsics on the finished accumulator. Returns undefined if the statement does not match.
  function matchContraction(s) {
    if (s.axes.length !== 2) return undefined;
    const [i, j] = s.axes.map(a => a.id);
    const reduces = [];
    visit(s.expr, e => e.kind === 'reduce' && reduces.push(e));
    if (reduces.length !== 1) return undefined;
    const R = reduces[0];
    if (R.op !== 'sum' || R.axes.length !== 1 || R.body.kind !== 'op' || R.body.op !== '*') return undefined;
    const k = R.axes[0].id;
    const ids = l => (l.kind === 'load' ? l.indices.map(a => plain(a)) : []);
    const [L1, L2] = R.body.args;
    if (L1.kind !== 'load' || L2.kind !== 'load' || [...ids(L1), ...ids(L2)].some(x => x === undefined)) return undefined;
    const uses = (l, a, b) => ids(l).length === 2 && ids(l).includes(a) && ids(l).includes(b);
    const left = uses(L1, i, k) && uses(L2, k, j) ? 0 : uses(L2, i, k) && uses(L1, k, j) ? 1 : -1;
    if (left < 0) return undefined;
    let outside = true;
    const check = e => {
      if (e === R) return;
      if (e.kind === 'reduce') outside = false;
      if (e.kind === 'load' && e.indices.some(a => !(plain(a) === i || plain(a) === j))) outside = false;
      if (e.kind === 'op') e.args.forEach(check);
    };
    check(s.expr);
    return outside ? { i, j, k, R, A: left === 0 ? L1 : L2, B: left === 0 ? L2 : L1 } : undefined;
  }

  function emitContraction(fn, s, tensors, kname) {
    const m = matchContraction(s);
    if (!m) throw Error('not a contraction');
    const dims = new Map();
    fn.params.forEach(p => p.shape.forEach(a => { const n = plain(a); if (n && !dims.has(n)) dims.set(n, `d${dims.size}`); }));
    const affine = (a, nameOf) => {
      const terms = a.terms.map(([n, c]) => (c === 1 ? nameOf(n) : `${c}LL * ${nameOf(n)}`));
      if (a.constant || !terms.length) terms.unshift(`${a.constant}LL`);
      return `(${terms.join(' + ')})`;
    };
    const dim = a => affine(a, n => dims.get(n));
    const index = new Map(tensors.map((t, ti) => [t.name, ti]));
    const load = (e, env) => {
      const shape = tensors[index.get(e.name)].shape;
      const idx = e.indices.map(a => affine(a, n => env.get(n)));
      return `p${index.get(e.name)}[${idx.reduce((acc, x, q) => (q ? `(${acc} * ${dim(shape[q])} + ${x})` : x), '')}]`;
    };
    const L = [];
    let tmp = 0;
    const temp = c => { const n = `e${tmp++}`; L.push(`        float ${n} = ${c};`); return n; };
    const scalar = (e, env) => {
      if (e === m.R) return 'acc[mm][nn]';
      switch (e.kind) {
        case 'literal': return literal(e.text);
        case 'shape': return `__ll2float_rn(${dims.get(e.name)})`;
        case 'load': return load(e, env);
        case 'op': {
          const [a, b] = e.args.map(x => scalar(x, env));
          const bin = { '+': '__fadd_rn', '-': '__fsub_rn', '*': '__fmul_rn', '/': '__fdiv_rn' }[e.op];
          if (bin) return temp(`${bin}(${a}, ${b})`);
          if (e.op === 'neg') return temp(`-(${a})`);
          if (e.op === 'sqrt') return temp(`__fsqrt_rn(${a})`);
          if (e.op === 'exp') return temp(`FAST ? fast_exp(${a}) : __double2float_rn(exp(static_cast<double>(${a})))`);
          if (e.op === 'tanh') return temp(`FAST ? fast_tanh(${a}) : __double2float_rn(tanh(static_cast<double>(${a})))`);
          if (e.op === 'log') return temp(`__double2float_rn(log(static_cast<double>(${a})))`);
          return temp(`rf_minmax(${a}, ${b}, ${e.op === 'max'})`);
        }
      }
      throw Error('unsupported epilogue node ' + e.kind);
    };
    const env = new Map([[m.i, 'gi'], [m.j, 'gj']]);
    const value = scalar(s.expr, env);
    const epilogue = L.join('\n');
    const Mx = dim(s.shape[0]), Nx = dim(s.shape[1]), Kx = dim(m.R.axes[0].extent.dim);
    const sig = [...dims.values()].map(d => `I ${d}`).concat(tensors.map((_, ti) => `const float* __restrict__ p${ti}`), ['float* __restrict__ out']);
    const code = `template <int FAST> __global__ void __launch_bounds__(256) ${kname}(${sig.join(', ')}) {
  __shared__ float As[8][64];
  __shared__ float Bs[8][64];
  const int tid = threadIdx.x, tr = tid / 16, tc = tid % 16;
  const I row0 = (I)blockIdx.y * 64, col0 = (I)blockIdx.x * 64, Mx = ${Mx}, Nx = ${Nx}, Kx = ${Kx};
  float acc[4][4];
  for (int mm = 0; mm < 4; ++mm) for (int nn = 0; nn < 4; ++nn) acc[mm][nn] = 0.0f;
  for (I k0 = 0; k0 < Kx; k0 += 8) {
    const I kLen = Kx - k0 < 8 ? Kx - k0 : 8;
    for (int e = tid; e < 512; e += 256) {
      const int r = e / 8, c = e % 8;
      const I ${'gi'} = row0 + r, kk = k0 + c;
      As[c][r] = (gi < Mx && c < kLen) ? ${load(m.A, new Map([[m.i, 'gi'], [m.k, 'kk']]))} : 0.0f;
    }
    for (int e = tid; e < 512; e += 256) {
      const int r = e / 64, c = e % 64;
      const I kk = k0 + r, gj = col0 + c;
      Bs[r][c] = (r < kLen && gj < Nx) ? ${load(m.B, new Map([[m.k, 'kk'], [m.j, 'gj']]))} : 0.0f;
    }
    __syncthreads();
    for (int kk = 0; kk < kLen; ++kk) {
      float a[4], b[4];
#pragma unroll
      for (int mm = 0; mm < 4; ++mm) a[mm] = As[kk][tr * 4 + mm];
#pragma unroll
      for (int nn = 0; nn < 4; ++nn) b[nn] = Bs[kk][tc * 4 + nn];
#pragma unroll
      for (int mm = 0; mm < 4; ++mm)
#pragma unroll
        for (int nn = 0; nn < 4; ++nn) acc[mm][nn] = __fadd_rn(acc[mm][nn], __fmul_rn(a[mm], b[nn]));
    }
    __syncthreads();
  }
  for (int mm = 0; mm < 4; ++mm)
    for (int nn = 0; nn < 4; ++nn) {
      const I gi = row0 + tr * 4 + mm, gj = col0 + tc * 4 + nn;
      if (gi < Mx && gj < Nx) {
${epilogue}
        out[gi * Nx + gj] = ${value};
      }
    }
}
static dim3 ${kname}_grid(${[...dims.values()].map(d => `I ${d}`).join(', ')}) { return dim3((unsigned)((${Nx} + 63) / 64), (unsigned)((${Mx} + 63) / 64)); }`;
    return { code, dims: [...dims.values()] };
  }

  // planFunction (experiment 12): split the function at contraction statements. Each contraction gets a
  // tiled kernel; each maximal run of other statements becomes one row-fused kernel whose inputs are the
  // original parameters plus every tensor materialized so far. Exactly one tensor of a row group may be
  // read outside it (that tensor is the group's output).
  function planFunction(fn) {
    const kernels = [];
    const materialized = [];
    const readLater = (from, name) =>
      fn.statements.slice(from).some(t => { let hit = false; visit(t.expr, e => { if (e.kind === 'load' && e.name === name) hit = true; }); return hit; });
    let q = 0;
    while (q < fn.statements.length) {
      const s = fn.statements[q];
      const tensors = [...fn.params, ...materialized];
      if (matchContraction(s)) {
        const kname = `ct_${fn.name}_${q}`;
        kernels.push({ kind: 'contraction', kname, out: s, nTensors: tensors.length, ...emitContraction(fn, s, tensors, kname) });
        materialized.push({ name: s.name, shape: s.shape });
        q++;
        continue;
      }
      let end = q;
      while (end < fn.statements.length && !matchContraction(fn.statements[end])) end++;
      const group = fn.statements.slice(q, end);
      const outs = group.filter(t => t.name === fn.result || readLater(end, t.name));
      if (outs.length !== 1) throw Error(`${fn.name}: row group ${q}..${end} has ${outs.length} outputs`);
      const sub = { name: `${fn.name}_g${q}`, params: tensors, statements: group.slice(0, group.indexOf(outs[0]) + 1), result: outs[0].name, shape: outs[0].shape };
      const kname = `rg_${fn.name}_${q}`;
      kernels.push({ kind: 'row', kname, out: outs[0], nTensors: tensors.length, ...emitRowKernel(sub, kname) });
      materialized.push({ name: outs[0].name, shape: outs[0].shape });
      q = end;
    }
    return { kernels, materialized };
  }

  return { emitRowKernel, emitContraction, matchContraction, planFunction, literal, same };
}
