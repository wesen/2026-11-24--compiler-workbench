import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const dir = new URL('./cuda-exp2/', import.meta.url).pathname;
const files = [];
function walk(d) {
  for (const entry of readdirSync(d).sort()) {
    const p = join(d, entry);
    if (relative(dir, p) === 'out') continue;
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dir, p));
  }
}
walk(dir);
const runtime = new Set(files.filter(f => f !== 'main.cu'));
const tar = spawnSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer: 1 << 30 });
console.log('tar', tar.status, tar.stdout.length);
const remote = 'irwb-cuda/run/repro-' + process.pid;
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'manuel@bling'];
const put = spawnSync('ssh', [...ssh, `mkdir -p ~/${remote} && tar -C ~/${remote} -xf -`], { input: tar.stdout });
console.log('put status', put.status, 'stdout', put.stdout?.toString().slice(0,200), 'stderr', put.stderr?.toString().slice(0,200));
const check = spawnSync('ssh', [...ssh, `ls -la ~/${remote}/mm_a.f32 ~/${remote}/sm_x.f32; rm -rf ~/${remote}`]);
console.log(check.stdout.toString());
