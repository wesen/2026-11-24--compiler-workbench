import { cudaMain, cudaRuntime } from './cuda-runtime.js';
import type { TixProgram } from './index.js';
import {
  plain,
  width,
  type Affine,
  type Axis,
  type Expr,
  type Fn,
  type Module,
  type Op,
  type Statement,
} from './model.js';

export function functionNamed(module: Module, name: string): Fn {
  const fn = module.functions.find(f => f.name === name);
  if (!fn) throw Error('Unknown function ' + name);
  return fn;
}

type Names = Map<string, string>;
function affine(a: Affine, names: Names): string {
  const parts = [a.constant + 'LL', ...a.terms.map(([n, k]) => k + 'LL * ' + names.get(n)!)];
  return '(' + parts.join(' + ') + ')';
}
function bound({ extent }: Axis, dims: Names, indices: Names): string {
  const dim = affine(extent.dim, dims);
  if (extent.kind === 'dim') return dim;
  if (extent.kind === 'blocks') {
    const quotient = dim + ' / ' + width;
    return extent.rounding === 'ceil' ? '(' + quotient + ' + (' + dim + ' % ' + width + ' != 0))' : quotient;
  }
  return `min(${width}LL, ${dim} - ${width}LL * ${indices.get(extent.block)})`;
}

const ops: Record<Exclude<Op, 'neg'>, string> = {
  '+': '__fadd_rn',
  '-': '__fsub_rn',
  '*': '__fmul_rn',
  '/': '__fdiv_rn',
  exp: 'expf',
  log: 'logf',
  sqrt: '__fsqrt_rn',
  tanh: 'tanhf',
  max: 'tixMax',
  min: 'tixMin',
};

function kernel(stmt: Statement, id: number, tensors: Map<string, number>, shapes: Affine[][], dims: Names) {
  const lines: string[] = [];
  let depth = 1,
    temps = 0,
    binders = 0;
  const line = (s: string) => lines.push('  '.repeat(depth) + s);
  const indices: Names = new Map();
  const bind = (axis: Axis) => {
    const name = 'i' + binders++;
    indices.set(axis.id, name);
    return name;
  };
  function scalar(e: Expr): string {
    const name = 'v' + temps++;
    let rhs: string;
    switch (e.kind) {
      case 'literal': {
        const bits = new Uint32Array(Float32Array.of(Number(e.text)).buffer)[0];
        rhs = `__uint_as_float(0x${bits.toString(16)}u)`;
        break;
      }
      case 'shape':
        rhs = `__ll2float_rn(${dims.get(e.name)})`;
        break;
      case 'load': {
        const t = tensors.get(e.name)!;
        const offset = e.indices
          .map(a => affine(a, indices))
          .reduce((off, ix, j) => `(${off} * ${affine(shapes[t][j], dims)} + ${ix})`);
        rhs = `a->tensor[${t}][${offset}]`;
        break;
      }
      case 'op': {
        const args = e.args.map(scalar);
        rhs = e.op === 'neg' ? '-' + args[0] : ops[e.op] + '(' + args.join(', ') + ')';
        break;
      }
      case 'reduce': {
        line(`float ${name} = ${e.op === 'sum' ? '0.0f' : '-CUDART_INF_F'};`);
        for (const axis of e.axes) {
          const limit = bound(axis, dims, indices);
          const i = bind(axis);
          line(`for (Index ${i} = 0; ${i} < ${limit}; ++${i}) {`);
          depth++;
        }
        const body = scalar(e.body);
        line(`${name} = ${e.op === 'sum' ? '__fadd_rn' : 'tixMax'}(${name}, ${body});`);
        for (const axis of e.axes) {
          indices.delete(axis.id);
          depth--;
          line('}');
        }
        return name;
      }
    }
    line(`const float ${name} = ${rhs};`);
    return name;
  }
  line('const Index p = Index(blockIdx.x) * blockDim.x + threadIdx.x;');
  line('if (p >= count) return;');
  line('Index coordinate = p;');
  for (let j = stmt.axes.length - 1; j >= 0; j--) {
    const dim = affine(stmt.shape[j], dims);
    const i = bind(stmt.axes[j]);
    // No thread enters an empty output. Avoid emitting division by a literal zero.
    line(`const Index ${i} = coordinate % max(1LL, ${dim});`);
    line(`coordinate /= max(1LL, ${dim});`);
  }
  const result = scalar(stmt.expr);
  line(`a->tensor[${tensors.get(stmt.name)}][p] = ${result};`);
  return `__global__ void kernel${id}(const Args* a, Index count) {\n${lines.join('\n')}\n}\n`;
}

export function cudaSource(program: TixProgram, name: string): string {
  const fn = functionNamed(program.current.value, name);
  const all = [...fn.params, ...fn.statements];
  const tensors = new Map(all.map((t, i) => [t.name, i]));
  const shapes = all.map(t => t.shape);
  const dims: Names = new Map();
  const setup: string[] = [];
  for (const [i, p] of fn.params.entries()) {
    setup.push(`t[${i}].load(in, ${p.shape.length});`);
    p.shape.forEach((axis, j) => {
      const n = plain(axis);
      if (n && !dims.has(n)) {
        const binding = `a->dim[${dims.size}]`;
        dims.set(n, binding);
        setup.push(`${binding} = t[${i}].shape[${j}];`);
      }
    });
  }
  const launches: string[] = [];
  for (const [k, s] of fn.statements.entries()) {
    const id = tensors.get(s.name)!;
    const shape = s.shape.map(a => `uint64_t(${affine(a, dims)})`).join(', ');
    setup.push(`t[${id}].allocate({${shape}});`, `hasWork |= t[${id}].count != 0;`);
    launches.push(
      `if (t[${id}].count) kernel${k}<<<(t[${id}].count + 127) / 128, 128>>>(device, t[${id}].count);`,
    );
  }
  return `${cudaRuntime}
struct Args { Index dim[${Math.max(1, dims.size)}]; float* tensor[${all.length}]; };
${fn.statements.map((s, i) => kernel(s, i, tensors, shapes, dims)).join('\n')}
static void runCase(std::istream& in, std::ostream& out, uint32_t repeats) {
  Tensor t[${all.length}];
  Args args{}, *a = &args, *device = nullptr;
  bool hasWork = false;
  ${setup.join('\n  ')}
  if (hasWork) {
    for (size_t i = 0; i < ${all.length}; ++i) a->tensor[i] = t[i].data;
    check(cudaMalloc(&device, sizeof(args)));
    check(cudaMemcpy(device, a, sizeof(args), cudaMemcpyHostToDevice));
  }
  auto times = execute([&]() {
    ${launches.join('\n    ')}
  }, repeats, hasWork);
  t[${tensors.get(fn.result)}].store(out, times);
  if (device) check(cudaFree(device));
}
${cudaMain}`;
}
