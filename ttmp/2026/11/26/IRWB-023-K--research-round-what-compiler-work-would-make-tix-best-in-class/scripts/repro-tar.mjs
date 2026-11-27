import { spawnSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
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
console.log('files:', files.join(' '));
const tar = spawnSync('tar', ['-C', dir, '-cf', '-', '--', ...files], { maxBuffer: 1 << 30 });
console.log('tar status', tar.status, 'stdout bytes', tar.stdout?.length, 'stderr', tar.stderr?.toString());
writeFileSync('/tmp/repro.tar', tar.stdout);
console.log('local mm_a size', statSync(join(dir, 'mm_a.f32')).size);
