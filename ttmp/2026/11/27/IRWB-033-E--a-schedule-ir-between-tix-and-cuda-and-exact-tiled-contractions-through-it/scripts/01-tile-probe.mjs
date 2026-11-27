// IRWB-033-E probe 01 runner: node 01-tile-probe.mjs [--large]; prints the probe's JSON lines.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const tool = fileURLToPath(new URL('../../../../../../tools/cuda-remote.mjs', import.meta.url));
const dir = process.argv.find(a => a.startsWith('--dir='))?.slice(6) ?? '01-tile-probe';
const args = process.argv.slice(2).filter(a => !a.startsWith('--dir='));
const out = JSON.parse(
  execFileSync(process.execPath, [tool, here + dir, '--timed', ...(args.length ? ['--', ...args] : [])], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }),
);
process.stdout.write(out.stdout);
if (out.exit) console.error(out.stderr);
