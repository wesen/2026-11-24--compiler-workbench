// IRWB-054 probe 03: the `batched` lowering check under the GPU suite's real concurrency. The suite runs five
// *-gpu.test.mjs files in parallel and each check fires one remote job per variant at once; sshd drops connections
// past MaxStartups (10:30:100), so the parent starts W workers, each running the check R times and classifying every
// rejection (transport failure against a value disagreement). Retry notes are not visible here: a job that succeeded on
// a later attempt has its stderr dropped by src/tensor/cuda-runtime.ts (execFile on success); probe 07 counts them.
// Usage: node 03-concurrent-loop.mjs [workers=6] [runs=15]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [workers, runs] = process.argv.includes('--worker')
  ? [0, Number(process.argv[process.argv.indexOf('--worker') + 1])]
  : [Number(process.argv[2] ?? 6), Number(process.argv[3] ?? 15)];

if (process.argv.includes('--worker')) {
  const { checkLowering, compileTix } = await import('../../../../../../dist/tensor/index.js');
  const features = compileTix(`
    fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
  `);
  const out = [];
  for (let i = 0; i < runs; i++) out.push(await checkLowering(features, 'batched'));
  process.stdout.write(JSON.stringify(out) + '\n');
} else {
  const self = fileURLToPath(import.meta.url);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: workers }, () =>
      new Promise(resolve => {
        const child = spawn(process.execPath, [self, '--worker', String(runs)], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => (stdout += d));
        child.stderr.on('data', d => (stderr += d));
        child.on('close', code => {
          try {
            resolve({ code, verdicts: JSON.parse(stdout.trim().split('\n').at(-1)) });
          } catch {
            resolve({ code, error: stderr.slice(-400) });
          }
        });
      }),
    ),
  );
  const verdicts = results.flatMap(r => r.verdicts ?? []);
  const failures = verdicts.filter(v => !v.accepted);
  const classify = reason =>
    /Connection closed|kex_exchange|Broken pipe|Connection reset|Connection timed out|No route to host/i.test(reason)
      ? 'transport'
      : /^CUDA evidence unavailable/.test(reason)
        ? 'runner'
        : 'value';
  const byClass = {};
  for (const f of failures) {
    const kind = classify(f.reason ?? '');
    (byClass[kind] ??= []).push(f.reason);
  }
  process.stdout.write(
    JSON.stringify(
      {
        workers,
        runsEach: runs,
        checks: verdicts.length,
        failures: failures.length,
        firstFailureAtCheck: failures.length ? verdicts.findIndex(v => !v.accepted) : null,
        rate: verdicts.length ? failures.length / verdicts.length : 0,
        byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { count: v.length, reasons: [...new Set(v)].slice(0, 8) }])),
        childExitCodes: results.map(r => r.code),
        childErrors: results.map(r => r.error).filter(Boolean),
        seconds: (Date.now() - started) / 1000,
      },
      null,
      2,
    ) + '\n',
  );
}
