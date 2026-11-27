// IRWB-030-G script 03: the plan and the emitted kernel of one program, for reading the generated code.
//
//   node <ticket>/scripts/03-dump.mjs <program> [--fn=<name>] [--plan|--source|--both] [--all]
//   <program> is a corpus name or a path to a .tix file; --all keeps the whole translation unit rather than the
//   kernels.
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { load } from './01-bench.mjs';

const args = process.argv.slice(2);
const program = args.find(a => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const { program: p, fn } = load(program, flag('fn'));
const f = p.current.value.functions.find(x => x.name === fn);
const show = which => {
  const plan = which === 'unfused' ? unfusedPlan(f) : planFusion(f);
  console.log(`// ---- plan (${which})`);
  console.log(
    JSON.stringify(
      plan.groups.map(g => ({
        kernel: g.kernel,
        mapping: g.mapping,
        depth: g.depth,
        statements: g.statements,
        stored: g.stored,
        buffered: g.buffered,
        staged: g.staged,
        terms: g.terms,
        serial: g.serial.map(s => [s.member, s.reduction, s.reason]),
      })),
      null,
      1,
    ),
  );
  const source = cudaSource(p, fn, { fuse: which === 'fused' });
  if (args.includes('--all')) return console.log(source);
  const start = source.indexOf(source.match(/^(template <bool Shared>\n)?__global__/m)?.[0] ?? '');
  const end = source.indexOf('static void run_case');
  console.log(start < 0 ? source : source.slice(start, end));
};
const mode = flag('mode', args.includes('--source') ? 'source' : args.includes('--plan') ? 'plan' : 'both');
if (mode !== 'source')
  for (const which of args.includes('--unfused') ? ['unfused'] : ['fused']) {
    if (mode === 'both' || mode === 'plan') show(which);
  }
else show(args.includes('--unfused') ? 'unfused' : 'fused');
