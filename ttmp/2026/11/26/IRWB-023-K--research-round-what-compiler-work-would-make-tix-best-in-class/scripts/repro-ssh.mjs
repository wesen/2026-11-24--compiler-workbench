import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const buf = readFileSync('/tmp/repro.tar');
console.log('input bytes', buf.length);
const put = spawnSync('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=10','--','manuel@bling',
  'rm -rf ~/irwb-repro && mkdir -p ~/irwb-repro && tar -C ~/irwb-repro -xf - && ls -la ~/irwb-repro/mm_a.f32 ~/irwb-repro/sm_x.f32'],
  { input: buf, maxBuffer: 1 << 28 });
console.log('status', put.status);
console.log(put.stdout.toString());
console.log('stderr', put.stderr.toString().slice(0, 500));
