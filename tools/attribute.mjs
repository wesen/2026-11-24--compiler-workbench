// Credit the change in executed RV32 instructions along a pipeline to the passes' decisions, for one call.
// node tools/attribute.mjs <project> <pipeline> <fn> [--input '{"n":12}'] [--backend '{"coalesce":true}'] [--limit N] [--rows] [--json]
// --coalesce is short for --backend '{"coalesce":true}'; --limit raises the emulator's step limit (default 2e5)
// for calls that run longer (IRWB-037-E: the chess search needs 3e7).
// Parameters not in --input take the project's own input when that is a fixed value (a buffer's cells), else 0.
import { installVendor } from './node-vendor.mjs';
import { projectAllFiles } from './corpus.mjs';

await installVendor();
const { Program } = await import('../dist/typed/program.js');
const { projectSource } = await import('../dist/typed/project.js');
const { storeOf } = await import('../dist/typed/ir.js');
const { benchCase } = await import('../dist/typed/evaluate.js');
const { attributeSteps, formatAttribution } = await import('../dist/typed/attribute.js');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const [id, pipeline, fn] = argv.filter(
  (a, i) => !a.startsWith('--') && !['--input', '--backend', '--limit'].includes(argv[i - 1]),
);
if (!id || !pipeline || !fn) {
  console.error(
    'usage: node tools/attribute.mjs <project> <pipeline> <fn> [--input JSON] [--backend JSON] [--coalesce] [--rows] [--json]',
  );
  process.exit(2);
}
const project = projectSource(id, projectAllFiles(id));
const p = Program.fromProject(project);
const fixed = Object.fromEntries(
  Object.entries(project.meta.inputs?.[fn] ?? {}).filter(
    ([, v]) => v && typeof v === 'object' && !Array.isArray(v) && !v.oneOf,
  ),
);
const call = benchCase(storeOf(p.origin.value), fn, { ...fixed, ...JSON.parse(option('--input') ?? '{}') });
const run = await p.pipeline(pipeline);
const rejected = run.steps.filter(s => s.rejected).map(s => s.pass);
if (rejected.length) console.error(`rejected: ${rejected.join(', ')}`);
const backend = {
  ...(flag('--coalesce') ? { coalesce: true } : {}),
  ...JSON.parse(option('--backend') ?? '{}'),
};
const limit = option('--limit') ? Number(option('--limit')) : undefined;
const a = attributeSteps(p.revisions, call, { backend, ...(limit ? { limit } : {}) });
if (flag('--json')) console.log(JSON.stringify(a, null, 1));
else {
  console.log(formatAttribution(a));
  if (flag('--rows'))
    for (const r of a.rows.filter(r => r.delta))
      console.log(
        `\nr${r.rev} ${String(r.delta > 0 ? '+' + r.delta : r.delta).padStart(6)}  ${r.decision}  [${r.because.join(', ')}]\n` +
          r.sites.map(s => `          ${s.id.padEnd(14)} ${s.text}`).join('\n'),
      );
}
