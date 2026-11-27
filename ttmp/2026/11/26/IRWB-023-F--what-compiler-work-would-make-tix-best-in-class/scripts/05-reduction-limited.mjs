// IRWB-023-F, experiment 5: is the price of exactness large when the reduction is
// the only parallelism? (The design document predicts yes.)
//
// Usage: node <ticket>/scripts/05-reduction-limited.mjs
import { execFile } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const work = new URL('../prototypes/work/mv/', import.meta.url);
await mkdir(work, { recursive: true });
await cp(new URL('../prototypes/03-reduction-limited/main.cu', import.meta.url), new URL('main.cu', work));
const { stdout } = await run(
  'node',
  [repo + 'tools/cuda-remote.mjs', fileURLToPath(work), '--timed', '--', '--benchmark'],
  { maxBuffer: 1 << 26, cwd: repo },
);
const meta = JSON.parse(stdout.trim().split('\n').at(-1));
console.log('compileMs', meta.compileMs, 'runMs', meta.runMs, 'stderr', meta.stderr.slice(0, 300));
console.log(meta.stdout.slice(meta.stdout.indexOf('{')));
