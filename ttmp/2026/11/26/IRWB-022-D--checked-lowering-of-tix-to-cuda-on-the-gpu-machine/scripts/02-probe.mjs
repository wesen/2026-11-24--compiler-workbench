// From the repository root: node ttmp/.../scripts/02-probe.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'tix-probe-'));
const stats = ['exp', 'log', 'sqrt', 'tanh', 'sum7(exp)', 'unfused'].map(op => ({ op, mismatches: 0, maxBudgetFraction: 0 }));
const f = Math.fround;
try {
  copyFileSync(new URL('./01-probe.cu', import.meta.url), join(dir, 'main.cu'));
  const run = JSON.parse(execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir], { encoding: 'utf8' }));
  console.log(run);
  const buf = readFileSync(join(dir, 'out', 'probe.bin'));
  if (buf.length !== 8192 * 6 * 4) throw Error('Unexpected data length');
  for (let i = 0; i < 8192; i++) {
    const x = (i - 4096) / 1024, p = (i + 1) / 1024, d = p * 2 ** -23;
    const sp = Array.from({ length: 7 }, (_, k) => Math.exp(x + k/16));
    const ref = [Math.exp(x), Math.log(p), Math.sqrt(p), Math.tanh(x), sp.reduce((a,b) => a+b, 0), (1+d)*(1-d)-1];
    const f32 = [...ref.slice(0,4).map(f), sp.reduce((a,b) => f(a+f(b)), 0), f(f(f(1+d)*f(1-d))-1)];
    stats.forEach((s,j) => {
      const gpu = buf.readFloatLE(4*(6*i+j));
      if (!Object.is(gpu,f32[j])) {
        s.first ??= { i, x, p, f32: f32[j], gpu };
        s.mismatches++;
      }
      s.maxBudgetFraction = Math.max(s.maxBudgetFraction, Math.abs(gpu-ref[j])/(2e-6 + 2e-5*Math.abs(ref[j])));
    });
  }
  console.log(JSON.stringify(stats,null,2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
