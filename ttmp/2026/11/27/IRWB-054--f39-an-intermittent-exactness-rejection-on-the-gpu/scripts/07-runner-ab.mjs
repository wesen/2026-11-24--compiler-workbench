// IRWB-054 probe 07: the two runners against each other under the same concurrency. Each job is the real batched
// contraction (main.cu + inputs.bin built by 08-job-dir.mjs; the binary is cached on the GPU machine, so what is
// measured is the ssh traffic: one copy in, one run, one copy back). Rounds alternate the sides, so a throttling burst
// hits both. A job fails when its runner exits non-zero.
// Usage: node 07-runner-ab.mjs <jobdir> [workers=8] [rounds=5] [jobs=6]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [dir, workers = 8, rounds = 5, jobs = 6] = process.argv.slice(2);
if (!dir) throw Error('usage: node 07-runner-ab.mjs <jobdir> [workers] [rounds] [jobs]');
const sides = {
  before: fileURLToPath(new URL('./06-runner-before-fix.mjs', import.meta.url)),
  after: fileURLToPath(new URL('../../../../../../tools/cuda-remote.mjs', import.meta.url)),
};
const runJob = runner =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [runner, dir, '--runtime-input', 'inputs.bin'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', d => (stderr += d));
    child.on('close', code => resolve({ code, stderr }));
  });
const report = { workers, rounds, jobsEach: jobs, sides: {} };
for (const name of Object.keys(sides)) report.sides[name] = { jobs: 0, failed: 0, retries: 0 };
for (let round = 0; round < Number(rounds); round++) {
  for (const [name, runner] of Object.entries(sides)) {
    const batch = await Promise.all(
      Array.from({ length: Number(workers) }, () =>
        Promise.all(Array.from({ length: Number(jobs) }, () => runJob(runner))),
      ),
    );
    for (const result of batch.flat()) {
      report.sides[name].jobs++;
      if (result.code !== 0) report.sides[name].failed++;
      report.sides[name].retries += result.stderr.split('\n').filter(l => l.includes('retrying')).length;
    }
  }
}
for (const [name, side] of Object.entries(report.sides)) side.rate = side.failed / side.jobs;
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
