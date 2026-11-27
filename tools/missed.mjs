// Where the executed instructions of a pipeline's result are, by code shape, and which passes made that code
// (src/typed/missed.ts): hot code no pass touched, and the patterns a rule would have to match.
// node tools/missed.mjs <project> <pipeline> <fn> [--input '{"n":12}'] [--cases N] [--backend JSON] [--tuned]
//   [--top N] [--limit N] [--json]
// With --cases N the calls are N seeded cases (seed 7) from the project's inputs; otherwise one call, built like
// tools/attribute.mjs: --input over the project's fixed inputs. --tuned is chains + coalesce + homes.
import { installVendor } from './node-vendor.mjs';
import { projectAllFiles } from './corpus.mjs';

await installVendor();
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { storeOf } = await import('../dist/typed/ir.js');
const { benchCase, casesFrom } = await import('../dist/typed/evaluate.js');
const { hotShapes, formatHotShapes } = await import('../dist/typed/missed.js');
const { SIMPLIFY_RULES } = await import('../dist/typed/rules/simplify.js');
const { FOLD_RULES } = await import('../dist/typed/rules/fold.js');

const argv = process.argv.slice(2);
const VALUED = ['--input', '--backend', '--cases', '--top', '--limit'];
const flag = name => argv.includes(name);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter((a, i) => !a.startsWith('--') && !VALUED.includes(argv[i - 1]));
if (!id || !pipeline || !fn) {
  console.error('usage: node tools/missed.mjs <project> <pipeline> <fn> [--input JSON] [--cases N] [--backend JSON] [--tuned] [--top N] [--limit N] [--json]');
  process.exit(2);
}
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const st = storeOf(p.origin.value);
const inputs = project.meta.inputs?.[fn] ?? {};
const fixed = Object.fromEntries(
  Object.entries(inputs).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf),
);
const calls = option('--cases')
  ? casesFrom(st, fn, { count: +option('--cases'), seed: 7, inputs })
  : [benchCase(st, fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') })];
if (pipeline !== 'r0') {
  const run = await p.pipeline(pipeline);
  const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
  if (rejected.length) console.error(`rejected: ${rejected.join(', ')}`);
}
const backend = {
  ...(flag('--tuned') ? { chains: true, coalesce: true, homes: true } : {}),
  ...JSON.parse(option('--backend') ?? '{}'),
};
const h = hotShapes(p.head, calls, {
  backend,
  rules: [...SIMPLIFY_RULES.rules, ...FOLD_RULES.rules],
  ...(option('--limit') ? { limit: +option('--limit') } : {}),
});
console.log(flag('--json') ? JSON.stringify(h, null, 1) : formatHotShapes(h, +(option('--top') ?? 20)));
