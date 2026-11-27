// Probe 03: kernel count, fusion decisions, and the global bytes each kernel reads and writes, for the corpus at
// the brief's sizes, fused and unfused.
//
// Two byte counts, because one number cannot say what the memory system does:
//   issued   — every load and store instruction × 4 bytes, summed over the threads that run it. This is what L1 and
//              L2 have to serve, and an upper bound on DRAM traffic.
//   distinct — per kernel and tensor, min(issued, tensor size): the compulsory traffic, and a lower bound on DRAM
//              traffic (exact when the kernel reads a whole tensor, an over-estimate when it reads a slice).
// The time at 244 GB/s is given for both, so a measured time can be read against the two.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/03-bytes.mjs
import { readFileSync } from 'node:fs';

const { compileTix, cudaSource } = await import(new URL('dist/tensor/index.js', `file://${process.cwd()}/`));
const { fusePlan, loadSites, stagedIndex } = await import(
  new URL('dist/tensor/fusion.js', `file://${process.cwd()}/`)
);

const sizes = {
  matmul: { M: 512, K: 512, N: 512 },
  softmax: { N: 4096, C: 1024 },
  layernorm: { N: 4096, D: 1024 },
  attention: { Q: 1024, K: 1024, D: 64, V: 64 },
  mlp: { N: 1024, D: 256, H: 1024, O: 256 },
  conv2d: { N: 8, C: 16, H: 64, W: 64, O: 32 },
};
const rate = 244e6; // bytes per millisecond at 244 GB/s

const at = (affine, env) => affine.terms.reduce((v, [n, k]) => v + env[n] * k, affine.constant);
const elements = (shape, env) => shape.reduce((n, d) => n * at(d, env), 1);
const extent = (e, env) => (e.kind === 'blocks' ? Math.ceil(at(e.dim, env) / 4) : at(e.dim, env));

/** The plan of a lowering: stage 2's one-flat-kernel-per-statement plan, or the fused plan. */
export function planOf(fn, fuse) {
  if (fuse) return fusePlan(fn);
  return {
    fn,
    kernels: fn.statements.map((statement, i) => ({
      mapping: 'flat',
      rows: null,
      statements: [{ statement, storage: 'global', rule: 'kernel', kernel: i, slots: null }],
      prefetch: [],
    })),
    decisions: fn.statements.map((s, i) => ({ name: s.name, rule: 'kernel', kernel: i, storage: 'global' })),
  };
}

/** Issued and distinct global bytes one kernel reads and writes at `env`. */
export function kernelBytes(kernel, tensors, env) {
  const typed = Object.create(null);
  const charge = (tensor, bytes) => (typed[tensor] = (typed[tensor] ?? 0) + bytes);
  let issuedWrite = 0;
  const staged = new Map(
    kernel.statements.filter(p => p.storage === 'shared').map(p => [p.statement.name, { lane: p.slots }]),
  );
  const prefetched = new Map(kernel.prefetch.map(p => [p.tensor, p]));
  const redirect = (reader, tensor, scope, indices) => {
    const local = staged.get(tensor);
    if (local) return stagedIndex(reader, scope, indices, local.lane);
    const row = prefetched.get(tensor);
    return row ? stagedIndex(reader, scope, indices, row.extent) : false;
  };
  // A row kernel runs every statement once per block; a flat kernel covers the whole tensor with its grid.
  const blocks = kernel.mapping === 'row' ? at(kernel.rows, env) : 1;
  for (const p of kernel.statements) {
    const statement = p.statement;
    const threads =
      kernel.mapping === 'flat'
        ? elements(statement.shape, env)
        : blocks * (statement.axes.length === 2 ? at(statement.axes[1].extent.dim, env) : 1);
    // A staged load is served from the block's shared memory, not from global memory.
    for (const site of loadSites(statement)) {
      if (redirect(statement, site.tensor, site.scope, site.indices)) continue;
      const folds = site.folds.reduce((n, f) => n * extent(f, env), 1);
      charge(site.tensor, threads * folds * 4);
    }
    if (p.storage === 'global') issuedWrite += elements(statement.shape, env) * 4;
  }
  // The copy loops run once per block: one row each.
  for (const p of kernel.prefetch) charge(p.tensor, blocks * at(p.extent, env) * 4);
  let issuedRead = 0,
    distinctRead = 0;
  for (const [tensor, bytes] of Object.entries(typed)) {
    issuedRead += bytes;
    distinctRead += Math.min(bytes, elements(tensors.get(tensor).shape, env) * 4);
  }
  return {
    issued: { read: issuedRead, write: issuedWrite },
    distinct: { read: distinctRead, write: issuedWrite },
  };
}

const mb = n => (n / 1e6).toFixed(2) + ' MB';
const table = [];
for (const [name, env] of Object.entries(sizes)) {
  const program = compileTix(readFileSync('corpus/tensor/' + name + '/main.tix', 'utf8'));
  const fn = program.current.value.functions[0];
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  for (const fuse of [true, false]) {
    const plan = planOf(fn, fuse);
    const perKernel = plan.kernels.map(kernel => kernelBytes(kernel, tensors, env));
    const sum = key => perKernel.reduce((n, k) => n + k[key].read + k[key].write, 0);
    const count = (cudaSource(program, name, { fuse }).match(/__global__ void/g) ?? []).length;
    const row = {
      program: name,
      fuse,
      kernels: count,
      issued: sum('issued'),
      distinct: sum('distinct'),
      issuedMs: sum('issued') / rate,
      distinctMs: sum('distinct') / rate,
      perKernel: perKernel.map((k, i) => ({ kernel: i, ...k })),
      decisions: plan.decisions.map(d => `${d.name}:${d.storage}@k${d.kernel}`).join(' '),
    };
    table.push(row);
    console.log(
      `${name.padEnd(10)} ${fuse ? 'fused  ' : 'unfused'} k=${count} issued=${mb(row.issued).padStart(9)} (${row.issuedMs.toFixed(3)} ms) distinct=${mb(row.distinct).padStart(9)} (${row.distinctMs.toFixed(3)} ms) [${plan.decisions.map(d => d.name + ':' + d.storage).join(' ')}]`,
    );
  }
}
console.log('\nJSON ' + JSON.stringify(table));
